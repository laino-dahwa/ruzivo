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

interface DesktopBridge {
  readonly isDesktop: true;
  getAppVersion(): Promise<string>;
  saveFile(suggestedName: string, data: Uint8Array): Promise<void>;
  checkForUpdates(): void;
  installUpdate(): void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  /** Points the window (and so the taskbar) at the school's icon. */
  setWindowIcon(url: string): void;
}
const bridge: DesktopBridge = {
  isDesktop: true,
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  saveFile: (suggestedName, data) => ipcRenderer.invoke('dialog:save-file', { suggestedName, data }),
  checkForUpdates: () => ipcRenderer.send('updater:check'),
  installUpdate: () => ipcRenderer.send('updater:install'),
  setWindowIcon: (url: string) => ipcRenderer.send('window:set-icon', url),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
};

contextBridge.exposeInMainWorld('ruzivoDesktop', bridge);
