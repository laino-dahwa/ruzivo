import PDFDocument from "pdfkit";

type Doc = PDFKit.PDFDocument;

export type StatementLine = {
  income_name: string;
  period_name: string;
  academic_year_name: string;
  charged: string;
  paid: string;
  balance: string;
};

export type StatementData = {
  lines: StatementLine[];
  totalCharged: string;
  totalPaid: string;
  totalBalance: string;
};

export type DocumentPdfOptions = {
  schoolName: string;
  schoolAddress?: string | null;
  schoolContact?: string | null;
  logo?: Buffer | null;
  title: string;
  reference: string;
  /** When the document was issued — not when this copy is being produced. */
  issuedAt: Date;
  issuedAtLabel: string;
  issuedByLabel: string;
  /** Addressee line, omitted for school-wide documents. */
  learnerLine?: string | null;
  /** The edited body, in the limited markup the editor produces. */
  bodyHtml: string;
  /** Present only for a statement of account; drawn as a locked table. */
  statement?: StatementData | null;
  signatoryName: string;
  signatoryTitle: string;
};

/* ------------------------------------------------------------------ *
 * A very small HTML subset parser.
 *
 * The editor is deliberately restricted to exactly what is handled here, so
 * what appears on screen is what comes out on paper. Anything unrecognised
 * degrades to plain text rather than being dropped, because silently losing
 * a paragraph of someone's letter is far worse than losing its styling.
 * ------------------------------------------------------------------ */

type Span = { text: string; bold: boolean; italic: boolean; underline: boolean };

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; spans: Span[]; align: Align }
  | { kind: "paragraph"; spans: Span[]; align: Align }
  | { kind: "list"; ordered: boolean; items: Span[][] };

type Align = "left" | "center" | "right";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name] ?? whole);
}

function alignOf(attributes: string): Align {
  if (/text-align:\s*center/i.test(attributes)) return "center";
  if (/text-align:\s*right/i.test(attributes)) return "right";
  return "left";
}

