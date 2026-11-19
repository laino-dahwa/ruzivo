import { query } from "../../lib/db";
import { REPORT_TIMEZONE } from "../../lib/reportTimezone";
import { periodFilter, scopeParams, timestampWindow, type ReportScope } from "../../lib/reports/scope";
import { PAID_TOWARD_FEE } from "../payment/read/paidTowardFee";

export type OwingReportRow = {
    charge_id: number;
    charge_date: string;
    learner_id: string;
    first_name: string;
    last_name: string;
    class_name: string;
    income_name: string;
    period_name: string;
    academic_year_name: string;
    expected: string;
    paid: string;
    balance: string;
    status: "Unpaid" | "Partially Paid";
};

// One row per accepted fee (fee_decisions, migration 015) not yet paid in
// full: the same balances the Balances page shows (getBalances), which is the
// single source of truth for what is owed. Fees the system only suggests
// (Expected fees) are not owed and never appear here.
//
// A date-scoped report covers fees accepted in that window: `charge_date` is
// the day the fee was accepted, by someone pressing Accept or by its first
// payment. `charge_id` keeps its name for the report's consumers; it is the
// fee decision's id.
const OWING_CTE = `
    WITH owing AS (
        SELECT
            fd.fee_decision_id AS charge_id,
            ((fd.decided_at AT TIME ZONE $5)::date)::text AS charge_date,
            l.learner_id,
            l.first_name,
            l.last_name,
            ca.class_name,
            ic.income_name,
            pp.period_name,
            ay.academic_year_name,
            COALESCE(fd.amount, ic.income_limit) AS expected,
            COALESCE(paid.total, 0) AS paid,
            COALESCE(fd.amount, ic.income_limit) - COALESCE(paid.total, 0) AS balance
        FROM fee_decisions fd
        JOIN learners l ON l.learner_id = fd.learner_id
        JOIN income_categories ic ON ic.income_category_id = fd.income_category_id
        JOIN payment_periods pp ON pp.payment_period_id = fd.payment_period_id
        JOIN academic_years ay ON ay.academic_year_id = fd.academic_year_id
        LEFT JOIN enrolments e ON e.learner_id = fd.learner_id AND e.academic_year_id = fd.academic_year_id
        LEFT JOIN class_categories ca ON ca.class_category_id = e.class_category_id
        ${PAID_TOWARD_FEE}
        WHERE fd.school_id = $1
          AND fd.decision = 'ACCEPTED'
          AND ${timestampWindow("fd.decided_at")}
          AND ${periodFilter("fd.payment_period_id")}
          AND COALESCE(fd.amount, ic.income_limit) - COALESCE(paid.total, 0) > 0
    )
`;

export async function getOwingReport(school_id: string, scope: ReportScope) {
    const params = [...scopeParams(school_id, scope), REPORT_TIMEZONE];

    const rowsResult = await query(
        `
        ${OWING_CTE}
        SELECT *
        FROM owing
        ORDER BY charge_date ASC, learner_id ASC
        `,
        params
    );

    const totalResult = await query(
        `
        ${OWING_CTE}
        SELECT COALESCE(SUM(balance), 0) AS total
        FROM owing
        `,
        params
    );

    const rows: OwingReportRow[] = rowsResult.rows.map((row) => ({
        ...row,
        status: Number(row.paid) > 0 ? "Partially Paid" : "Unpaid",
    }));

    return {
        rows,
        total: Number(totalResult.rows[0]?.total ?? 0),
    };
}
