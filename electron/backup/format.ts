/**
 * The on-disk backup format. A backup is one ordinary folder:
 *
 *   Ruzivo backup 2026-10-24 0930/
 *     manifest.json   - what this is, which app/schema version made it, and a
 *                       SHA-256 fingerprint + row count for every data file
 *     README.txt      - how to restore it, for whoever finds the folder
 *     Ruzivo data (read-only copy).xlsx - the same data, for opening in Excel
 *     data/<table>.jsonl - one row per line, exactly as Postgres's own
 *                       row_to_json renders it
 *
 * Rows are never parsed into JavaScript on the way out or back in: Postgres
 * writes them (row_to_json) and reads them (json_populate_recordset). That
 * keeps NUMERIC money, BIGINT ids, timestamps and BYTEA logos bit-for-bit
 * exact, with no float rounding anywhere in between.
 *
 * Bump BACKUP_FORMAT_VERSION only for a change an older app could not read;
 * a new table or column is not one (see restore-backup.ts).
 */

export const BACKUP_FORMAT = 'ruzivo-backup';
export const BACKUP_FORMAT_VERSION = 1;

export const MANIFEST_FILE = 'manifest.json';
export const README_FILE = 'README.txt';
export const XLSX_FILE = 'Ruzivo data (read-only copy).xlsx';
export const DATA_DIR = 'data';

/**
 * Never backed up. Migrations are recorded in the manifest instead (they say
 * which schema the rows belong to), and sessions are who is signed in right
 * now - restoring them would sign people in on a computer they never used.
 */
export const EXCLUDED_TABLES = ['pgmigrations', 'sessions'] as const;

export type BackupTableEntry = {
  name: string;
  /** Relative to the backup folder, always with forward slashes. */
  file: string;
  rows: number;
  sha256: string;
  columns: string[];
};

export type BackupSequenceEntry = { name: string; lastValue: string; isCalled: boolean };

export type BackupCounts = {
  schools: number;
  learners: number;
  payments: number;
  expenses: number;
  employees: number;
  payrollRuns: number;
};

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  createdBy: string | null;
  /** Every migration applied to the database the rows came from, in order. */
  migrations: string[];
  tables: BackupTableEntry[];
  /** Standalone sequences (not identity columns), e.g. document reference numbers. */
  sequences: BackupSequenceEntry[];
  summary: {
    schools: { school_id: string; school_name: string }[];
    counts: BackupCounts;
  };
};

/** Which table each headline count comes from. */
export const COUNT_TABLES: Record<keyof BackupCounts, string> = {
  schools: 'schools',
  learners: 'learners',
  payments: 'payments',
  expenses: 'expenses',
  employees: 'employees',
  payrollRuns: 'payroll_runs',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** "Ruzivo backup 2026-10-24 0930", in local time - the name people see in Explorer. */
export function backupFolderName(date: Date, prefix = 'Ruzivo backup'): string {
  return `${prefix} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function readmeText(manifest: BackupManifest): string {
  const schools = manifest.summary.schools.map((s) => `${s.school_name} (${s.school_id.trim()})`).join(', ') || 'none';
  return [
    'RUZIVO BACKUP',
    '=============',
    '',
    `Made:        ${new Date(manifest.createdAt).toString()}`,
    `By:          ${manifest.createdBy ?? 'unknown'}`,
    `App version: ${manifest.appVersion}`,
    `Schools:     ${schools}`,
    `Learners:    ${manifest.summary.counts.learners}`,
    `Payments:    ${manifest.summary.counts.payments}`,
    '',
    'This folder is a complete copy of everything Ruzivo held on the computer',
    'it was made on: schools, learners, fees, payments, expenses, staff',
    'accounts and payroll.',
    '',
    'TO RESTORE IT',
    '  On a new computer: install Ruzivo, and on the first screen choose',
    '  "Restore from a backup", then pick this folder.',
    '  On a computer already using Ruzivo: sign in as an administrator, go to',
    '  Setup > Backup & restore > "Restore from a backup", and pick this folder.',
    '  Restoring REPLACES everything on that computer. Ruzivo saves a safety',
    '  copy of the current data first.',
    '',
    'KEEP IT SAFE',
    "  This folder holds learners' personal details, staff salaries and",
    '  sign-in details. Store it like you would store the school\'s cash book.',
    '',
    'DO NOT EDIT THE FILES',
    '  Every file is fingerprinted in manifest.json. If anything inside the',
    '  data folder changes, Ruzivo will refuse to restore it. The .xlsx file is',
    '  only a copy for reading in Excel - it is not used when restoring.',
    '',
  ].join('\r\n');
}
