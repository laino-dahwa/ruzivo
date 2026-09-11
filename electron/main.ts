import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { getDbConfig, getProvisioningMode, saveDbConfig, type DesktopDbConfig, type ProvisioningMode } from './config-store';
import { ensureDatabaseExists, testConnection } from './postgres-setup';
import { dataDirFor, provisionEmbeddedPostgres, startEmbeddedPostgres, stopEmbeddedPostgres } from './embedded-postgres-manager';
import { backupEmbeddedDataDir, backupExistingViaPgDump } from './backup-manager';
import { applyMigrations, getPendingMigrations } from './migrations';
import { startNextServer, stopNextServer } from './next-server';
import { createMainWindow, createSetupWindow } from './window';
import { checkForUpdates, initAutoUpdater, quitAndInstallUpdate } from './updater';

// Set RUZIVO_FORCE_PRODUCTION=1 to exercise the packaged-app startup path
// (Postgres setup screen -> migrations -> spawned standalone server) during
// local development, without needing a full electron-builder install first.
const isProductionFlow = app.isPackaged || process.env.RUZIVO_FORCE_PRODUCTION === '1';
const NEXT_SERVER_PORT = 3100;

let mainWindow: BrowserWindow | null = null;
let setupWindow: BrowserWindow | null = null;
let ownsEmbeddedPostgres = false;
// Set while a migration or backup is running so an update can't restart the
// app mid-operation (see electron/updater.ts#quitAndInstallUpdate).
let isMigratingOrBackingUp = false;

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('dialog:save-file', async (_event, { suggestedName, data }: { suggestedName: string; data: Uint8Array }) => {
  const focused = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  const { canceled, filePath } = await dialog.showSaveDialog(focused ?? (undefined as never), {
    defaultPath: suggestedName,
  });
  if (canceled || !filePath) return;
  await writeFile(filePath, Buffer.from(data));
});

/**
 * Points the window at the school's icon, which is what Windows shows in the
 * taskbar for a running app.
 *
 * The renderer sends a URL rather than image bytes, and it is fetched here
 * against the app's own local Next server only — a page cannot talk the main
 * process into loading an arbitrary remote image. Note this changes the icon of
 * the *running window*; the icon baked into the installed .exe is fixed at
 * build time and is not affected.
 */
ipcMain.on('window:set-icon', async (event, url: unknown) => {
  if (typeof url !== 'string' || !mainWindow) return;

  const senderOrigin = new URL(event.sender.getURL() || 'about:blank');
  let target: URL;
  try {
    target = new URL(url, senderOrigin);
  } catch {
    return;
  }
  if (target.origin !== senderOrigin.origin) return;

  try {
    const response = await fetch(target.toString());
    if (!response.ok) return;
    const bytes = Buffer.from(await response.arrayBuffer());
    // Guards against a huge body being turned into a native image.
    if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) return;

    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return;
    mainWindow.setIcon(image);
  } catch {
    // A logo that cannot be fetched or decoded simply leaves the icon alone.
  }
});

ipcMain.on('updater:check', () => {
  if (app.isPackaged) checkForUpdates();
});

ipcMain.on('updater:install', (event) => {
  const result = quitAndInstallUpdate();
  if (!result.ok) {
    event.sender.send('updater:status', { state: 'error', message: result.error });
  }
});

/**
 * Shows the setup window and waits for the user to either connect to an
 * existing PostgreSQL server or have Ruzivo provision its own. Either path
 * resolves with a ready-to-use, already-verified DB config plus which mode
 * was chosen (so the caller knows whether it now owns that server's
 * lifecycle).
 */
