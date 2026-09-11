import ExcelJS from "exceljs";

export type ExportSheet = {
  name: string;
  rows: Record<string, unknown>[];
};

/** `first_name` -> `First Name`, so a raw column name reads as a normal header. */
function titleCase(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Excel sheet names: 31 characters max, and none of these are allowed.
const UNSAFE_SHEET_NAME_CHARS = /[[\]:*?/\\]/g;

/**
 * One workbook, one worksheet per entry. Columns are inferred from the first
 * row's own keys — every sheet here comes from a single SQL query, so its
 * rows are already uniform — with an empty sheet getting a header-less
 * placeholder rather than being skipped, so the table it stands for is still
 * visible (just empty) in the download.
 */
export async function buildWorkbook(sheets: ExportSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  for (const sheet of sheets) {
    const safeName = sheet.name.replace(UNSAFE_SHEET_NAME_CHARS, "").slice(0, 31) || "Sheet";
    const worksheet = workbook.addWorksheet(safeName);

    const keys = sheet.rows.length > 0 ? Object.keys(sheet.rows[0]) : [];
    if (keys.length > 0) {
      worksheet.columns = keys.map((key) => ({
        header: titleCase(key),
        key,
        width: Math.max(12, titleCase(key).length + 2),
      }));
      worksheet.getRow(1).font = { bold: true };
      sheet.rows.forEach((row) => worksheet.addRow(row));
    } else {
      worksheet.addRow(["No data"]);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
