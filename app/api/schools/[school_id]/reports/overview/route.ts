import { NextResponse } from "next/server";
import { parseReportScope } from "../../../../../../lib/reportRequest";
import { resolveExpenseScope } from "../../../../../../lib/reports/expenseScope";
import { getReportSummary } from "../../../../../../repositories/report/getReportSummary";
import { getPaymentsReport } from "../../../../../../repositories/report/getPaymentsReport";
import { getOwingReport } from "../../../../../../repositories/report/getOwingReport";
import { getExpensesReport } from "../../../../../../repositories/report/getExpensesReport";
import { getReportBreakdown } from "../../../../../../repositories/report/getReportBreakdown";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

/**
 * A whole report in one request: the headline totals, the three tables, and the
 * figures behind the charts, all for the same window.
 *
 * Assembled here rather than left to five calls from the page so every part of
 * a report is guaranteed to describe the same window — five separate requests
 * can straddle a change and disagree with each other.
 */
export async function GET(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const { searchParams } = new URL(request.url);

        const { scope, error } = parseReportScope(searchParams);
        if (error || !scope) {
            return NextResponse.json({ error }, { status: 400 });
        }

        // Payments and owing reach a period through `charges`; expenses cannot,
        // so a period-scoped report gives them the calendar window that period
        // names instead.
        const expenseScope = await resolveExpenseScope(school_id, scope, searchParams.get("academic_year_id"));

        const [summary, payments, owing, expenses, breakdown] = await Promise.all([
            getReportSummary(school_id, scope, expenseScope.scope),
            getPaymentsReport(school_id, scope),
            getOwingReport(school_id, scope),
            getExpensesReport(school_id, expenseScope.scope),
            getReportBreakdown(school_id, scope, expenseScope.scope),
        ]);

        return NextResponse.json({
            scope,
            expenseWindow: expenseScope.window,
            expensesScopedByPeriod: expenseScope.scoped,
            summary,
            payments,
            owing,
            expenses,
            breakdown,
        });
    } catch (error) {
        console.error("Report Overview Failed :", error);
        return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
    }
}
