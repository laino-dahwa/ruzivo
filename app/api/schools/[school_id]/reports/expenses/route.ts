import { NextResponse } from "next/server";
import { getExpensesReport } from "../../../../../../repositories/report/getExpensesReport";
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

        const { rows, total } = await getExpensesReport(school_id, scope!);

        if (isPdfFormat(searchParams)) {
            const [schools, logo] = await Promise.all([
                getschool(school_id),
                getSchoolLogo(school_id, { size: 128 }),
            ]);
            const schoolName = schools[0]?.school_name ?? school_id;

            const pdf = await generateReportPdf({
                appName: "SSV Admin",
                schoolName,
                logo: logo?.data ?? null,
                reportTitle: "Expenses Report",
                dateLabel: await reportScopeLabel(school_id, scope!),
                generatedAtLabel: formatDateLabel(new Date().toISOString().slice(0, 10)),
                columns: [
                    { key: "date", label: "Date", width: 85 },
                    { key: "category", label: "Category", width: 110 },
                    { key: "description", label: "Description", width: 170 },
                    { key: "amount", label: "Amount", width: 90, align: "right" },
                ],
                rows: rows.map((row) => ({
                    date: row.expense_date.split("-").reverse().join("/"),
                    category: row.category_name,
                    description: row.description ?? "",
                    amount: formatCurrency(row.amount),
                })),
                totalLabel: "TOTAL EXPENSES",
                totalValue: formatCurrency(total),
                emptyMessage: "No expenses found for the selected period.",
            });

            return new NextResponse(new Uint8Array(pdf), {
                status: 200,
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="expenses-report-${date ?? "all-dates"}.pdf"`,
                },
            });
        }

        return NextResponse.json({ rows, total });
    } catch (error) {
        console.error("Expenses Report Failed :", error);
        return NextResponse.json({ error: "Failed to generate expenses report" }, { status: 500 });
    }
}
