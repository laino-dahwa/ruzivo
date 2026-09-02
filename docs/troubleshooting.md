# Troubleshooting / known gotchas

Real issues hit while building the Electron packaging pipeline, kept here so they don't get rediscovered from scratch.

## "Cannot find module 'next'" in the packaged app

**Symptom**: the packaged `Ruzivo.exe` shows "Next.js server exited early (code 1)"; the log shows `Error: Cannot find module 'next'` from `server.js`.

**Cause**: electron-builder's `extraResources` copy silently drops any directory literally named `node_modules`, even with an explicit `filter: ['**/*']` override on that entry — it applies special dependency-tree handling to that name elsewhere in the tool with no config to opt out, even for a pre-built, self-contained folder like `.next/standalone` that should just be copied verbatim.

**Fix**: `scripts/electron-after-pack.js`, wired via `afterPack:` in `electron-builder.yml`, does a plain `fs.cpSync` of `.next/standalone/node_modules` into the packaged resources after electron-builder finishes its own copy — bypassing its file-matching for that one directory entirely.

## `.next/static` / `public/` missing from `output: 'standalone'`

Well-known Next.js gotcha, not Electron-specific: `output: 'standalone'` does **not** copy `.next/static` or `public/` into `.next/standalone/`. `scripts/prepare-standalone.mjs` (run as part of `npm run electron:build:prod`) copies both in manually after `next build`.

## `embedded-postgres`'s chmod throws `ENOENT` when packed in `app.asar`

**Cause**: `embedded-postgres`'s startup code `chmod`s its own bundled `postgres.exe`/`initdb.exe`/`pg_ctl.exe`. This throws even with a correctly configured `asarUnpack` entry unpacking the real files to `app.asar.unpacked/...` (confirmed the unpacked files really existed there) — the package's own internal path resolution still points at the in-archive path for this specific call.

**Fix**: `asar: false` in `electron-builder.yml`, entirely. asar is a pure packaging optimization here with no functional requirement, so turning it off avoids this whole class of asar-vs-native-binary path issues rather than fighting a third-party package's internals.

## Spawned Next server launches a second Electron window instead of running

**Cause**: `next-server.ts` spawns `process.execPath` (the Electron binary itself, when called from Electron's main process) to run `server.js` as a plain Node script. Without `ELECTRON_RUN_AS_NODE: '1'` in that child's env, Electron interprets `server.js` as an unrecognized extra argument and launches a second full Electron app instance instead.

**Fix**: already applied in `next-server.ts` — `ELECTRON_RUN_AS_NODE: '1'` is set on the spawned child's env. This is Electron's own documented technique for getting a real Node child process out of `process.execPath`.

Note the inverse also matters: this variable must be **unset** on the Electron parent process's own environment, or `require('electron')` returns a path-string shim instead of the real API. If you're driving Electron via Playwright's `_electron.launch()` (or any shell where `ELECTRON_RUN_AS_NODE` might already be set globally), explicitly delete it from the `env` passed to the launched process.

## Embedded Postgres does WAL crash-recovery on every restart

**Cause**: `embedded-postgres`'s own `.stop()` uses `taskkill /pid <pid> /f /t` on Windows (forceful kill — Node can't send POSIX signals on Windows), which never lets Postgres flush and shut down cleanly.

**Fix**: `embedded-postgres-manager.ts` shells out directly to the bundled `pg_ctl.exe stop -D <dataDir> -m fast -w` instead of calling the package's own `.stop()`.

## `node-pg-migrate` / `embedded-postgres` are pure ESM; `electron/` compiles to CommonJS

Both packages are ESM-only. `electron/`'s TypeScript project compiles to CommonJS (needed for Electron's main process). Static `import` of either fails with `TS1542` / `ERR_REQUIRE_ESM`.

**Fix**: dynamic `import()` at the call sites in `electron/migrations.ts` and `electron/embedded-postgres-manager.ts`, with `module`/`moduleResolution: "node16"` in `electron/tsconfig.json`.

## `require.resolve('@embedded-postgres/windows-x64/package.json')` fails

**Cause**: that package's `package.json` has `"exports": "./dist/index.js"` (a single string, no `package.json` entry allowed), so resolving the package.json path directly throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.

**Fix**: resolve the package's real entry file instead (`require.resolve('@embedded-postgres/windows-x64')`) and walk up from its directory to the package root.

## Local iteration without a full installer build

`RUZIVO_FORCE_PRODUCTION=1 npm run electron:dev` exercises the full production startup path (setup screen, provisioning, migrations, spawned standalone server) without needing `electron-builder` at all — much faster than rebuilding an installer for every change to `electron/*.ts`.

To hot-patch a compiled-Electron-only change into an already-packaged `release/win-unpacked/` app without a full repackage: `npm run electron:build` (fast, `tsc` only) then copy `dist-electron/` over `release/win-unpacked/resources/app/dist-electron/` directly.
