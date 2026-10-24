// Single narrow seam between the shared web/desktop UI code and the
// Electron-only main process. Nothing outside this file (and its one
// Electron-side counterpart, added when the Electron shell exists) should
// ever branch on "are we in Electron?" directly — see
// services/reports.ts#downloadPdf for the one real usage today.

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

export type BackupCounts = {
  schools: number;
  learners: number;
  payments: number;
  expenses: number;
  employees: number;
  payrollRuns: number;
};

/** Every backup call answers this way when it did not happen; `canceled` means the person closed the folder picker. */
export type BackupFailure = { ok: false; error: string; canceled?: boolean };

export type BackupStatus =
  | {
      ok: true;
      lastBackup: { path: string; createdAt: string; createdBy: string | null; sizeBytes: number; tables: number } | null;
      counts: BackupCounts;
    }
  | BackupFailure;

export type BackupCreated =
  | { ok: true; path: string; sizeBytes: number; durationMs: number; tables: { name: string; rows: number }[] }
  | BackupFailure;

export type BackupSelection =
  | {
      ok: true;
      selectionId: string;
      path: string;
      backup: {
        createdAt: string;
        createdBy: string | null;
        appVersion: string;
        schools: { school_id: string; school_name: string }[];
        counts: BackupCounts;
      };
      current: {
        counts: BackupCounts;
        newerSinceBackup: { payments: number; learners: number };
        lastPaymentAt: string | null;
      };
    }
  | BackupFailure;

export type RestoreDone = { ok: true; safetyCopyPath: string } | BackupFailure;

/**
 * Backup and restore run in the desktop main process (electron/backup/),
 * which owns the folder pickers and checks permission with the server itself.
 * A restore only ever acts on a folder the main process picked and verified,
 * referred to here by `selectionId`.
 */
export interface BackupBridge {
  status(): Promise<BackupStatus>;
  /** Opens a folder picker and writes a new backup folder inside the chosen one. */
  create(): Promise<BackupCreated>;
  /** Opens a folder picker and checks the chosen backup, without changing anything. */
  choose(mode: 'admin' | 'first-run'): Promise<BackupSelection>;
  restore(input: { selectionId: string; password?: string; mode: 'admin' | 'first-run' }): Promise<RestoreDone>;
  showLast(): Promise<void>;
}

export interface DesktopBridge {
  /** Absent in desktop builds older than the backup feature. */
  backup?: BackupBridge;
  readonly isDesktop: true;
  getAppVersion(): Promise<string>;
  /** Hands bytes to a native "Save As" dialog instead of a browser download. */
  saveFile(suggestedName: string, data: Uint8Array): Promise<void>;
  /** Points the window (and so the taskbar) at the school's icon. */
  setWindowIcon?(url: string): void;
  /**
   * Prints a standalone HTML document (see lib/receipt/buildReceiptHtml.ts)
   * via the OS print dialog, so the user picks the physical printer
   * themselves — no assumption is made about which installed printer is the
   * receipt printer.
   */
  printReceipt(html: string): Promise<{ ok: boolean; error?: string }>;
  checkForUpdates(): void;
  /** Restarts the app to install an already-downloaded update. */
  installUpdate(): void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}

declare global {
  interface Window {
    ruzivoDesktop?: DesktopBridge;
  }
}

/** Returns the desktop bridge when running inside the Electron shell, otherwise null. */
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return window.ruzivoDesktop ?? null;
}
