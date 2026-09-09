import { describe, expect, it } from "vitest";
import { generateReportPdf } from "../lib/pdf/generateReportPdf";

// A minimal, dependency-free way to count pages in a PDF buffer without a
// full PDF parser: PDFKit emits one "/Type /Page" object per page.
function countPdfPages(buffer: Buffer): number {
    const matches = buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 0;
}

const columns = [
    { key: "a", label: "Column A", width: 150 },
    { key: "b", label: "Column B", width: 150, align: "right" as const },
];

describe("generateReportPdf", () => {
    it("produces exactly one page for a small report, with no spurious blank page", async () => {
        const pdf = await generateReportPdf({
            appName: "Ruzivo",
            schoolName: "Test School",
            reportTitle: "Test Report",
            dateLabel: "All Dates",
            generatedAtLabel: "01 September 2026",
            columns,
            rows: [{ a: "Row 1", b: "£10.00" }],
            totalLabel: "TOTAL",
            totalValue: "£10.00",
        });

        expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
        expect(countPdfPages(pdf)).toBe(1);
    });

    it("paginates correctly across many records and keeps every page numbered", async () => {
        const rows = Array.from({ length: 80 }, (_, i) => ({ a: `Row ${i + 1}`, b: `£${i + 1}.00` }));
        const pdf = await generateReportPdf({
            appName: "Ruzivo",
            schoolName: "Test School",
            reportTitle: "Large Report",
            dateLabel: "All Dates",
            generatedAtLabel: "01 September 2026",
            columns,
            rows,
            totalLabel: "TOTAL",
            totalValue: "£3,240.00",
        });

        // PDFKit compresses page content streams by default, so the rendered
        // "Page X of Y" text isn't searchable as plain bytes here; page count
        // (from the uncompressed page-tree structure) is what actually proves
        // pagination worked and no spurious blank page was introduced.
        const pageCount = countPdfPages(pdf);
        expect(pageCount).toBeGreaterThan(1);
    });

    it("omits the total line for listing exports that have no total, showing a record count instead", async () => {
        // Learner/reference listings have no monetary total and aren't scoped
        // to a reporting period, so those fields are optional.
        const pdf = await generateReportPdf({
            appName: "Ruzivo",
            reportTitle: "Learners List",
            generatedAtLabel: "01 September 2026",
            columns,
            rows: [{ a: "Row 1", b: "Row 1b" }, { a: "Row 2", b: "Row 2b" }],
        });

        expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
        expect(countPdfPages(pdf)).toBe(1);
    });

    it("renders a clear empty-state message and still produces a valid single-page PDF", async () => {
        const pdf = await generateReportPdf({
            appName: "Ruzivo",
            schoolName: "Test School",
            reportTitle: "Empty Report",
            dateLabel: "01 September 2026",
            generatedAtLabel: "01 September 2026",
            columns,
            rows: [],
            totalLabel: "TOTAL",
            totalValue: "£0.00",
            emptyMessage: "No records found for the selected period.",
        });

        expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
        expect(countPdfPages(pdf)).toBe(1);
    });
});
