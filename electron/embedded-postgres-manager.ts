import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Client } from 'pg';
import type { DesktopDbConfig } from './config-store';

// embedded-postgres is a pure-ESM package but this file compiles to
// CommonJS (Electron main process); it's loaded via a dynamic import() at
// call time, same pattern used for node-pg-migrate in migrations.ts. It is
// only used to run initdb: the server itself is started and stopped with
// pg_ctl (startServer, gracefulStop).
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
 * initdb settings that do not depend on the computer. Left to itself, initdb
 * takes the encoding and sort order from the Windows regional settings,
 * which differ between computers and can name a locale PostgreSQL rejects -
 * a failure only a first install ever hits. UTF-8 with ICU's English
 * collation is the same everywhere and sorts names naturally
 * (Álvaro, apple, Banana).
 */
const INITDB_FLAGS = ['--encoding=UTF8', '--locale=C', '--locale-provider=icu', '--icu-locale=en'];

// initdb/postgres exit with STATUS_DLL_NOT_FOUND (0xC0000135) when a DLL they
// import is missing - in practice the Microsoft Visual C++ runtime, which the
// packaged app ships next to them (scripts/electron-after-pack.js).
const DLL_NOT_FOUND = 3221225781;

function serverLogFor(databaseDir: string): string {
  return path.join(path.dirname(databaseDir), 'postgres.log');
}

function logTail(file: string, lines = 15): string {
  try {
    return readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

function runPgCtl(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    // Output goes to the server log (-l), not to us: the server pg_ctl starts
    // inherits whatever handles pg_ctl is given, and a pipe it held open
    // would stop this from ever finishing.
    const child = spawn(pgCtlPath(), args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

function missingRuntimeError(): Error {
  return new Error(
    'The built-in database could not start because a Microsoft Visual C++ runtime file is missing. ' +
      "Install 'Microsoft Visual C++ 2015-2022 Redistributable (x64)' from microsoft.com, then try again."
  );
}

/**
 * Starts the server through pg_ctl rather than embedded-postgres's own
 * start(), which runs postgres.exe directly. postgres.exe refuses to run with
 * administrator rights; pg_ctl drops them before starting it, so the app
 * still works when launched elevated (the installer's "Run" box after an
 * all-users install, the built-in Administrator account, UAC turned off).
 * A server already running on this data folder - left behind by a crash -
 * is reused instead of failing to start a second one.
 */
async function startServer(databaseDir: string, port: number): Promise<void> {
  if ((await runPgCtl(['status', '-D', databaseDir])) === 0) return;

  const log = serverLogFor(databaseDir);
  const code = await runPgCtl(['start', '-D', databaseDir, '-o', `-p ${port}`, '-l', log, '-w', '-t', '120']);
  if (code === DLL_NOT_FOUND) throw missingRuntimeError();
  if (code !== 0) {
    throw new Error(`The built-in database could not start (pg_ctl exit code ${code}).\n${logTail(log)}`);
  }
}

/**
 * A data folder left by an earlier attempt that never finished would make
 * initdb refuse - it only works in an empty folder - so every retry would
 * fail the same way. Only called when no settings are saved for it: a
 * half-made folder (no PG_VERSION) is removed; one holding a complete
 * cluster is moved aside, never deleted.
 */
function clearStaleDataDir(databaseDir: string): void {
  if (!existsSync(databaseDir)) return;
  if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) {
    rmSync(databaseDir, { recursive: true, force: true });
    return;
  }
  const aside = `${databaseDir}-unused-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(databaseDir, aside);
  console.warn(`[embedded-pg] moved an existing data folder with no saved settings aside to ${aside}`);
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
  clearStaleDataDir(databaseDir);

  const instance = new EmbeddedPostgres({
    databaseDir,
    port,
    user: EMBEDDED_USER,
    password,
    persistent: true,
    initdbFlags: INITDB_FLAGS,
    onLog: (message: string) => console.log('[embedded-pg]', message),
    onError: (error: unknown) => console.error('[embedded-pg]', error),
  });

  try {
    await instance.initialise();
  } catch (error) {
    // A half-made folder would block the next attempt (see clearStaleDataDir).
    rmSync(databaseDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(String(DLL_NOT_FOUND))) throw missingRuntimeError();
    throw new Error(`The built-in database could not be set up. ${message}`);
  }

  await startServer(databaseDir, port);
  runningDataDir = databaseDir;

  // Not instance.createDatabase(): that only works on a server the package
  // started itself, and this one was started with pg_ctl.
  const client = new Client({ host: '127.0.0.1', port, user: EMBEDDED_USER, password, database: 'postgres' });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${EMBEDDED_DB_NAME}`);
  } finally {
    await client.end();
  }

  return { host: '127.0.0.1', port, user: EMBEDDED_USER, database: EMBEDDED_DB_NAME, password };
}

/**
 * Every subsequent launch: the cluster already exists on disk (from a prior
 * provisionEmbeddedPostgres() call) — just start it using the previously
 * saved connection details. Never re-initializes (that would only apply to
 * a fresh, empty data directory).
 */
export async function startEmbeddedPostgres(config: DesktopDbConfig & { password: string }, userDataDir: string): Promise<void> {
  const databaseDir = dataDirFor(userDataDir);
  await startServer(databaseDir, config.port);
  runningDataDir = databaseDir;
}

export async function stopEmbeddedPostgres(): Promise<void> {
  if (!runningDataDir) return;
  const databaseDir = runningDataDir;
  runningDataDir = null;
  try {
    await gracefulStop(databaseDir);
  } catch (error) {
    console.error('[embedded-pg] graceful stop failed:', error);
  }
}
