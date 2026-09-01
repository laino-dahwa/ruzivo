import { NextResponse } from "next/server";
import { getPaymentsReport } from "../../../../../../repositories/report/getPaymentsReport";
import { getschool } from "../../../../../../repositories/school/read/getSchool";
import { generateReportPdf } from "../../../../../../lib/pdf/generateReportPdf";
import { formatCurrency } from "../../../../../../lib/currency";
import { parseReportDate, formatDateLabel, isPdfFormat } from "../../../../../../lib/reportRequest";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

export async function GET(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const { searchParams } = new URL(request.url);

        const { date, error } = parseReportDate(searchParams);
        if (error) {
            return NextResponse.json({ error }, { status: 400 });
        }

        const { rows, total } = await getPaymentsReport(school_id, date);

        if (isPdfFormat(searchParams)) {
            const schools = await getschool(school_id);
            const schoolName = schools[0]?.school_name ?? school_id;

            const pdf = await generateReportPdf({
                appName: "Ruzivo",
                schoolName,
                reportTitle: "Payments Report",
                dateLabel: formatDateLabel(date),
                generatedAtLabel: formatDateLabel(new Date().toISOString().slice(0, 10)),
                columns: [
                    { key: "date", label: "Date", width: 85 },
                    { key: "customer", label: "Customer", width: 150 },
                    { key: "class", label: "Class", width: 80 },
                    { key: "method", label: "Method", width: 85 },
                    { key: "amount", label: "Amount", width: 95, align: "right" },
                ],
                rows: rows.map((row) => ({
                    date: row.paid_at_local.slice(0, 10).split("-").reverse().join("/"),
                    customer: `${row.first_name} ${row.last_name}`,
                    class: row.class_name,
                    method: row.method_name,
                    amount: formatCurrency(row.amount),
                })),
                totalLabel: "TOTAL PAYMENTS",
                totalValue: formatCurrency(total),
                emptyMessage: "No payments found for the selected period.",
            });

            return new NextResponse(new Uint8Array(pdf), {
                status: 200,
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="payments-report-${date ?? "all-dates"}.pdf"`,
                },
            });
        }

        return NextResponse.json({ rows, total });
    } catch (error) {
        console.error("Payments Report Failed :", error);
        return NextResponse.json({ error: "Failed to generate payments report" }, { status: 500 });
    }
}
