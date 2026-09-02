import { BrowserWindow } from 'electron';
import path from 'node:path';

export function createMainWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
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
