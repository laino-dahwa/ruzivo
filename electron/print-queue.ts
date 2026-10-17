import { execFile } from 'node:child_process';

/**
 * Receipts must never pile up in the Windows print spooler. When the receipt
 * printer is unplugged or offline, webContents.print() still "succeeds" — the
 * job just sits in the spooler, and every stale receipt then comes out at once
 * whenever the printer is next connected. A receipt that didn't print at the
 * time of payment can always be reprinted from the payments table, so queued
 * receipts are discarded instead of kept.
 *
 * Every receipt job is spooled under this exact document name (set by the
 * print handler in main.ts), so the clean-up below only ever touches
 * Ruzivo's own receipts — never anything else in the user's print queues.
 */
export const RECEIPT_JOB_NAME = 'Ruzivo receipt';

// PrinterStatus / JobStatus values that mean the job isn't going to print
// any time soon. Both can be flag combinations ("Offline, Error"), hence
// a regex match rather than equality.
const PRINTER_DOWN = 'Offline|Error|NotAvailable|PaperOut|PaperJam|PaperProblem|UserIntervention|DoorOpen|NoToner|ServerUnknown|Paused';
const JOB_STUCK = 'Error|Offline|PaperOut|Blocked|UserIntervention|Paused';

/**
 * Removes Ruzivo receipt jobs from every local print queue.
 *
 * - `{ all: true }` removes every one (used at startup: anything still queued
 *   is from a previous session and must not print now).
 * - Otherwise removes those whose printer is down or whose job is in an error
 *   state, plus any submitted more than `staleAfterSeconds` ago — a receipt is
 *   tiny, so one still queued after that isn't reaching a printer.
 *
 * Windows-only and best-effort: resolves with the number removed, or 0 on any
 * failure, and never rejects — printing must not be blocked by clean-up.
 */
export function discardQueuedReceipts(options: { all: true } | { staleAfterSeconds: number }): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(0);

  const all = 'all' in options;
  const staleAfter = all ? 0 : Math.max(0, Math.floor(options.staleAfterSeconds));

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$cutoff = (Get-Date).AddSeconds(-${staleAfter})
$removed = 0
foreach ($printer in Get-Printer) {
  $printerDown = $printer.WorkOffline -or ("$($printer.PrinterStatus)" -match '${PRINTER_DOWN}')
  foreach ($job in Get-PrintJob -PrinterName $printer.Name) {
    if ($job.DocumentName -ne '${RECEIPT_JOB_NAME}') { continue }
    $drop = $${all ? 'true' : 'false'} -or $printerDown -or ("$($job.JobStatus)" -match '${JOB_STUCK}') -or ($job.SubmittedTime -lt $cutoff)
    if ($drop) {
      Remove-PrintJob -InputObject $job
      if ($?) { $removed++ }
    }
  }
}
Write-Output $removed
`;

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 30_000 },
      (error, stdout) => {
        if (error) {
          console.warn('[print-queue] could not clear queued receipts:', error.message);
          resolve(0);
          return;
        }
        const removed = Number.parseInt(stdout.trim(), 10) || 0;
        if (removed > 0) console.log(`[print-queue] discarded ${removed} queued receipt(s)`);
        resolve(removed);
      },
    );
  });
}

/**
 * Called after each receipt is handed to the spooler. A quick check catches a
 * printer that's offline or erroring; a later one catches a job that's simply
 * stuck (e.g. a USB printer that was unplugged but that Windows still reports
 * as ready).
 */
export function scheduleStuckReceiptCleanup(): void {
  setTimeout(() => void discardQueuedReceipts({ staleAfterSeconds: 60 }), 15_000).unref();
  setTimeout(() => void discardQueuedReceipts({ staleAfterSeconds: 60 }), 75_000).unref();
}
