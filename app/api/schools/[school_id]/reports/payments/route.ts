import { NextResponse } from "next/server";
import { getPaymentsReport } from "../../../../../../repositories/report/getPaymentsReport";
import { getSchoolLogo } from "../../../../../../repositories/school/logo/schoolLogo";
import { getschool } from "../../../../../../repositories/school/read/getSchool";
import { generateReportPdf } from "../../../../../../lib/pdf/generateReportPdf";
import { formatCurrency } from "../../../../../../lib/currency";
import { parseReportDate, parseReportScope, formatDateLabel, isPdfFormat } from "../../../../../../lib/reportRequest";
import { reportScopeLabel } from "../../../../../../lib/reports/scopeLabel";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

export async function GET(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const { searchParams } = new URL(request.url);

        const { date, error } = parseReportDate(searchParams);
        const { scope } = parseReportScope(searchParams);
        if (error) {
            return NextResponse.json({ error }, { status: 400 });
        }

        const { rows, total } = await getPaymentsReport(school_id, scope!);

        if (isPdfFormat(searchParams)) {
            const [schools, logo] = await Promise.all([
                getschool(school_id),
                getSchoolLogo(school_id, { size: 128 }),
            ]);
            const schoolName = schools[0]?.school_name ?? school_id;

            const pdf = await generateReportPdf({
                appName: "Ruzivo",
                schoolName,
                logo: logo?.data ?? null,
                reportTitle: "Payments Report",
                dateLabel: await reportScopeLabel(school_id, scope!),
                generatedAtLabel: formatDateLabel(new Date().toISOString().slice(0, 10)),
                columns: [
                    { key: "date", label: "Date", width: 75 },
                    { key: "customer", label: "Customer", width: 130 },
                    { key: "class", label: "Class", width: 62 },
                    // Which fee the money was paid towards — already fetched
                    // for the on-screen table, previously dropped from the PDF.
                    { key: "income", label: "Income", width: 90 },
                    { key: "method", label: "Method", width: 70 },
                    { key: "amount", label: "Amount", width: 88, align: "right" },
                ],
                rows: rows.map((row) => ({
                    date: row.paid_at_local.slice(0, 10).split("-").reverse().join("/"),
                    customer: `${row.first_name} ${row.last_name}`,
                    class: row.class_name,
                    income: row.income_name,
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
