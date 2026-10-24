import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { Pool } from 'pg';
import type { DesktopDbConfig } from '../config-store';
import { migrateSchema } from '../migrations';
import { createBackup } from './create-backup';
import { COUNT_TABLES, type BackupCounts, type BackupManifest } from './format';
import { BackupProblem, readBackup } from './read-backup';
import { restoreBackup } from './restore-backup';

type DbConfig = DesktopDbConfig & { password: string };

export type BackupIpcDeps = {
  getMainWindow(): BrowserWindow | null;
  /** The origin the main window's app is served from, e.g. http://127.0.0.1:3100. */
  getAppOrigin(): string | null;
  getDbConfig(): DbConfig | null;
  migrationsDir: string;
  /** Keeps an update from restarting the app mid-backup (see updater.ts). */
  setBusy(busy: boolean): void;
};

type Actor = { employee_id: number | null; label: string; school_id: string | null };
type Failure = { ok: false; error: string };

type LastBackup = { path: string; createdAt: string; createdBy: string | null; sizeBytes: number; tables: number };

/** Safety copies made just before a restore, kept per computer in the app's own folder. */
const MAX_SAFETY_COPIES = 10;
const SAFETY_PREFIX = 'Before restore';

function statePath() {
  return path.join(app.getPath('userData'), 'backup-state.json');
}

async function readLastBackup(): Promise<LastBackup | null> {
  try {
    const state = JSON.parse(await readFile(statePath(), 'utf8'));
    return state.lastBackup ?? null;
  } catch {
    return null;
  }
}

async function writeLastBackup(lastBackup: LastBackup) {
  await writeFile(statePath(), JSON.stringify({ lastBackup }, null, 2), 'utf8');
}

function safetyCopiesDir() {
  return path.join(app.getPath('userData'), 'backups', 'before-restore');
}

function rotateSafetyCopies() {
  const dir = safetyCopiesDir();
  if (!existsSync(dir)) return;
  const copies = readdirSync(dir).filter((name) => name.startsWith(SAFETY_PREFIX) && !name.endsWith('.partial')).sort();
  while (copies.length > MAX_SAFETY_COPIES) {
    rmSync(path.join(dir, copies.shift()!), { recursive: true, force: true });
  }
}

function fail(error: unknown): Failure {
  if (error instanceof BackupProblem) return { ok: false, error: error.message };
  console.error('[backup]', error);
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

async function withPool<T>(config: DbConfig, work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ ...config, max: 3 });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}

async function currentCounts(pool: Pool): Promise<BackupCounts> {
  const entries = await Promise.all(
    Object.entries(COUNT_TABLES).map(async ([key, table]) => {
      const result = await pool.query(`SELECT count(*)::int AS n FROM "${table}"`).catch(() => ({ rows: [{ n: 0 }] }));
      return [key, result.rows[0].n as number] as const;
    })
  );
  return Object.fromEntries(entries) as BackupCounts;
}

async function writeAudit(pool: Pool, actor: Actor, action: string, summary: string, detail: unknown) {
  await pool
    .query(
      `INSERT INTO audit_log (employee_id, actor_label, school_id, action, entity_type, entity_id, summary, detail)
       VALUES ($1, $2, $3, $4, 'system', NULL, $5, $6::jsonb)`,
      [actor.employee_id, actor.label, actor.school_id, action, summary, JSON.stringify(detail)]
    )
    .catch((error) => console.warn('[backup] could not write audit entry:', error));
}

