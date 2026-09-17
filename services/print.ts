import { getDesktopBridge } from '../lib/platform';

/**
 * Prints a standalone HTML document (see lib/receipt/buildReceiptHtml.ts).
 * Desktop routes it to the main process, which opens the OS print dialog
 * over a hidden window; the web build opens a plain popup window and calls
 * the browser's own print dialog on it.
 */
export async function printHtml(html: string): Promise<void> {
  const desktop = getDesktopBridge();
  if (desktop) {
    const result = await desktop.printReceipt(html);
    if (!result.ok) throw new Error(result.error ?? 'Printing failed');
    return;
  }

  const printWindow = window.open('', '_blank', 'width=400,height=640');
  if (!printWindow) {
    throw new Error('Could not open the print window — check your browser’s popup blocker.');
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Printing before every image has actually painted can clip the logo, so
  // this waits a tick for the (already-loaded, same-document) layout to
  // settle rather than firing on the synchronous write above.
  printWindow.onload = () => {
    printWindow.print();
    printWindow.close();
  };
}
