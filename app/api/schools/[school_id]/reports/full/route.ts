import { NextResponse } from "next/server";
import { formatDateLabel, parseReportScope } from "../../../../../../lib/reportRequest";
import { reportScopeLabel } from "../../../../../../lib/reports/scopeLabel";
import { resolveExpenseScope } from "../../../../../../lib/reports/expenseScope";
import { formatCurrency } from "../../../../../../lib/currency";
import { generateCombinedReportPdf } from "../../../../../../lib/pdf/generateReportPdf";
import { getschool } from "../../../../../../repositories/school/read/getSchool";
import { getReportSummary } from "../../../../../../repositories/report/getReportSummary";
import { getPaymentsReport } from "../../../../../../repositories/report/getPaymentsReport";
import { getOwingReport } from "../../../../../../repositories/report/getOwingReport";
import { getExpensesReport } from "../../../../../../repositories/report/getExpensesReport";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

/**
 * The whole reporting window as one PDF: the headline figures, then the
 * payments, expenses and unpaid fees behind them.
 *
 * Reads through the same repositories and the same scope as the on-screen
 * report, so the document cannot disagree with the page it was downloaded from.
 */
export async function GET(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const { searchParams } = new URL(request.url);

        const { scope, error } = parseReportScope(searchParams);
        if (error || !scope) {
            return NextResponse.json({ error }, { status: 400 });
        }

        const expenseScope = await resolveExpenseScope(school_id, scope, searchParams.get("academic_year_id"));

        const [schools, summary, payments, owing, expenses, dateLabel] = await Promise.all([
            getschool(school_id),
            getReportSummary(school_id, scope, expenseScope.scope),
            getPaymentsReport(school_id, scope),
            getOwingReport(school_id, scope),
            getExpensesReport(school_id, expenseScope.scope),
            reportScopeLabel(school_id, scope),
        ]);

        const pdf = await generateCombinedReportPdf({
            appName: "Ruzivo",
            schoolName: schools[0]?.school_name ?? school_id,
            reportTitle: "Financial Report",
            dateLabel,
            generatedAtLabel: formatDateLabel(new Date().toISOString().slice(0, 10)),
            summary: [
                { label: "Total revenue", value: formatCurrency(summary.totalPayments) },
                { label: "Total expenses", value: formatCurrency(summary.totalExpenses) },
                { label: "Net income", value: formatCurrency(summary.netPosition), emphasis: true },
                { label: "Outstanding (raised in this window)", value: formatCurrency(summary.totalOutstanding) },
            ],
            footnote: expenseFootnote(scope.paymentPeriodId !== null, expenseScope),
            sections: [
                {
                    title: "Payments",
                    columns: [
                        { key: "date", label: "Date", width: 75 },
                        { key: "customer", label: "Customer", width: 130 },
                        { key: "class", label: "Class", width: 62 },
                        { key: "income", label: "Income", width: 90 },
                        { key: "method", label: "Method", width: 70 },
                        { key: "amount", label: "Amount", width: 88, align: "right" },
                    ],
                    rows: payments.rows.map((row) => ({
                        date: row.paid_at_local.slice(0, 10).split("-").reverse().join("/"),
                        customer: `${row.first_name} ${row.last_name}`,
                        class: row.class_name,
                        income: row.income_name,
                        method: row.method_name,
                        amount: formatCurrency(row.amount),
                    })),
                    totalLabel: "TOTAL PAYMENTS",
                    totalValue: formatCurrency(payments.total),
                    emptyMessage: "No payments in this window.",
                },
                {
                    title: "Expenses",
                    columns: [
                        { key: "date", label: "Date", width: 85 },
                        { key: "category", label: "Category", width: 110 },
                        { key: "description", label: "Description", width: 220 },
                        { key: "amount", label: "Amount", width: 90, align: "right" },
                    ],
                    rows: expenses.rows.map((row) => ({
                        date: row.expense_date.slice(0, 10).split("-").reverse().join("/"),
                        category: row.category_name,
                        description: row.description ?? "",
                        amount: formatCurrency(row.amount),
                    })),
                    totalLabel: "TOTAL EXPENSES",
                    totalValue: formatCurrency(expenses.total),
                    emptyMessage: "No expenses in this window.",
                },
                {
                    title: "Owing",
                    columns: [
                        { key: "learner", label: "Learner", width: 115 },
                        { key: "income", label: "Income", width: 80 },
                        { key: "period", label: "Period", width: 65 },
                        { key: "expected", label: "Expected", width: 65, align: "right" },
                        { key: "paid", label: "Paid", width: 60, align: "right" },
                        { key: "balance", label: "Outstanding", width: 70, align: "right" },
                        { key: "status", label: "Status", width: 60 },
                    ],
                    rows: owing.rows.map((row) => ({
                        learner: `${row.first_name} ${row.last_name}`,
                        income: row.income_name,
                        period: row.period_name,
                        expected: formatCurrency(row.expected),
                        paid: formatCurrency(row.paid),
                        balance: formatCurrency(row.balance),
                        status: row.status,
                    })),
                    totalLabel: "TOTAL OUTSTANDING",
                    totalValue: formatCurrency(owing.total),
                    emptyMessage: "No unpaid fees were raised in this window.",
                },
            ],
        });

        return new NextResponse(new Uint8Array(pdf), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="financial-report.pdf"`,
            },
        });
    } catch (error) {
        console.error("Full Report Failed :", error);
        return NextResponse.json({ error: "Failed to generate the report" }, { status: 500 });
    }
}

/** Says how the expense half of a period report was dated, or that it could not be. */
function expenseFootnote(
    isPeriod: boolean,
    expenseScope: { window: { start: string; end: string } | null; scoped: boolean },
): string | undefined {
    if (!isPeriod) return undefined;
    if (!expenseScope.scoped || !expenseScope.window) {
        return "Expenses are omitted: an expense records a date, not a payment period, and this period is not a calendar month.";
    }
    return `Payments and amounts owed cover the selected payment period. Expenses carry no period, so they cover ${formatDateLabel(expenseScope.window.start)} to ${formatDateLabel(expenseScope.window.end)}.`;
}
