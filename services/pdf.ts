import { getDesktopBridge } from '../lib/platform';
import { errorMessageFor } from './http';

/**
 * Fetches a PDF from an API route that supports `?format=pdf` and saves it.
 * The single place the browser download and the Electron native "Save As"
 * dialog diverge — every PDF button in the app goes through here.
 */
export async function downloadPdfFrom(url: string, filename: string): Promise<void> {
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

/** `learners` -> `learners-2026-09-07.pdf`, matching the server's filename. */
export function datedPdfName(stem: string): string {
  return `${stem}-${new Date().toISOString().slice(0, 10)}.pdf`;
}