/** Splits inline markup into styled runs. */
function parseSpans(html: string): Span[] {
  const spans: Span[] = [];
  let bold = 0;
  let italic = 0;
  let underline = 0;
  let index = 0;

  const push = (text: string) => {
    const decoded = decodeEntities(text);
    if (decoded.length === 0) return;
    const last = spans[spans.length - 1];
    const style = { bold: bold > 0, italic: italic > 0, underline: underline > 0 };
    if (last && last.bold === style.bold && last.italic === style.italic && last.underline === style.underline) {
      last.text += decoded;
      return;
    }
    spans.push({ text: decoded, ...style });
  };

  while (index < html.length) {
    const next = html.indexOf("<", index);
    if (next === -1) {
      push(html.slice(index));
      break;
    }
    push(html.slice(index, next));

    const close = html.indexOf(">", next);
    if (close === -1) {
      push(html.slice(next));
      break;
    }

    const tag = html.slice(next + 1, close).trim();
    const name = tag.replace(/^\//, "").split(/[\s>]/)[0].toLowerCase();
    const closing = tag.startsWith("/");

    if (name === "br") {
      push("\n");
    } else if (name === "b" || name === "strong") {
      bold += closing ? -1 : 1;
    } else if (name === "i" || name === "em") {
      italic += closing ? -1 : 1;
    } else if (name === "u") {
      underline += closing ? -1 : 1;
    }

    index = close + 1;
  }

  return spans.filter((span) => span.text.length > 0);
}

export function parseBody(html: string): Block[] {
  const blocks: Block[] = [];
  // Matches one block-level element and its contents. Nested block elements
  // are not produced by the editor, so a non-greedy match to the matching
  // close tag is sufficient here.
  const pattern = /<(h1|h2|h3|p|ul|ol|div)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let consumedAnything = false;

  while ((match = pattern.exec(html)) !== null) {
    consumedAnything = true;
    const [, tag, attributes, inner] = match;
    const name = tag.toLowerCase();

    if (name === "ul" || name === "ol") {
      const items: Span[][] = [];
      const itemPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let item: RegExpExecArray | null;
      while ((item = itemPattern.exec(inner)) !== null) {
        items.push(parseSpans(item[1]));
      }
      if (items.length > 0) {
        blocks.push({ kind: "list", ordered: name === "ol", items });
      }
      continue;
    }

    const spans = parseSpans(inner);
    if (spans.length === 0) {
      continue;
    }

    if (name === "h1" || name === "h2" || name === "h3") {
      blocks.push({ kind: "heading", level: Number(name[1]) as 1 | 2 | 3, spans, align: alignOf(attributes) });
    } else {
      blocks.push({ kind: "paragraph", spans, align: alignOf(attributes) });
    }
  }

  // Content with no block tags at all (a pasted plain string) still has to
  // reach the page.
  if (!consumedAnything) {
    const spans = parseSpans(html);
    if (spans.length > 0) {
      blocks.push({ kind: "paragraph", spans, align: "left" });
    }
  }

  return blocks;
}

/* ------------------------------------------------------------------ *
 * Drawing
 * ------------------------------------------------------------------ */

const BODY_SIZE = 11;
const LINE_GAP = 3;

function fontFor(span: Span): string {
  if (span.bold && span.italic) return "Helvetica-BoldOblique";
  if (span.bold) return "Helvetica-Bold";
  if (span.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function contentWidth(doc: Doc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/**
 * Draws a run of styled spans as flowing text.
 *
 * pdfkit has no concept of mixed styling inside one `text()` call, so each
 * span is written with `continued: true` and the font swapped between them —
 * which is what keeps a bold word inside a sentence on the same line rather
 * than starting a new one.
 */
function drawSpans(doc: Doc, spans: Span[], options: { size: number; align: Align; indent?: number }) {
  const width = contentWidth(doc) - (options.indent ?? 0);
  const x = doc.page.margins.left + (options.indent ?? 0);

  spans.forEach((span, index) => {
    const isLast = index === spans.length - 1;
    doc
      .font(fontFor(span))
      .fontSize(options.size)
      .fillColor("#000")
      .text(span.text, x, doc.y, {
        width,
        align: options.align,
        continued: !isLast,
        underline: span.underline,
        lineGap: LINE_GAP,
      });
  });

  if (spans.length === 0) {
    doc.moveDown(0.5);
  }
}

function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 40) {
    doc.addPage();
  }
}

function drawLetterhead(doc: Doc, options: DocumentPdfOptions) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  let textLeft = left;

  if (options.logo) {
    try {
      doc.image(options.logo, left, doc.y, { fit: [54, 54] });
      textLeft = left + 66;
    } catch {
      // A logo that pdfkit cannot decode must not take the whole document
      // down with it — the letter matters more than the picture.
    }
  }

  const top = doc.y;
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#000").text(options.schoolName, textLeft, top, { width: width - (textLeft - left) });

  doc.font("Helvetica").fontSize(9).fillColor("#444");
  if (options.schoolAddress) {
    doc.text(options.schoolAddress, textLeft, doc.y, { width: width - (textLeft - left) });
  }
  if (options.schoolContact) {
    doc.text(options.schoolContact, textLeft, doc.y, { width: width - (textLeft - left) });
  }

  doc.y = Math.max(doc.y, top + (options.logo ? 54 : 0)) + 10;
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.2).strokeColor("#000").stroke();
  doc.y += 16;
}

function drawTitleBlock(doc: Doc, options: DocumentPdfOptions) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text(options.title.toUpperCase(), left, doc.y, { width, align: "center" });
  doc.moveDown(0.4);

  doc.font("Helvetica").fontSize(9).fillColor("#555");
  doc.text(`Ref: ${options.reference}`, left, doc.y, { width, align: "left", continued: true });
  doc.text(options.issuedAtLabel, { width, align: "right" });

  if (options.learnerLine) {
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(options.learnerLine, left, doc.y, { width });
  }

  doc.moveDown(1);
}

