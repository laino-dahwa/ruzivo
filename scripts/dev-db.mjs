#!/usr/bin/env node
// Runs as `predev`: starts a local PostgreSQL cluster from the binaries the
// embedded-postgres package already ships, so `npm run dev` works without a
// system-wide Postgres install. Opt-in — does nothing unless .env.local sets
// RUZIVO_DEV_PGDATA to an initialised data directory, so developers pointing
// PG* at their own server are unaffected. Never fails the dev script: if the
// cluster can't be started, it warns and lets `next dev` start anyway.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvLocal() {
  const envPath = path.join(projectRoot, '.env.local');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2];
    }
  }
}

// Same approach as electron/embedded-postgres-manager.ts: the package's
// `exports` only exposes its entry file, so resolve that and walk up.
function pgCtlPath() {
  // Binary packages are named e.g. windows-x64 / darwin-arm64 / linux-x64.
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const packageName = `@embedded-postgres/${platform}-${process.arch}`;
  const entryFile = require.resolve(packageName);
  const packageRoot = path.resolve(path.dirname(entryFile), '..');
  const exe = process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl';
  return path.join(packageRoot, 'native', 'bin', exe);
}

function main() {
  loadEnvLocal();
  const raw = process.env.RUZIVO_DEV_PGDATA;
  if (!raw) return;

  // Allow %VAR% / $VAR references (e.g. %LOCALAPPDATA%) in .env.local.
  const dataDir = raw
    .replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? '')
    .replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (_, name) => process.env[name] ?? '');

  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.warn(`[dev-db] RUZIVO_DEV_PGDATA (${dataDir}) is not an initialised cluster; skipping.`);
    return;
  }

  let pgCtl;
  try {
    pgCtl = pgCtlPath();
  } catch {
    console.warn('[dev-db] No embedded-postgres binaries for this platform; skipping.');
    return;
  }

  // `pg_ctl status` exits 0 when the server is already running.
  if (spawnSync(pgCtl, ['status', '-D', dataDir], { stdio: 'ignore' }).status === 0) {
    console.log('[dev-db] Local PostgreSQL already running.');
    return;
  }

  const port = process.env.PGPORT || '5432';
  const result = spawnSync(
    pgCtl,
    ['start', '-D', dataDir, '-o', `-p ${port} -c listen_addresses=localhost`, '-l', path.join(dataDir, 'server.log'), '-w'],
    { stdio: 'inherit' },
  );
  if (result.status === 0) {
    console.log(`[dev-db] Started local PostgreSQL on port ${port}.`);
  } else {
    console.warn(`[dev-db] Could not start local PostgreSQL; see ${path.join(dataDir, 'server.log')}.`);
  }
}

main();
