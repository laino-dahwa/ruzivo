# Desktop architecture

One product, two delivery targets. Electron does not reimplement any business logic or UI — it's a native shell that manages a local PostgreSQL connection, runs migrations, spawns the exact same Next.js app (`output: 'standalone'` build) as a child process, and opens a `BrowserWindow` pointed at it.

```
Electron main process (electron/main.ts)
  ├─ config-store.ts            saved DB config + provisioning mode (userData/config.json)
  ├─ postgres-setup.ts          test-connect / create-database-if-missing, for "existing" mode
  ├─ embedded-postgres-manager.ts  provision/start/stop a bundled Postgres cluster, for "embedded" mode
  ├─ backup-manager.ts          pre-migration backup (cold copy, or pg_dump if available)
  ├─ migrations.ts              node-pg-migrate wrapper (dry-run pending check + apply)
  ├─ next-server.ts             spawns .next/standalone/server.js as a child process
  ├─ updater.ts                 electron-updater wiring (GitHub Releases provider)
  ├─ window.ts                  BrowserWindow creation (setup window + main window)
  └─ preload.ts                 contextBridge — the only file allowed to touch Electron APIs
```

## Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer (the Next.js app, unmodified) never gets `fs`/`child_process`/`net` access — only what `preload.ts` explicitly exposes as `window.ruzivoDesktop`, matching the `DesktopBridge` interface in `lib/platform/index.ts`. No generic `ipcRenderer.invoke` passthrough is exposed.

## Platform abstraction

`lib/platform/index.ts` is the *only* place shared code is allowed to ask "am I in Electron?":

```ts
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return window.ruzivoDesktop ?? null;
}
```

Every desktop-only behavior branches once on this, then falls back to the normal browser behavior when it's `null`. The two current call sites:

- `services/reports.ts#downloadPdf` — hands PDF bytes to a native "Save As" dialog instead of a browser `<a download>` object-URL.
- `components/layout/update-notice.tsx` — subscribes to update status and renders nothing on web.

Never add a scattered `if (electron)` check anywhere else — route it through `getDesktopBridge()` and extend `DesktopBridge` (mirrored by hand in `electron/preload.ts`, since `electron/`'s TypeScript project compiles standalone and importing across that boundary isn't worth the build complexity for two small, rarely-changing type shapes).

## PostgreSQL: two provisioning modes

On first launch, `resolveDbConfigViaSetupWindow()` (`electron/main.ts`) shows a small Electron-rendered setup screen (not the Next.js app — the DB isn't known to be reachable yet) offering:

- **"I have PostgreSQL"** (`existing` mode) — user enters host/port/db/user/password. `postgres-setup.ts` test-connects, then creates the database if missing via a connection to the `postgres` maintenance DB. Ruzivo never starts, stops, or backs up this server beyond a best-effort `pg_dump` — it isn't Ruzivo's process to manage.
- **"Set it up for me"** (`embedded` mode) — `embedded-postgres-manager.ts` provisions a real PostgreSQL server (via the `embedded-postgres` package + `@embedded-postgres/windows-x64` binaries) into `userData/pgdata`, on a free port starting at 5433, with a random generated password. Ruzivo owns this server's full lifecycle: starts it on every launch, stops it gracefully on quit.

Either path converges on the same saved shape (`DesktopDbConfig`), so migrations, the spawned Next server, and every repository function are identical regardless of which mode was chosen.

**Config storage** (`electron/config-store.ts`): non-secret fields (host/port/user/database, provisioning mode) live in plain JSON at `userData/config.json`; the password is encrypted via Electron's `safeStorage` (OS keychain-backed) and stored as a separate base64 field — never written in plaintext.

**Graceful shutdown matters**: `embedded-postgres`'s own `.stop()` uses `taskkill /f /t` on Windows (forceful), which causes WAL crash-recovery on every restart. `embedded-postgres-manager.ts` instead shells out directly to the bundled `pg_ctl.exe stop -m fast -w` for a clean stop.

## Startup sequence (production)

```
Resolve DB config (saved config, or the setup window)
  → getPendingMigrations() (dry-run)
  → if pending: back up first
      embedded mode: stop Postgres, cold-copy the data dir, restart
      existing mode: best-effort pg_dump (skipped with a warning if pg_dump isn't found — never blocks startup)
  → applyMigrations()
  → spawn .next/standalone/server.js as a child process
  → open the main BrowserWindow once the server reports ready
  → wire up electron-updater, fire a courtesy update check ~5s later
```

Any failure before the window opens shows `dialog.showErrorBox` and quits rather than starting against a half-migrated database.

`RUZIVO_FORCE_PRODUCTION=1` exercises this entire path during local `npm run electron:dev`, without needing a full installer build first.

## Spawning the Next.js server

`next-server.ts` spawns `process.execPath` (the Electron binary) with `ELECTRON_RUN_AS_NODE: '1'` in the child's env — without that, Electron launches a second full Electron app instance instead of running `server.js` as a plain Node script. This is Electron's own documented technique for getting a real Node child process out of `process.execPath`.

The DB config is passed to the child purely via `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` env vars — the standalone server is the same code the web deployment runs, reading `lib/db.ts`'s connection config the same way either way.

See [docs/troubleshooting.md](troubleshooting.md) for the packaging-specific gotchas (asar, `extraResources`, standalone output) that this architecture has to work around.
