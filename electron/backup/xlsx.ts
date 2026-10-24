import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { BackupManifest } from './format';

// Sign-in secrets have no business in a spreadsheet someone might email to
// the accountant; the restorable copy in data/ still has them.
const HIDDEN_COLUMN = /hash|token|secret/i;
// Image bytes are meaningless in a cell.
const HIDDEN_TABLES = new Set(['school_logos', 'school_logo_renditions']);

function cellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

/**
 * The same data as data/*.jsonl, one sheet per table, for reading in Excel.
 * Purely a convenience: restoring never looks at it.
 */
export async function writeReadableCopy(backupDir: string, manifest: BackupManifest, outFile: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(manifest.createdAt);

  for (const table of manifest.tables) {
    if (HIDDEN_TABLES.has(table.name)) continue;
    const columns = table.columns.filter((column) => !HIDDEN_COLUMN.test(column));
    const sheet = workbook.addWorksheet(table.name.slice(0, 31));
    sheet.columns = columns.map((column) => ({ header: column, key: column, width: Math.min(Math.max(column.length + 2, 12), 40) }));
    sheet.getRow(1).font = { bold: true };

    const body = await readFile(path.join(backupDir, table.file), 'utf8');
    for (const line of body.split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      sheet.addRow(Object.fromEntries(columns.map((column) => [column, cellValue(row[column])])));
    }
  }

  await workbook.xlsx.writeFile(outFile);
}
