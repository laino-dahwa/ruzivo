import { contextBridge, ipcRenderer } from 'electron';

// The only file allowed to touch Electron's renderer-privileged APIs.
// Exposes a narrow, typed surface as `window.ruzivoDesktop` — see
// lib/platform/index.ts for the interface both the web and Electron builds
// share. No generic `ipcRenderer` passthrough is exposed to the page.
//
// The types below intentionally mirror lib/platform/index.ts's
// DesktopBridge/UpdateStatus rather than importing it: electron/'s
// TypeScript project compiles standalone (separate tsconfig, CommonJS
// output) and importing across that boundary isn't worth the build
// complexity for two small, rarely-changing type shapes. Keep them in sync
// by hand if lib/platform/index.ts changes.
type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

// Results are passed straight through from electron/backup/ipc.ts; their
// shapes are spelled out in lib/platform/index.ts (BackupStatus etc.).
interface BackupBridge {
  status(): Promise<unknown>;
  create(): Promise<unknown>;
  choose(mode: 'admin' | 'first-run'): Promise<unknown>;
  restore(input: { selectionId: string; password?: string; mode: 'admin' | 'first-run' }): Promise<unknown>;
  showLast(): Promise<void>;
}

interface DesktopBridge {
  readonly isDesktop: true;
  backup: BackupBridge;
  getAppVersion(): Promise<string>;
  saveFile(suggestedName: string, data: Uint8Array): Promise<void>;
  checkForUpdates(): void;
  installUpdate(): void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  /** Points the window (and so the taskbar) at the school's icon. */
  setWindowIcon(url: string): void;
  printReceipt(html: string): Promise<{ ok: boolean; error?: string }>;
}
const bridge: DesktopBridge = {
  isDesktop: true,
  backup: {
    status: () => ipcRenderer.invoke('backup:status'),
    create: () => ipcRenderer.invoke('backup:create'),
    choose: (mode) => ipcRenderer.invoke('backup:choose', mode),
    restore: (input) => ipcRenderer.invoke('backup:restore', input),
    showLast: () => ipcRenderer.invoke('backup:show-last'),
  },
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  saveFile: (suggestedName, data) => ipcRenderer.invoke('dialog:save-file', { suggestedName, data }),
  checkForUpdates: () => ipcRenderer.send('updater:check'),
  installUpdate: () => ipcRenderer.send('updater:install'),
  setWindowIcon: (url: string) => ipcRenderer.send('window:set-icon', url),
  printReceipt: (html: string) => ipcRenderer.invoke('print:receipt', html),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
};

contextBridge.exposeInMainWorld('ruzivoDesktop', bridge);
