#!/usr/bin/env node
// Cross-platform migration runner: ensures the target database exists, then
// applies pending migrations from migrations/. Plain ESM (not TypeScript) so
// it can run standalone via `node`, without pulling in a ts-node/tsx
// dependency just for this one script — used from `npm run migrate` today,
// and reused as-is by the Electron desktop startup sequence later.
//
// Duplicates the small `createDatabaseIfNotExists`/`quoteIdentifier` helpers
// from lib/db.ts on purpose: lib/db.ts is TypeScript loaded by Next.js's own
// bundler, which this standalone script cannot import directly.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

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

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function createDatabaseIfNotExists() {
  const databaseName = process.env.PGDATABASE;
  if (!databaseName) {
    throw new Error('PGDATABASE is not defined');
  }

  const adminPool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGADMINDB || 'postgres',
  });

  try {
    const result = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (result.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      console.log(`Created database "${databaseName}".`);
    }
  } finally {
    await adminPool.end();
  }
}

async function main() {
  loadEnvLocal();
  await createDatabaseIfNotExists();

  const applied = await runner({
    databaseUrl: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    },
    dir: path.join(projectRoot, 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg) => console.log(msg),
  });

  console.log(applied.length === 0 ? 'No pending migrations.' : `Applied ${applied.length} migration(s).`);
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
