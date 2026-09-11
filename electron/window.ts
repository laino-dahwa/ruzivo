import { app, BrowserWindow } from 'electron';
import path from 'node:path';

// The app's own --background (light theme, the only theme it renders).
// Paints the window this colour immediately, instead of the default white,
// so there's no flash before the page itself has painted.
const APP_BACKGROUND = '#f5f1ea';

/**
 * The app's default window/taskbar icon in dev, before any per-school logo
 * (set at runtime via window:set-icon) takes over. The packaged .exe's own
 * icon — baked in at build time via electron-builder.yml's `icon:` — is what
 * actually shows for an installed app; this only matters for `npm run
 * electron:dev` and the production flow's pre-launch setup window.
 *
 * Regenerate this file from public/branding/logo/logo.png via
 * `node scripts/generate-branding-icons.mjs` if the logo ever changes.
 */
function defaultIconPath(): string {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  const relative = app.isPackaged
    ? path.join('.next', 'standalone', 'public', 'branding', 'logo', 'logo.ico')
    : path.join('public', 'branding', 'logo', 'logo.ico');
  return path.join(root, relative);
}

export function createMainWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    backgroundColor: APP_BACKGROUND,
    icon: defaultIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.loadURL(url);
  return win;
}

export function createSetupWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    backgroundColor: APP_BACKGROUND,
    icon: defaultIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'setup', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'setup', 'index.html'));
  return win;
}
