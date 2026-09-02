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

export interface DesktopBridge {
  readonly isDesktop: true;
  getAppVersion(): Promise<string>;
  /** Hands bytes to a native "Save As" dialog instead of a browser download. */
  saveFile(suggestedName: string, data: Uint8Array): Promise<void>;
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
