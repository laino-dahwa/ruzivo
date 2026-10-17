import { getDesktopBridge } from '../lib/platform';
import { errorMessageFor } from './http';
import { localDateKey } from '../lib/dates';

/**
 * Fetches any downloadable file from an API route and saves it. The single
 * place the browser download and the Electron native "Save As" dialog
 * diverge — every file download in the app (PDFs, the data export) goes
 * through here.
 */
export async function downloadFileFrom(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await errorMessageFor(response));
  const blob = await response.blob();

  const desktop = getDesktopBridge();
  if (desktop) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await desktop.saveFile(filename, bytes);
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Fetches a PDF from an API route that supports `?format=pdf` and saves it. */
export const downloadPdfFrom = downloadFileFrom;

/** `learners` -> `learners-2026-09-07.pdf`, matching the server's filename. */
export function datedPdfName(stem: string): string {
  return `${stem}-${localDateKey()}.pdf`;
}

/** `sch1-export` -> `sch1-export-2026-09-07.xlsx`. */
export function datedFileName(stem: string, extension: string): string {
  return `${stem}-${localDateKey()}.${extension}`;
}
