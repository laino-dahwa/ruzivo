import { query } from "../db";
import { expenseWindowForPeriod, type ReportScope } from "./scope";

export type ResolvedExpenseScope = {
    scope: ReportScope;
    window: { start: string; end: string } | null;
    /** False when a period could not be turned into dates for expenses. */
    scoped: boolean;
};

/**
 * Works out which dates the expense half of a report should cover.
 *
 * Payments and unpaid fees reach a payment period through `charges`; expenses
 * carry only a date, with nothing linking them to a period. So a period-scoped
 * report dates its expenses by the calendar month that period names, inside the
 * academic year it belongs to.
 *
 * Returns `scoped: false` when the period is not named after a month — a school
 * running terms or quarters — so callers can say the expenses could not be
 * narrowed rather than showing every expense the school has ever recorded as
 * though it belonged to the period.
 *
 * Shared by the on-screen report and the downloadable one so both date a period
 * the same way.
 */
export async function resolveExpenseScope(
    school_id: string,
    scope: ReportScope,
    academicYearId: string | null,
): Promise<ResolvedExpenseScope> {
    if (!scope.paymentPeriodId) {
        return {
            scope,
            window: scope.start && scope.end ? { start: scope.start, end: scope.end } : null,
            scoped: true,
        };
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
