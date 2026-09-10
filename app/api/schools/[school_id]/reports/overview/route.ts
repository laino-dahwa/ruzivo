import { NextResponse } from "next/server";
import { query } from "../../../../../../lib/db";
import { parseReportScope } from "../../../../../../lib/reportRequest";
import { expenseWindowForPeriod, type ReportScope } from "../../../../../../lib/reports/scope";
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

/**
 * Works out which dates the expense half of a period report should cover.
 * Returns `scoped: false` when the period is not named after a month, so the
 * page can say the expenses could not be narrowed rather than showing every
 * expense the school has ever recorded as though it belonged to the period.
 */
async function resolveExpenseScope(
    school_id: string,
    scope: ReportScope,
    academicYearId: string | null,
): Promise<{ scope: ReportScope; window: { start: string; end: string } | null; scoped: boolean }> {
    if (!scope.paymentPeriodId) {
        return { scope, window: scope.start && scope.end ? { start: scope.start, end: scope.end } : null, scoped: true };
    }

    const periodResult = await query(
        `SELECT period_name FROM payment_periods WHERE payment_period_id = $1 AND school_id = $2`,
        [scope.paymentPeriodId, school_id]
    );
    const periodName = periodResult.rows[0]?.period_name as string | undefined;

    const yearResult = await query(
        `
        SELECT start_date::text AS start_date, end_date::text AS end_date
        FROM academic_years
        WHERE school_id = $1
          AND ($2::bigint IS NULL OR academic_year_id = $2::bigint)
        ORDER BY start_date DESC
        LIMIT 1
        `,
        [school_id, academicYearId ? Number(academicYearId) : null]
    );
    const year = yearResult.rows[0] as { start_date: string; end_date: string } | undefined;

    if (!periodName || !year) {
        return { scope: { ...scope, start: null, end: null }, window: null, scoped: false };
    }

    const window = expenseWindowForPeriod(periodName, year.start_date, year.end_date);
    if (!window) {
        // A term or quarter: nothing in `expenses` says which one it belongs to.
        return { scope: { ...scope, start: null, end: null }, window: null, scoped: false };
    }

    return { scope: { ...scope, start: window.start, end: window.end }, window, scoped: true };
}