function drawBody(doc: Doc, bodyHtml: string) {
  for (const block of parseBody(bodyHtml)) {
    ensureSpace(doc, 60);

    if (block.kind === "heading") {
      doc.moveDown(0.5);
      drawSpans(doc, block.spans.map((span) => ({ ...span, bold: true })), {
        size: block.level === 1 ? 15 : block.level === 2 ? 13 : 12,
        align: block.align,
      });
      doc.moveDown(0.3);
      continue;
    }

    if (block.kind === "list") {
      block.items.forEach((item, index) => {
        ensureSpace(doc, 30);
        const marker = block.ordered ? `${index + 1}.` : "•";
        const markerX = doc.page.margins.left + 8;
        const top = doc.y;
        doc.font("Helvetica").fontSize(BODY_SIZE).fillColor("#000").text(marker, markerX, top, { width: 16 });
        doc.y = top;
        drawSpans(doc, item, { size: BODY_SIZE, align: "left", indent: 30 });
        doc.moveDown(0.15);
      });
      doc.moveDown(0.4);
      continue;
    }

    drawSpans(doc, block.spans, { size: BODY_SIZE, align: block.align });
    doc.moveDown(0.6);
  }
}

/**
 * The statement of account, drawn as a table rather than as editable text.
 *
 * These figures come straight from the charges and payments already
 * recorded, and are not part of the editable body — a statement handed to a
 * parent must never be able to disagree with what the system holds.
 */
function drawStatement(doc: Doc, statement: StatementData) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const columns = [
    { key: "income_name" as const, label: "Fee", width: width * 0.28, align: "left" as const },
    { key: "period_name" as const, label: "Period", width: width * 0.18, align: "left" as const },
    { key: "academic_year_name" as const, label: "Year", width: width * 0.14, align: "left" as const },
    { key: "charged" as const, label: "Charged", width: width * 0.13, align: "right" as const },
    { key: "paid" as const, label: "Paid", width: width * 0.13, align: "right" as const },
    { key: "balance" as const, label: "Balance", width: width * 0.14, align: "right" as const },
  ];

  ensureSpace(doc, 120);
  doc.moveDown(0.4);

  const headerY = doc.y;
  doc.rect(left, headerY - 2, width, 18).fillColor("#eeeeee").fill();
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(9);

  let x = left;
  for (const column of columns) {
    doc.text(column.label, x + 4, headerY + 3, { width: column.width - 8, align: column.align });
    x += column.width;
  }
  doc.y = headerY + 20;

  doc.font("Helvetica").fontSize(9);
  for (const line of statement.lines) {
    ensureSpace(doc, 40);
    const rowY = doc.y;
    x = left;
    for (const column of columns) {
      doc.fillColor("#000").text(String(line[column.key] ?? ""), x + 4, rowY, { width: column.width - 8, align: column.align });
      x += column.width;
    }
    doc.y = rowY + 15;
    doc.moveTo(left, doc.y - 3).lineTo(left + width, doc.y - 3).lineWidth(0.4).strokeColor("#cccccc").stroke();
  }

  if (statement.lines.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#666").text("No charges recorded.", left + 4, doc.y);
    doc.y += 16;
  }

  ensureSpace(doc, 40);
  const totalY = doc.y + 2;
  doc.moveTo(left, totalY).lineTo(left + width, totalY).lineWidth(1).strokeColor("#000").stroke();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");

  x = left;
  const totals: Record<string, string> = {
    income_name: "TOTAL",
    period_name: "",
    academic_year_name: "",
    charged: statement.totalCharged,
    paid: statement.totalPaid,
    balance: statement.totalBalance,
  };
  for (const column of columns) {
    doc.text(totals[column.key] ?? "", x + 4, totalY + 5, { width: column.width - 8, align: column.align });
    x += column.width;
  }

  doc.y = totalY + 24;
  doc.moveDown(1);
}

