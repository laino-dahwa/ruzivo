import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { appliedMigrations, listColumns, listTables, qualified, standaloneSequences } from './catalog';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  COUNT_TABLES,
  DATA_DIR,
  MANIFEST_FILE,
  README_FILE,
  XLSX_FILE,
  backupFolderName,
  readmeText,
  type BackupCounts,
  type BackupManifest,
  type BackupTableEntry,
} from './format';
import { writeReadableCopy } from './xlsx';

export type CreateBackupOptions = {
  /** The folder the user picked; the backup becomes a new folder inside it. */
  parentDir: string;
  appVersion: string;
  createdBy: string | null;
  /** Defaults to "Ruzivo backup"; the pre-restore safety copy uses its own. */
  folderPrefix?: string;
  /** Leave out the Excel copy (the safety copy only ever gets restored). */
  skipReadableCopy?: boolean;
  schema?: string;
  now?: Date;
};

export type CreateBackupResult = {
  path: string;
  manifest: BackupManifest;
  sizeBytes: number;
  durationMs: number;
};

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** "X", then "X (2)", "X (3)"... - never overwrites an earlier backup. */
function freeFolderPath(parentDir: string, name: string): string {
  let candidate = path.join(parentDir, name);
  for (let n = 2; existsSync(candidate) || existsSync(`${candidate}.partial`); n++) {
    candidate = path.join(parentDir, `${name} (${n})`);
  }
  return candidate;
}

/**
 * Writes a complete, verified backup of every application table.
 *
 * All tables are read inside one REPEATABLE READ transaction, so the backup
 * is a single consistent moment: a payment being recorded while it runs is
 * either wholly in it or wholly not.
 *
 * Written into "<name>.partial" and only renamed to its real name once every
 * file has been read back and matched against its fingerprint - a folder
 * with the real name is always a complete backup.
 */
export async function createBackup(pool: Pool, options: CreateBackupOptions): Promise<CreateBackupResult> {
  const started = Date.now();
  const schema = options.schema ?? 'public';
  const now = options.now ?? new Date();
  const finalPath = freeFolderPath(options.parentDir, backupFolderName(now, options.folderPrefix));
  const workPath = `${finalPath}.partial`;

  await mkdir(path.join(workPath, DATA_DIR), { recursive: true });

  try {
    const client = await pool.connect();
    const tables: BackupTableEntry[] = [];
    const counts = new Map<string, number>();
    let manifest: BackupManifest;

    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

      const migrations = await appliedMigrations(client, schema);
      if (migrations.length === 0) throw new Error('This database has no migrations recorded, so it cannot be backed up.');

      for (const table of await listTables(client, schema)) {
        const columns = await listColumns(client, schema, table);
        const result = await client.query(`SELECT row_to_json(t)::text AS j FROM ${qualified(schema, table)} t`);
        const body = result.rows.map((row) => row.j as string).join('\n') + (result.rows.length > 0 ? '\n' : '');
        const file = `${DATA_DIR}/${table}.jsonl`;
        await writeFile(path.join(workPath, file), body, 'utf8');
        tables.push({ name: table, file, rows: result.rows.length, sha256: sha256(body), columns: columns.map((c) => c.name) });
        counts.set(table, result.rows.length);
      }

      const sequences = [];
      for (const name of await standaloneSequences(client, schema)) {
        const seq = await client.query(`SELECT last_value::text AS last_value, is_called FROM ${qualified(schema, name)}`);
        sequences.push({ name, lastValue: String(seq.rows[0].last_value), isCalled: seq.rows[0].is_called === true });
      }

      const schools = await client.query(
        `SELECT school_id, school_name FROM ${qualified(schema, 'schools')} ORDER BY school_name`
      );

      await client.query('COMMIT');

      const headline = Object.fromEntries(
        Object.entries(COUNT_TABLES).map(([key, table]) => [key, counts.get(table) ?? 0])
      ) as BackupCounts;

      manifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: now.toISOString(),
        appVersion: options.appVersion,
        createdBy: options.createdBy,
        migrations,
        tables,
        sequences,
        summary: {
          schools: schools.rows.map((row) => ({ school_id: String(row.school_id).trim(), school_name: String(row.school_name) })),
          counts: headline,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    await writeFile(path.join(workPath, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
    await writeFile(path.join(workPath, README_FILE), readmeText(manifest), 'utf8');
    if (!options.skipReadableCopy) await writeReadableCopy(workPath, manifest, path.join(workPath, XLSX_FILE));

    // Read every data file back from disk: catches a full disk or a USB stick
    // that silently dropped the write, before anyone relies on this backup.
    for (const table of manifest.tables) {
      const written = await readFile(path.join(workPath, table.file));
      if (sha256(written) !== table.sha256) {
        throw new Error(`Backup verification failed: ${table.file} did not read back the same as it was written.`);
      }
    }

    await rename(workPath, finalPath);

    let sizeBytes = 0;
    for (const file of [MANIFEST_FILE, README_FILE, ...(options.skipReadableCopy ? [] : [XLSX_FILE]), ...manifest.tables.map((t) => t.file)]) {
      sizeBytes += (await stat(path.join(finalPath, file))).size;
    }

    return { path: finalPath, manifest, sizeBytes, durationMs: Date.now() - started };
  } catch (error) {
    await rm(workPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
