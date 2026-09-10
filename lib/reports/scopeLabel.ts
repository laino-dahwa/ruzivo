import { query } from "../db";
import { formatDateLabel } from "../reportRequest";
import type { ReportScope } from "./scope";

/**
 * What a report's PDF says it covers.
 *
 * Reports used to accept only a single date, so the PDFs printed that date (or
 * "All Dates"). A range or a period both leave that date null, which would head
 * a filtered document "All Dates" — a report claiming to cover everything while
 * showing a subset. The label is therefore derived from the whole scope.
 */
export async function reportScopeLabel(school_id: string, scope: ReportScope): Promise<string> {
    if (scope.paymentPeriodId) {
        const result = await query(
            `SELECT period_name FROM payment_periods WHERE payment_period_id = $1 AND school_id = $2`,
            [scope.paymentPeriodId, school_id]
        );
        const name = result.rows[0]?.period_name as string | undefined;
        // The PDF template already prefixes "Reporting Period:".
        return name ? `${name} (payment period)` : "Selected payment period";
    }

    if (scope.start && scope.end) {
        return scope.start === scope.end
            ? formatDateLabel(scope.start)
            : `${formatDateLabel(scope.start)} – ${formatDateLabel(scope.end)}`;
    }
    if (scope.start) return `From ${formatDateLabel(scope.start)}`;
    if (scope.end) return `Up to ${formatDateLabel(scope.end)}`;

    return "All Dates";
}
