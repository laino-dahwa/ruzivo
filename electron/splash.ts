import { BrowserWindow } from 'electron';

const APP_BACKGROUND = '#f5f1ea';
const INK = '#2b2723';
const MUTED = '#6f6a63';
const ACCENT = '#cb633a';

/**
 * The window shown while the app boots.
 *
 * Starting up means starting PostgreSQL, checking the schema and booting the
 * web server, none of which are instant — and until this existed, all of it
 * happened with nothing on screen at all. A user double-clicked the icon and
 * watched an empty desktop, which reads as "it didn't open" long before it
 * reads as "it's loading".
 *
 * Deliberately a data: URL rather than an .html file: nothing to add to the
 * packaging step, and the splash cannot itself fail to load from disk.
 */
const SPLASH_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: ${APP_BACKGROUND};
    color: ${INK};
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    user-select: none;
    -webkit-app-region: drag;
  }
  .name { font-size: 19px; font-weight: 600; letter-spacing: -.02em; }
  .status { font-size: 12px; color: ${MUTED}; min-height: 16px; }
  .track {
    margin-top: 14px;
    width: 190px;
    height: 3px;
    border-radius: 999px;
    background: rgba(0,0,0,.08);
    overflow: hidden;
  }
  /* An indeterminate sweep, not a percentage: the steps take wildly
     different amounts of time, so any percentage would be a lie. */
  .bar { width: 40%; height: 100%; border-radius: 999px; background: ${ACCENT}; animation: sweep 1.15s ease-in-out infinite; }
  @keyframes sweep {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(250%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar { animation: none; width: 100%; opacity: .5; }
  }
</style>
</head>
<body>
  <div class="name">SSV Admin</div>
  <div class="status" id="status">Starting&hellip;</div>
  <div class="track"><div class="bar"></div></div>
  <script>
    window.setStatus = (text) => { document.getElementById('status').textContent = text; };
  </script>
</body>
</html>`;

let splash: BrowserWindow | null = null;

export function openSplash(): void {
  if (splash && !splash.isDestroyed()) {
    return;
  }

  splash = new BrowserWindow({
    width: 380,
    height: 210,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: APP_BACKGROUND,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
}

/**
 * Updates the line of text on the splash.
 *
 * JSON.stringify rather than string concatenation: these messages are fixed
 * strings today, but building executable JavaScript by interpolation is the
 * kind of thing that quietly becomes an injection the first time someone
 * passes an error message through it.
 */
export function setSplashStatus(message: string): void {
  if (!splash || splash.isDestroyed()) {
    return;
  }
  void splash.webContents.executeJavaScript(`window.setStatus?.(${JSON.stringify(message)})`).catch(() => {
    // The splash is cosmetic; if it has gone away mid-update, say nothing.
  });
}

export function closeSplash(): void {
  if (splash && !splash.isDestroyed()) {
    splash.destroy();
  }
  splash = null;
}
