import { NextResponse } from "next/server";
import { getOwingReport } from "../../../../../../repositories/report/getOwingReport";
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

        const { rows, total } = await getOwingReport(school_id, scope!);

        if (isPdfFormat(searchParams)) {
            const schools = await getschool(school_id);
            const schoolName = schools[0]?.school_name ?? school_id;

            const pdf = await generateReportPdf({
                appName: "Ruzivo",
                schoolName,
                reportTitle: "Owing / Outstanding Report",
                dateLabel: await reportScopeLabel(school_id, scope!),
                generatedAtLabel: formatDateLabel(new Date().toISOString().slice(0, 10)),
                columns: [
                    { key: "learner", label: "Student", width: 115 },
                    { key: "account", label: "Account", width: 55 },
                    { key: "income", label: "Income", width: 75 },
                    { key: "expected", label: "Expected", width: 68, align: "right" },
                    { key: "paid", label: "Paid", width: 62, align: "right" },
                    { key: "balance", label: "Outstanding", width: 72, align: "right" },
                    { key: "status", label: "Status", width: 68 },
                ],
                rows: rows.map((row) => ({
                    learner: `${row.first_name} ${row.last_name}`,
                    account: row.learner_id,
                    income: row.income_name,
                    expected: formatCurrency(row.expected),
                    paid: formatCurrency(row.paid),
                    balance: formatCurrency(row.balance),
                    status: row.status,
                })),
                totalLabel: "TOTAL OUTSTANDING",
                totalValue: formatCurrency(total),
                emptyMessage: "No outstanding balances found for the selected period.",
            });

            return new NextResponse(new Uint8Array(pdf), {
                status: 200,
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="owing-report-${date ?? "all-dates"}.pdf"`,
                },
            });
        }

        return NextResponse.json({ rows, total });
    } catch (error) {
        console.error("Owing Report Failed :", error);
        return NextResponse.json({ error: "Failed to generate owing report" }, { status: 500 });
    }
}