export function registerBackupIpc(deps: BackupIpcDeps): void {
  // A folder the person picked and that passed every check, by id. Restore
  // only ever acts on one of these, so the page can never hand the main
  // process an arbitrary path to load.
  const selections = new Map<string, { path: string; manifest: BackupManifest }>();
  let busy = false;

  /** Only the app's own main window, showing the app's own pages, may ask. */
  function fromAppWindow(event: IpcMainInvokeEvent): boolean {
    const window = deps.getMainWindow();
    const origin = deps.getAppOrigin();
    if (!window || !origin || event.sender !== window.webContents) return false;
    try {
      return new URL(event.senderFrame?.url ?? '').origin === origin;
    } catch {
      return false;
    }
  }

  /**
   * Asks the app's own server whether the person signed in to the window may
   * back up / restore, by forwarding the window's session cookie - the same
   * check, and the same audit identity, as every other admin action.
   */
  async function authorise(purpose: 'backup' | 'restore', password?: string): Promise<{ ok: true; actor: Actor } | Failure> {
    const window = deps.getMainWindow();
    const origin = deps.getAppOrigin();
    if (!window || !origin) return { ok: false, error: 'The app is not ready yet.' };

    const cookies = await window.webContents.session.cookies.get({ url: origin });
    const response = await fetch(`${origin}/api/system/backup-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
      body: JSON.stringify({ purpose, password }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; actor?: Actor };
    if (!response.ok) {
      return { ok: false, error: body?.error ?? (response.status === 403 ? 'Only an administrator can do this.' : 'Please sign in again.') };
    }
    return { ok: true, actor: body.actor as Actor };
  }

  /**
   * A brand-new install - no administrator yet - may restore without signing
   * in, since there is no account to sign in with. This is exactly when the
   * app's own setup screen is open to anyone at the computer, so it grants
   * nothing that screen doesn't.
   */
  async function isFreshInstall(): Promise<boolean> {
    const origin = deps.getAppOrigin();
    if (!origin) return false;
    const response = await fetch(`${origin}/api/auth/bootstrap`).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { available?: boolean } | null;
    return response?.ok === true && body?.available === true;
  }

  async function exclusive<T>(work: () => Promise<T>): Promise<T | Failure> {
    if (busy) return { ok: false, error: 'A backup or restore is already running.' };
    busy = true;
    deps.setBusy(true);
    try {
      return await work();
    } finally {
      busy = false;
      deps.setBusy(false);
    }
  }

  ipcMain.handle('backup:status', async (event) => {
    if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
    try {
      const auth = await authorise('backup');
      if (!auth.ok) return auth;
      const config = deps.getDbConfig();
      if (!config) return { ok: false, error: 'No database is configured.' };
      const counts = await withPool(config, currentCounts);
      return { ok: true, lastBackup: await readLastBackup(), counts };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('backup:create', async (event) => {
    if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
    try {
      const auth = await authorise('backup');
      if (!auth.ok) return auth;
      const config = deps.getDbConfig();
      if (!config) return { ok: false, error: 'No database is configured.' };

      const last = await readLastBackup();
      const picked = await dialog.showOpenDialog(deps.getMainWindow()!, {
        title: 'Choose where to save the backup',
        buttonLabel: 'Save backup here',
        defaultPath: last ? path.dirname(last.path) : app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true, error: '' };

      return await exclusive(() =>
        withPool(config, async (pool) => {
          const result = await createBackup(pool, { parentDir: picked.filePaths[0], appVersion: app.getVersion(), createdBy: auth.actor.label });
          await writeLastBackup({
            path: result.path,
            createdAt: result.manifest.createdAt,
            createdBy: auth.actor.label,
            sizeBytes: result.sizeBytes,
            tables: result.manifest.tables.length,
          });
          await writeAudit(pool, auth.actor, 'system.backup', `Backed up all data to ${result.path}`, { path: result.path, counts: result.manifest.summary.counts });
          return {
            ok: true as const,
            path: result.path,
            sizeBytes: result.sizeBytes,
            durationMs: result.durationMs,
            tables: result.manifest.tables.map((t) => ({ name: t.name, rows: t.rows })),
          };
        })
      );
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('backup:choose', async (event, mode: unknown) => {
    if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
    try {
      if (mode === 'first-run') {
        if (!(await isFreshInstall())) return { ok: false, error: 'This computer already has an administrator. Sign in to restore a backup.' };
      } else {
        const auth = await authorise('backup');
        if (!auth.ok) return auth;
      }
      const config = deps.getDbConfig();
      if (!config) return { ok: false, error: 'No database is configured.' };

      const picked = await dialog.showOpenDialog(deps.getMainWindow()!, {
        title: 'Choose the backup folder to restore',
        buttonLabel: 'Use this backup',
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory'],
      });
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true, error: '' };

      const folder = picked.filePaths[0];
      const manifest = await readBackup(folder, deps.migrationsDir);
      const id = randomUUID();
      selections.set(id, { path: folder, manifest });

      const current = await withPool(config, async (pool) => {
        const counts = await currentCounts(pool);
        const since = await pool.query(
          `SELECT (SELECT count(*)::int FROM payments WHERE paid_at > $1) AS payments,
                  (SELECT count(*)::int FROM learners WHERE created_at > $1) AS learners,
                  (SELECT max(paid_at) FROM payments) AS last_payment`,
          [manifest.createdAt]
        );
        return { counts, newerSinceBackup: { payments: since.rows[0].payments, learners: since.rows[0].learners }, lastPaymentAt: since.rows[0].last_payment };
      });

      return {
        ok: true,
        selectionId: id,
        path: folder,
        backup: {
          createdAt: manifest.createdAt,
          createdBy: manifest.createdBy,
          appVersion: manifest.appVersion,
          schools: manifest.summary.schools,
          counts: manifest.summary.counts,
        },
        current,
      };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('backup:restore', async (event, input: unknown) => {
    if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
    const { selectionId, password, mode } = (input ?? {}) as { selectionId?: string; password?: string; mode?: string };
    try {
      const selection = selectionId ? selections.get(selectionId) : undefined;
      if (!selection) return { ok: false, error: 'Choose the backup folder again.' };

      let actor: Actor;
      if (mode === 'first-run') {
        if (!(await isFreshInstall())) return { ok: false, error: 'This computer already has an administrator. Sign in to restore a backup.' };
        actor = { employee_id: null, label: 'Restored during first-time setup', school_id: null };
      } else {
        const auth = await authorise('restore', typeof password === 'string' ? password : '');
        if (!auth.ok) return auth;
        actor = auth.actor;
      }

      const config = deps.getDbConfig();
      if (!config) return { ok: false, error: 'No database is configured.' };

      return await exclusive(() =>
        withPool(config, async (pool) => {
          // Re-checked now, not trusted from when it was picked: the folder
          // could have changed while the confirmation was open.
          const manifest = await readBackup(selection.path, deps.migrationsDir);

          const safety = await createBackup(pool, {
            parentDir: safetyCopiesDir(),
            folderPrefix: SAFETY_PREFIX,
            appVersion: app.getVersion(),
            createdBy: actor.label,
            skipReadableCopy: true,
          });
          rotateSafetyCopies();

          const result = await restoreBackup(pool, selection.path, manifest, (options) => migrateSchema(config, deps.migrationsDir, options));
          selections.delete(selectionId!);

          await writeAudit(
            pool,
            { ...actor, employee_id: null },
            'system.restore',
            `Replaced all data with the backup made ${manifest.createdAt} by ${manifest.createdBy ?? 'unknown'} (restored by ${actor.label})`,
            { from: selection.path, safetyCopy: safety.path, rows: result.rows }
          );
          return { ok: true as const, safetyCopyPath: safety.path };
        })
      );
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('backup:show-last', async (event) => {
    if (!fromAppWindow(event)) return;
    const last = await readLastBackup();
    if (last && existsSync(last.path)) shell.showItemInFolder(last.path);
  });
}