/**
 * The school seal, drawn rather than uploaded.
 *
 * There is no stored signature or stamp image anywhere in this app — an
 * image of either can be lifted out of a database or a PDF and pasted onto
 * anything. What makes a document here verifiable is the reference printed
 * beneath the seal, which is recorded against the issue history: a letter
 * can be checked by looking it up. The seal itself is presentation.
 */
function drawSeal(doc: Doc, centreX: number, centreY: number, options: DocumentPdfOptions) {
  const radius = 46;

  doc.save();
  doc.lineWidth(1.6).strokeColor("#1a3a6b");
  doc.circle(centreX, centreY, radius).stroke();
  doc.lineWidth(0.8);
  doc.circle(centreX, centreY, radius - 5).stroke();

  doc.fillColor("#1a3a6b").font("Helvetica-Bold").fontSize(7);
  doc.text(options.schoolName.toUpperCase(), centreX - radius + 8, centreY - 22, {
    width: (radius - 8) * 2,
    align: "center",
    lineGap: 0,
  });

  doc.font("Helvetica-Bold").fontSize(7.5);
  doc.text("* OFFICIAL *", centreX - radius + 8, centreY + 2, { width: (radius - 8) * 2, align: "center" });

  doc.font("Helvetica").fontSize(6.5);
  doc.text(options.issuedAtLabel, centreX - radius + 8, centreY + 14, { width: (radius - 8) * 2, align: "center" });

  doc.restore();
}

/**
 * Signature line, typed name and title, with the seal beside it.
 *
 * The line is left blank on purpose: documents are signed by hand.
 */
function drawSignature(doc: Doc, options: DocumentPdfOptions) {
  ensureSpace(doc, 170);

  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  doc.moveDown(2);
  const top = doc.y;

  const lineWidth = 200;
  const lineY = top + 46;
  doc.moveTo(left, lineY).lineTo(left + lineWidth, lineY).lineWidth(0.9).strokeColor("#000").stroke();

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(options.signatoryName, left, lineY + 6, { width: lineWidth });
  doc.font("Helvetica").fontSize(9).fillColor("#444").text(options.signatoryTitle, left, doc.y, { width: lineWidth });
  doc.font("Helvetica").fontSize(8).fillColor("#666").text(`For and on behalf of ${options.schoolName}`, left, doc.y + 2, { width: lineWidth });

  drawSeal(doc, left + width - 60, lineY + 4, options);

  doc.y = Math.max(doc.y, lineY + 70);
}

function drawVerificationFooter(doc: Doc, options: DocumentPdfOptions) {
  const range = doc.bufferedPageRange();

  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);

    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const y = doc.page.height - doc.page.margins.bottom - 24;

    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor("#cccccc").stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor("#666");
    doc.text(
      `Ref ${options.reference}  ·  Issued ${options.issuedAtLabel} by ${options.issuedByLabel}  ·  Verify this reference with the school office`,
      left,
      y + 6,
      { width, align: "left" }
    );
    doc.text(`Page ${index - range.start + 1} of ${range.count}`, left, y + 6, { width, align: "right" });
  }
}

export function renderDocumentPdf(options: DocumentPdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // bufferPages so the footer can be stamped onto every page once the
    // total page count is known.
    //
    // CreationDate is the moment the document was *issued*, not the moment
    // this copy is being produced. A reprint has to be the same document, and
    // a PDF that claims to have been created today would contradict the date
    // printed on its own face.
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: `${options.title} (${options.reference})`,
        Author: options.schoolName,
        Subject: options.reference,
        CreationDate: options.issuedAt,
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      drawLetterhead(doc, options);
      drawTitleBlock(doc, options);
      drawBody(doc, options.bodyHtml);

      if (options.statement) {
        drawStatement(doc, options.statement);
      }

      drawSignature(doc, options);
      drawVerificationFooter(doc, options);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
