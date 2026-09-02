import { autoUpdater } from 'electron-updater';
import type { BrowserWindow } from 'electron';

// Mirrors lib/platform/index.ts's UpdateStatus — see electron/preload.ts for
// why this is duplicated by hand rather than imported.
type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let targetWindow: BrowserWindow | null = null;
let isBusy: () => boolean = () => false;
let wired = false;

function send(status: UpdateStatus): void {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('updater:status', status);
  }
}

/**
 * Wires electron-updater's events to the renderer via `updater:status`.
 * `isMigrationOrBackupInProgress` gates `quitAndInstallUpdate` below — the
 * app must never restart into an update mid-migration/backup, since that
 * would kill the database process or the backup copy partway through.
 */
export function initAutoUpdater(mainWindow: BrowserWindow, isMigrationOrBackupInProgress: () => boolean): void {
  targetWindow = mainWindow;
  isBusy = isMigrationOrBackupInProgress;

  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for update');
    send({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    send({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] no update available');
    send({ state: 'not-available' });
  });
  autoUpdater.on('download-progress', (progress) => send({ state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update downloaded:', info.version);
    send({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (error) => {
    console.error('[updater] error:', error.message);
    send({ state: 'error', message: error.message });
  });
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    send({ state: 'error', message: error instanceof Error ? error.message : String(error) });
  });
}

/** Restarts the app into the downloaded update. Refuses while a migration or backup is running. */
export function quitAndInstallUpdate(): { ok: boolean; error?: string } {
  if (isBusy()) {
    return { ok: false, error: 'A database migration or backup is in progress — try again in a moment.' };
  }
  autoUpdater.quitAndInstall();
  return { ok: true };
}
