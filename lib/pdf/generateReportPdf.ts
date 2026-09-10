import PDFDocument from "pdfkit";

export type PdfColumn = {
    key: string;
    label: string;
    width: number;
    align?: "left" | "right";
};

export type ReportPdfOptions = {
    appName: string;
    /** Omitted where the underlying query is not scoped to a single school. */
    schoolName?: string;
    reportTitle: string;
    /** Omitted for listing exports that aren't scoped to a reporting period. */
    dateLabel?: string;
    generatedAtLabel: string;
    columns: PdfColumn[];
    rows: Record<string, string>[];
    /** Omitted for tables that have no meaningful total (e.g. a learner list). */
    totalLabel?: string;
    totalValue?: string;
    emptyMessage?: string;
};

/** One table inside a combined report. */
export type PdfSection = {
    title: string;
    columns: PdfColumn[];
    rows: Record<string, string>[];
    totalLabel?: string;
    totalValue?: string;
    emptyMessage?: string;
};

export type CombinedReportPdfOptions = {
    appName: string;
    schoolName?: string;
    reportTitle: string;
    dateLabel?: string;
    generatedAtLabel: string;
    /** The headline figures, printed above the tables. */
    summary: { label: string; value: string; emphasis?: boolean }[];
    sections: PdfSection[];
    /** Explains any caveat about the window, e.g. how expenses were scoped. */
    footnote?: string;
};

type Doc = PDFKit.PDFDocument;

const ROW_HEIGHT = 18;

/**
 * Everything both entry points share: the same page setup, header, table
 * drawing and footer, so a combined report cannot drift from the single-table
 * exports it is assembled from.
 */
function createDocument(): { doc: Doc; chunks: Buffer[] } {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    return { doc, chunks };
}

function pageWidthOf(doc: Doc) {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function drawHeader(doc: Doc, options: Pick<ReportPdfOptions, "appName" | "schoolName" | "reportTitle" | "dateLabel" | "generatedAtLabel">) {
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#000").text(options.appName);
    if (options.schoolName) {
        doc.font("Helvetica").fontSize(11).fillColor("#555").text(options.schoolName);
    }
    doc.moveDown(0.7);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#000").text(options.reportTitle.toUpperCase());
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9).fillColor("#333");
    if (options.dateLabel) {
        doc.text(`Reporting Period: ${options.dateLabel}`);
    }
    doc.text(`Generated: ${options.generatedAtLabel}`);
    doc.moveDown(0.9);
    return doc.y;
}

/**
 * Draws one table and returns the y it finished at. `columns` is passed rather
 * than closed over so the header repeated on each new page belongs to the
 * table actually being drawn — a combined report has several.
 */
function drawTable(
    doc: Doc,
    startY: number,
    section: Pick<PdfSection, "columns" | "rows" | "totalLabel" | "totalValue" | "emptyMessage">,
): number {
    const startX = doc.page.margins.left;
    const pageWidth = pageWidthOf(doc);
    let y = startY;

    const drawRowAt = (values: string[], atY: number, opts: { bold?: boolean; bg?: string } = {}) => {
        if (opts.bg) {
            doc.rect(startX, atY, pageWidth, ROW_HEIGHT).fill(opts.bg);
        }
        doc.fillColor("#000").font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
        let x = startX;
        section.columns.forEach((col, i) => {
            doc.text(values[i] ?? "", x + 4, atY + 5, { width: col.width - 8, align: col.align ?? "left" });
            x += col.width;
        });
    };

    const headerLabels = section.columns.map((c) => c.label);

    // Repeats the column header at the top of every new page so a reader
    // never has to flip back to page 1 to know what a column means.
    const ensureSpace = (needed: number) => {
        if (y + needed > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            y = doc.page.margins.top;
            drawRowAt(headerLabels, y, { bold: true, bg: "#eeeeee" });
            y += ROW_HEIGHT;
        }
    };

    drawRowAt(headerLabels, y, { bold: true, bg: "#eeeeee" });
    y += ROW_HEIGHT;

    if (section.rows.length === 0) {
        ensureSpace(24);
        doc.font("Helvetica-Oblique").fontSize(9).fillColor("#666").text(section.emptyMessage ?? "No records found.", startX, y + 6);
        y += 24;
    } else {
        section.rows.forEach((row) => {
            ensureSpace(ROW_HEIGHT);
            drawRowAt(section.columns.map((c) => row[c.key] ?? ""), y);
            y += ROW_HEIGHT;
        });
    }

    y += 6;
    ensureSpace(26);
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor("#cccccc").stroke();
    y += 8;

    const line = section.totalLabel !== undefined && section.totalValue !== undefined
        ? `${section.totalLabel}: ${section.totalValue}`
        // Keeps the row count visible on listing exports, which have no
        // monetary total to summarise.
        : `Records: ${section.rows.length}`;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(line, startX, y);

    return y + 18;
}

function drawFooters(doc: Doc) {
    // Footers are drawn inside the bottom margin, which PDFKit otherwise
    // treats as an overflow and silently appends a spurious blank page for.
    // Zeroing the margin just for this call (standard PDFKit workaround)
    // avoids that.
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        const bottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(8).fillColor("#888888").text(
            `Page ${i + 1} of ${pageCount}`,
            doc.page.margins.left,
            doc.page.height - bottomMargin + 12,
            { width: pageWidthOf(doc), align: "center" }
        );
        doc.page.margins.bottom = bottomMargin;
    }
}

export function generateReportPdf(options: ReportPdfOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const { doc, chunks } = createDocument();
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const y = drawHeader(doc, options);
        drawTable(doc, y, options);
        drawFooters(doc);

        doc.end();
    });
}

/**
 * One document covering a whole reporting window: the headline figures, then
 * every table behind them.
 *
 * Built on the same header, table and footer routines as the single-table
 * exports, so a figure cannot read one way in the combined report and another
 * in the individual one.
 */
export function generateCombinedReportPdf(options: CombinedReportPdfOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const { doc, chunks } = createDocument();
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const startX = doc.page.margins.left;
        const pageWidth = pageWidthOf(doc);
        let y = drawHeader(doc, options);

        // --- headline figures -------------------------------------------
        const summaryHeight = 22 + options.summary.length * 20;
        doc.rect(startX, y, pageWidth, summaryHeight).fillAndStroke("#f6f4f1", "#dddddd");
        let summaryY = y + 12;
        options.summary.forEach((entry) => {
            doc.font(entry.emphasis ? "Helvetica-Bold" : "Helvetica")
                .fontSize(entry.emphasis ? 11 : 10)
                .fillColor("#000")
                .text(entry.label, startX + 12, summaryY, { width: pageWidth / 2 });
            doc.font("Helvetica-Bold")
                .fontSize(entry.emphasis ? 12 : 10)
                .fillColor("#000")
                .text(entry.value, startX + pageWidth / 2, summaryY, { width: pageWidth / 2 - 12, align: "right" });
            summaryY += 20;
        });
        y += summaryHeight + 18;

        if (options.footnote) {
            doc.font("Helvetica-Oblique").fontSize(8).fillColor("#666")
                .text(options.footnote, startX, y, { width: pageWidth });
            y = doc.y + 14;
        }

        // --- each table --------------------------------------------------
        options.sections.forEach((section) => {
            // A section title alone at the foot of a page reads as a heading
            // for the wrong table, so it moves with its header and first row.
            if (y + ROW_HEIGHT * 3 > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
                y = doc.page.margins.top;
            }
            doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text(section.title, startX, y);
            y += 20;
            y = drawTable(doc, y, section) + 12;
        });

        drawFooters(doc);
        doc.end();
    });
}