function resolveDbConfigViaSetupWindow(): Promise<{ config: DesktopDbConfig & { password: string }; mode: ProvisioningMode }> {
  return new Promise((resolve) => {
    setupWindow = createSetupWindow();

    const finish = (config: DesktopDbConfig & { password: string }, mode: ProvisioningMode) => {
      saveDbConfig(config, mode);
      ipcMain.removeHandler('setup:connect');
      ipcMain.removeHandler('setup:provision-embedded');
      resolve({ config, mode });
    };

    ipcMain.handle('setup:connect', async (_event, config: DesktopDbConfig & { password: string }) => {
      const result = await testConnection(config);
      if (!result.ok) return result;

      try {
        await ensureDatabaseExists(config);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }

      finish(config, 'existing');
      return { ok: true };
    });

    ipcMain.handle('setup:provision-embedded', async () => {
      try {
        const config = await provisionEmbeddedPostgres(app.getPath('userData'));
        ownsEmbeddedPostgres = true;
        finish(config, 'embedded');
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  });
}

async function startProductionFlow(): Promise<void> {
  let dbConfig = getDbConfig();
  const savedMode = getProvisioningMode();

  if (dbConfig && savedMode === 'embedded') {
    try {
      await startEmbeddedPostgres(dbConfig, app.getPath('userData'));
      ownsEmbeddedPostgres = true;
    } catch (error) {
      console.error('[startup] failed to start the previously provisioned embedded PostgreSQL, asking user to reconfigure:', error);
      dbConfig = null;
    }
  } else if (dbConfig && savedMode === 'existing') {
    const result = await testConnection(dbConfig);
    if (!result.ok) {
      console.warn('[startup] saved Postgres config no longer works, asking user to reconfigure:', result.error);
      dbConfig = null;
    }
  }

  if (!dbConfig) {
    const resolved = await resolveDbConfigViaSetupWindow();
    dbConfig = resolved.config;
  }

  const migrationsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(__dirname, '..', 'migrations');
  const mode = getProvisioningMode();

  const pending = await getPendingMigrations(dbConfig, migrationsDir);
  isMigratingOrBackingUp = true;
  try {
    if (pending.length > 0) {
      console.log(`[startup] ${pending.length} migration(s) pending, backing up before applying:`, pending);
      const backupsDir = path.join(app.getPath('userData'), 'backups');

      if (mode === 'embedded') {
        // Cold file-level backup: stop, copy, restart. Safer than any
        // in-process copy, since nothing can be writing to the data
        // directory while Postgres is down.
        await stopEmbeddedPostgres();
        backupEmbeddedDataDir(dataDirFor(app.getPath('userData')), backupsDir);
        await startEmbeddedPostgres(dbConfig, app.getPath('userData'));
      } else {
        // Best-effort: this server isn't ours to stop, so a pg_dump logical
        // backup is the only option, and it's skipped (with a warning) rather
        // than blocking startup if pg_dump can't be found.
        await backupExistingViaPgDump(dbConfig, backupsDir).catch((error) => {
          console.error('[backup] pg_dump backup failed, proceeding with migration anyway:', error);
        });
      }
    }

    const applied = await applyMigrations(dbConfig, migrationsDir);
    console.log(`[startup] applied ${applied.length} migration(s):`, applied);
  } finally {
    isMigratingOrBackingUp = false;
  }

  const appRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  await startNextServer({ appRoot, port: NEXT_SERVER_PORT, dbConfig });

  setupWindow?.close();
  setupWindow = null;
  mainWindow = createMainWindow(`http://127.0.0.1:${NEXT_SERVER_PORT}`);

  if (app.isPackaged) {
    initAutoUpdater(mainWindow, () => isMigratingOrBackingUp);
    // Give the window a moment to finish loading before the first check —
    // this is a courtesy check on launch, not a blocking part of startup.
    setTimeout(() => checkForUpdates(), 5000);
  }
}

async function startDevelopmentFlow(): Promise<void> {
  // Assumes `npm run dev` is already running separately — Electron in dev
  // mode is a thin viewer over the real Next.js dev server, so HMR keeps
  // working exactly as it does in a browser.
  mainWindow = createMainWindow('http://localhost:3000');
}

app.whenReady().then(async () => {
  // No File/Edit/View/Window menu bar — this is a business app, not a
  // document editor, and none of those menus have anything useful in them.
  Menu.setApplicationMenu(null);

  try {
    if (isProductionFlow) {
      await startProductionFlow();
    } else {
      await startDevelopmentFlow();
    }
  } catch (error) {
    console.error('[startup] failed:', error);
    dialog.showErrorBox('SSV Admin failed to start', error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (isProductionFlow) void startProductionFlow();
      else void startDevelopmentFlow();
    }
  });
});

async function shutdown(): Promise<void> {
  stopNextServer();
  if (ownsEmbeddedPostgres) {
    await stopEmbeddedPostgres();
    ownsEmbeddedPostgres = false;
  }
}

let isShuttingDown = false;

// Postgres needs a graceful stop (WAL flush, clean process exit) before the
// app actually quits — window-all-closed just requests a quit, and
// before-quit defers the real exit until that async cleanup finishes.
app.on('before-quit', (event) => {
  if (isShuttingDown) return;
  event.preventDefault();
  isShuttingDown = true;
  shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
