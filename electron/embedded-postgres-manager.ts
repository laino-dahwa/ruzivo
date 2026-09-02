import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import type { DesktopDbConfig } from './config-store';

// embedded-postgres is a pure-ESM package but this file compiles to
// CommonJS (Electron main process); it's loaded via a dynamic import() at
// call time, same pattern used for node-pg-migrate in migrations.ts. Only
// the handful of methods actually used here are typed, to avoid a
// type-only import across the ESM/CJS boundary (which needs an explicit
// resolution-mode attribute otherwise).
interface EmbeddedPostgresInstance {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
}

let runningInstance: EmbeddedPostgresInstance | null = null;
let runningDataDir: string | null = null;

const EMBEDDED_DB_NAME = 'ruzivo';
const EMBEDDED_USER = 'ruzivo';
const PREFERRED_PORT = 5433; // deliberately not 5432, to avoid colliding with a real local Postgres

/**
 * embedded-postgres's own `.stop()` shells out to `taskkill /f /t` on
 * Windows (there's no POSIX SIGINT to send from Node), which force-kills
 * postgres.exe without letting it write a clean shutdown checkpoint — every
 * next launch then pays for WAL crash-recovery, and repeated forceful kills
 * are not something to rely on for financial data. pg_ctl.exe (bundled
 * alongside postgres.exe in the same binary package) implements a real
 * graceful shutdown on Windows via its own IPC with the server, so it's
 * used directly here instead of the package's own stop().
 */
function pgCtlPath(): string {
  // The package's package.json restricts `exports` to just "./dist/index.js"
  // (no "./package.json"), so resolve via that entry file and walk up to
  // the package root instead. require.resolve() only resolves a path here —
  // it never executes the target, so the fact that file is ESM doesn't matter.
  const entryFile = require.resolve('@embedded-postgres/windows-x64');
  const packageRoot = path.resolve(path.dirname(entryFile), '..');
  return path.join(packageRoot, 'native', 'bin', 'pg_ctl.exe');
}

function gracefulStop(databaseDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pgCtlPath(), ['stop', '-D', databaseDir, '-m', 'fast', '-w'], { stdio: 'pipe' });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_ctl stop exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

/** Finds a free local TCP port, preferring `preferred` if it's available. */
function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', () => {
      const fallback = net.createServer();
      fallback.unref();
      fallback.on('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const address = fallback.address();
        const port = address && typeof address === 'object' ? address.port : preferred;
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferred, '127.0.0.1', () => {
      probe.close(() => resolve(preferred));
    });
  });
}

export function dataDirFor(userDataDir: string): string {
  return path.join(userDataDir, 'pgdata');
}

/**
 * First-run path: picks a free port and a random password, initializes a
 * brand-new PostgreSQL cluster in userDataDir/pgdata, starts it, and creates
 * the application database. Returns the config to persist via config-store.
 */
export async function provisionEmbeddedPostgres(userDataDir: string): Promise<DesktopDbConfig & { password: string }> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const port = await findFreePort(PREFERRED_PORT);
  const password = generatePassword();
  const databaseDir = dataDirFor(userDataDir);

  const instance = new EmbeddedPostgres({
    databaseDir,
    port,
    user: EMBEDDED_USER,
    password,
    persistent: true,
    onLog: (message: string) => console.log('[embedded-pg]', message),
    onError: (error: unknown) => console.error('[embedded-pg]', error),
  });

  await instance.initialise();
  await instance.start();
  await instance.createDatabase(EMBEDDED_DB_NAME);

  runningInstance = instance;
  runningDataDir = databaseDir;

  return { host: '127.0.0.1', port, user: EMBEDDED_USER, database: EMBEDDED_DB_NAME, password };
}

/**
 * Every subsequent launch: the cluster already exists on disk (from a prior
 * provisionEmbeddedPostgres() call) — just start it using the previously
 * saved connection details. Never re-initializes (that would only apply to
 * a fresh, empty data directory).
 */
export async function startEmbeddedPostgres(config: DesktopDbConfig & { password: string }, userDataDir: string): Promise<void> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const databaseDir = dataDirFor(userDataDir);

  const instance = new EmbeddedPostgres({
    databaseDir,
    port: config.port,
    user: config.user,
    password: config.password,
    persistent: true,
    onLog: (message: string) => console.log('[embedded-pg]', message),
    onError: (error: unknown) => console.error('[embedded-pg]', error),
  });

  await instance.start();
  runningInstance = instance;
  runningDataDir = databaseDir;
}

export async function stopEmbeddedPostgres(): Promise<void> {
  if (!runningInstance || !runningDataDir) return;
  const databaseDir = runningDataDir;
  runningInstance = null;
  runningDataDir = null;
  try {
    await gracefulStop(databaseDir);
  } catch (error) {
    console.error('[embedded-pg] graceful stop failed:', error);
  }
}
