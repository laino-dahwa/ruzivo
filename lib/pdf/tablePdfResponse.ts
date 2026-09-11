import { NextResponse } from "next/server";
import { generateReportPdf, type PdfColumn } from "./generateReportPdf";
import { formatDateLabel } from "../reportRequest";

export type TablePdfOptions = {
    /** Shown as the document heading, e.g. "Learners List". */
    title: string;
    /** Download filename without the date suffix, e.g. "learners". */
    filenameStem: string;
    /** Only set where the underlying query really is scoped to one school. */
    schoolName?: string;
    columns: PdfColumn[];
    rows: Record<string, string>[];
    totalLabel?: string;
    totalValue?: string;
    emptyMessage?: string;
};

/**
 * Wraps generateReportPdf — the same generator the Reports section uses — for
 * the table exports on the Learners/Payments/Owing/Expenses pages, so all PDF
 * output in the app comes from one implementation with one look.
 */
export async function tablePdfResponse(options: TablePdfOptions): Promise<NextResponse> {
    const generatedOn = new Date().toISOString().slice(0, 10);

    const pdf = await generateReportPdf({
        appName: "SSV Admin",
        schoolName: options.schoolName,
        reportTitle: options.title,
        generatedAtLabel: formatDateLabel(generatedOn),
        columns: options.columns,
        rows: options.rows,
        totalLabel: options.totalLabel,
        totalValue: options.totalValue,
        emptyMessage: options.emptyMessage,
    });

    return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${options.filenameStem}-${generatedOn}.pdf"`,
        },
    });
}
