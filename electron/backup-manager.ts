import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { DesktopDbConfig } from './config-store';

const MAX_BACKUPS_PER_KIND = 10;

function timestampedName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function rotateOldBackups(backupsDir: string, prefix: string): void {
  if (!existsSync(backupsDir)) return;
  const entries = readdirSync(backupsDir).filter((name) => name.startsWith(prefix)).sort();
  while (entries.length > MAX_BACKUPS_PER_KIND) {
    const oldest = entries.shift();
    if (oldest) rmSync(path.join(backupsDir, oldest), { recursive: true, force: true });
  }
}

/**
 * Embedded mode: a cold physical backup — the caller must have already
 * gracefully stopped the embedded Postgres cluster (copying a live data
 * directory is unsafe). Plain recursive file copy; no external binaries
 * needed, which matters because the bundled Windows Postgres binaries don't
 * include pg_dump (see embedded-postgres-manager.ts).
 */
export function backupEmbeddedDataDir(databaseDir: string, backupsDir: string): string {
  mkdirSync(backupsDir, { recursive: true });
  const dest = path.join(backupsDir, `embedded-${timestampedName()}`);
  cpSync(databaseDir, dest, { recursive: true });

  const versionFile = path.join(dest, 'PG_VERSION');
  if (!existsSync(versionFile)) {
    throw new Error(`Backup verification failed: ${versionFile} missing from copied backup at ${dest}`);
  }

  rotateOldBackups(backupsDir, 'embedded-');
  console.log(`[backup] embedded PostgreSQL data directory backed up to ${dest}`);
  return dest;
}

/**
 * Existing-Postgres mode: Ruzivo doesn't own or control that server, so a
 * file-level backup isn't possible — this is a best-effort logical backup
 * via pg_dump if one can be located on the system. Returns null (and logs a
 * warning) rather than throwing when pg_dump can't be found, since failing
 * to back up someone else's externally-managed server should not block the
 * app from starting.
 */
function findPgDump(): string | null {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pgRoot = path.join(programFiles, 'PostgreSQL');
  if (!existsSync(pgRoot)) return null;

  // Prefer the highest installed version if there are several.
  const versionDirs = readdirSync(pgRoot).sort().reverse();
  for (const versionDir of versionDirs) {
    const candidate = path.join(pgRoot, versionDir, 'bin', 'pg_dump.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function backupExistingViaPgDump(config: DesktopDbConfig & { password: string }, backupsDir: string): Promise<string | null> {
  const pgDumpPath = findPgDump();
  if (!pgDumpPath) {
    console.warn('[backup] pg_dump was not found on this system (checked the standard PostgreSQL install location) — skipping automatic backup. This server is managed outside Ruzivo; back it up independently before major updates.');
    return null;
  }

  mkdirSync(backupsDir, { recursive: true });
  const dest = path.join(backupsDir, `existing-${timestampedName()}.sql`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(pgDumpPath, ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', config.database, '--no-password', '-f', dest], {
      env: { ...process.env, PGPASSWORD: config.password },
      stdio: 'pipe',
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`));
    });
  });

  const stat = statSync(dest);
  if (stat.size === 0) {
    throw new Error(`Backup verification failed: ${dest} was created empty`);
  }

  rotateOldBackups(backupsDir, 'existing-');
  console.log(`[backup] existing PostgreSQL database backed up to ${dest} (${stat.size} bytes)`);
  return dest;
}
