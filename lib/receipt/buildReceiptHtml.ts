export type ReceiptLine = {
  incomeName: string;
  periodName: string;
  /** Already formatted, e.g. "$120.00" — this module has no currency opinion of its own. */
  amountLabel: string;
};

export type ReceiptData = {
  schoolName: string;
  /** Fully-qualified (includes origin) — a relative URL has nothing to resolve against inside a printed document. */
  logoUrl: string | null;
  learnerName: string;
  learnerId: string;
  className: string;
  academicYearName: string;
  methodName: string;
  paidAt: string;
  /** One or more fees paid in this transaction — a bulk payment covering several fees prints as one receipt, not one per fee. */
  lines: ReceiptLine[];
  totalLabel: string;
  /** Shown as the receipt number — the first charge's id when there are several. */
  referenceId: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A standalone HTML document for one payment transaction — deliberately not
 * a React component, since it has to survive being handed to Electron's main
 * process as a plain string (loaded into a hidden window for printing) as
 * well as a plain `window.open` on the web. No fixed page width: a thermal
 * printer's driver dictates the physical paper width, so the layout just
 * fills whatever page it lands on rather than assuming 58mm vs 80mm.
 */
export function buildReceiptHtml(data: ReceiptData): string {
  const paidAtLabel = new Date(data.paidAt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const row = (label: string, value: string) => `
    <div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;

  const lineRows = data.lines.map((line) => `
    <div class="line">
      <div class="row"><span class="label">${escapeHtml(line.incomeName)}</span><span class="value">${escapeHtml(line.amountLabel)}</span></div>
      <div class="line-period">${escapeHtml(line.periodName)}</div>
    </div>`).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt</title>
<style>
  @page { margin: 4mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    width: 100%;
    font-family: 'Courier New', Consolas, monospace;
    font-size: 12px;
    /* Bold everywhere, pure black everywhere: a thermal head has no real
       greyscale — a lighter grey (#333/#555) or a normal (non-bold) stroke
       both come out as sparse, faint dots at this printer's resolution.
       Solid black, heavier strokes give the print head more ink to lay down. */
    font-weight: bold;
    color: #000;
  }
  .logo {
    display: block;
    max-width: 60%;
    max-height: 64px;
    margin: 0 auto 6px;
    /* The source logo is soft-edged and multi-toned (browns/creams) — in
       plain greyscale those become light-mid greys, which this printer's
       halftoning renders as too few dots to read. Pushing contrast hard
       forces most of it toward solid black or solid white before the
       driver ever dithers it, which is the only lever available here
       without pre-processing the image itself into a true 1-bit version. */
    filter: grayscale(1) contrast(220%) brightness(0.9);
  }
  .school-name { text-align: center; font-size: 14px; margin-bottom: 2px; }
  .title { text-align: center; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .divider { border: none; border-top: 2px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .label { color: #000; }
  .value { text-align: right; }
  .line { padding: 3px 0; }
  .line-period { font-size: 11px; color: #000; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 15px; }
  .footer { text-align: center; font-size: 11px; margin-top: 10px; color: #000; }
</style>
</head>
<body>
  ${data.logoUrl ? `<img class="logo" src="${escapeHtml(data.logoUrl)}" alt="" />` : ''}
  <div class="school-name">${escapeHtml(data.schoolName)}</div>
  <div class="title">Payment Receipt</div>
  <hr class="divider" />
  ${row('Receipt #', String(data.referenceId))}
  ${row('Date', paidAtLabel)}
  ${row('Learner', data.learnerName)}
  ${row('Learner ID', data.learnerId)}
  ${row('Class', data.className)}
  ${row('Academic Year', data.academicYearName)}
  ${row('Method', data.methodName)}
  <hr class="divider" />
  ${lineRows}
  <hr class="divider" />
  <div class="total-row"><span>TOTAL</span><span>${escapeHtml(data.totalLabel)}</span></div>
  <hr class="divider" />
  <div class="footer">Thank you</div>
</body>
</html>`;
}
