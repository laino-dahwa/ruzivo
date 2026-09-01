import PDFDocument from "pdfkit";

export type PdfColumn = {
    key: string;
    label: string;
    width: number;
    align?: "left" | "right";
};

export type ReportPdfOptions = {
    appName: string;
    schoolName: string;
    reportTitle: string;
    dateLabel: string;
    generatedAtLabel: string;
    columns: PdfColumn[];
    rows: Record<string, string>[];
    totalLabel: string;
    totalValue: string;
    emptyMessage?: string;
};

export function generateReportPdf(options: ReportPdfOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
        const chunks: Buffer[] = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const startX = doc.page.margins.left;
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const rowHeight = 18;

        doc.font("Helvetica-Bold").fontSize(18).fillColor("#000").text(options.appName);
        doc.font("Helvetica").fontSize(11).fillColor("#555").text(options.schoolName);
        doc.moveDown(0.7);
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#000").text(options.reportTitle.toUpperCase());
        doc.moveDown(0.3);
        doc.font("Helvetica").fontSize(9).fillColor("#333");
        doc.text(`Reporting Period: ${options.dateLabel}`);
        doc.text(`Generated: ${options.generatedAtLabel}`);
        doc.moveDown(0.9);

        let y = doc.y;

        const drawRowAt = (values: string[], atY: number, opts: { bold?: boolean; bg?: string } = {}) => {
            if (opts.bg) {
                doc.rect(startX, atY, pageWidth, rowHeight).fill(opts.bg);
            }
            doc.fillColor("#000").font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
            let x = startX;
            options.columns.forEach((col, i) => {
                doc.text(values[i] ?? "", x + 4, atY + 5, { width: col.width - 8, align: col.align ?? "left" });
                x += col.width;
            });
        };

        const headerLabels = options.columns.map((c) => c.label);

        // Repeats the column header at the top of every new page so a reader
        // never has to flip back to page 1 to know what a column means.
        const ensureSpace = (needed: number) => {
            if (y + needed > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
                y = doc.page.margins.top;
                drawRowAt(headerLabels, y, { bold: true, bg: "#eeeeee" });
                y += rowHeight;
            }
        };

        const drawRow = (values: string[], opts: { bold?: boolean; bg?: string } = {}) => {
            ensureSpace(rowHeight);
            drawRowAt(values, y, opts);
            y += rowHeight;
        };

        drawRowAt(headerLabels, y, { bold: true, bg: "#eeeeee" });
        y += rowHeight;

        if (options.rows.length === 0) {
            ensureSpace(24);
            doc.font("Helvetica-Oblique").fontSize(9).fillColor("#666").text(options.emptyMessage ?? "No records found.", startX, y + 6);
            y += 24;
        } else {
            options.rows.forEach((row) => {
                drawRow(options.columns.map((c) => row[c.key] ?? ""));
            });
        }

        y += 6;
        ensureSpace(26);
        doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor("#cccccc").stroke();
        y += 8;
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(`${options.totalLabel}: ${options.totalValue}`, startX, y);

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
                { width: pageWidth, align: "center" }
            );
            doc.page.margins.bottom = bottomMargin;
        }

        doc.end();
    });
}
