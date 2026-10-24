import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './create-backup';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, MANIFEST_FILE, type BackupManifest } from './format';

/** A problem with a backup folder, worded for the person who picked it. */
export class BackupProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupProblem';
  }
}

/** Migration names as node-pg-migrate records them: the file name without its extension. */
export async function availableMigrations(migrationsDir: string): Promise<string[]> {
  const files = await readdir(migrationsDir);
  return files
    .filter((file) => /\.(sql|js|cjs|mjs|ts)$/.test(file))
    .map((file) => file.replace(/\.[^.]+$/, ''))
    .sort();
}

/**
 * Checks a backup folder completely before anything is changed: that it is a
 * Ruzivo backup, that every data file is present and unaltered (fingerprint
 * and row count), and that this version of the app can load it.
 *
 * A backup made by an older app is fine - it is loaded at its own schema
 * version and then brought up to date (restore-backup.ts). One made by a
 * newer app is refused, since this app cannot know what its extra
 * migrations did.
 */
export async function readBackup(dir: string, migrationsDir: string): Promise<BackupManifest> {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new BackupProblem("This folder isn't a Ruzivo backup - it has no manifest.json. Pick the folder named \"Ruzivo backup …\" itself, not the folder it is in.");
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest;
  } catch {
    throw new BackupProblem("This backup's manifest.json is damaged and can't be read.");
  }

  if (manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.tables) || !Array.isArray(manifest.migrations)) {
    throw new BackupProblem("This folder's manifest.json isn't a Ruzivo backup manifest.");
  }
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupProblem(`This backup was made by a newer version of Ruzivo (${manifest.appVersion}). Update Ruzivo on this computer, then restore it.`);
  }

  const known = await availableMigrations(migrationsDir);
  const unknown = manifest.migrations.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new BackupProblem(`This backup was made by a newer version of Ruzivo (${manifest.appVersion}). Update Ruzivo on this computer, then restore it.`);
  }
  // Migrations always run in file order, so a backup's list must be the
  // first N of ours - anything else means it came from a different history.
  if (manifest.migrations.some((name, i) => known[i] !== name)) {
    throw new BackupProblem("This backup's database history doesn't match this version of Ruzivo, so it can't be restored safely.");
  }

  for (const table of manifest.tables) {
    if (!/^[a-z0-9_]+$/.test(table.name) || table.file !== `data/${table.name}.jsonl`) {
      throw new BackupProblem(`This backup's manifest lists an unexpected file (${table.file}).`);
    }
    const filePath = path.join(dir, table.file);
    if (!existsSync(filePath)) {
      throw new BackupProblem(`This backup is incomplete: ${table.file} is missing.`);
    }
    const body = await readFile(filePath);
    if (sha256(body) !== table.sha256) {
      throw new BackupProblem(`This backup has been changed or damaged since it was made (${table.file}). It can't be restored.`);
    }
    const lines = body.length === 0 ? 0 : body.toString('utf8').split('\n').filter(Boolean).length;
    if (lines !== table.rows) {
      throw new BackupProblem(`This backup is damaged: ${table.file} has ${lines} rows, but should have ${table.rows}.`);
    }
  }

  return manifest;
}
