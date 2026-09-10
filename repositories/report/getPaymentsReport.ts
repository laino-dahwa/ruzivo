import { query } from "../../lib/db";
import { REPORT_TIMEZONE } from "../../lib/reportTimezone";
import { periodFilter, scopeParams, timestampWindow, type ReportScope } from "../../lib/reports/scope";

export type PaymentReportRow = {
    payment_id: number;
    paid_at_local: string;
    learner_id: string;
    first_name: string;
    last_name: string;
    class_name: string;
    income_name: string;
    method_name: string;
    amount: string;
};

const WHERE = `
    l.school_id = $1
    AND ${timestampWindow("p.paid_at")}
    AND ${periodFilter()}
`;

export async function getPaymentsReport(school_id: string, scope: ReportScope) {
    const params = [...scopeParams(school_id, scope), REPORT_TIMEZONE];

    const rowsResult = await query(
        `
        SELECT
            p.payment_id,
            ((p.paid_at AT TIME ZONE $5)::timestamp)::text AS paid_at_local,
            l.learner_id,
            l.first_name,
            l.last_name,
            ca.class_name,
            ic.income_name,
            pm.method_name,
            p.amount
        FROM learners l
        JOIN charges c ON l.learner_id = c.learner_id
        JOIN enrolments e ON e.enrolment_id = c.enrolment_id
        JOIN class_categories ca ON ca.class_category_id = e.class_category_id
        JOIN income_categories ic ON ic.income_category_id = c.income_category_id
        JOIN payment_allocations pa ON pa.charge_id = c.charge_id
        JOIN payments p ON p.payment_id = pa.payment_id
        JOIN payment_methods pm ON pm.payment_method_id = p.payment_method_id
        WHERE ${WHERE}
        ORDER BY p.paid_at ASC
        `,
        params
    );

    // A payment can, in principle, be allocated across more than one charge, which
    // would make it appear once per allocation above. The total must count each
    // payment exactly once, so it's computed separately over distinct payments.
    const totalResult = await query(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM (
            SELECT DISTINCT p.payment_id, p.amount
            FROM payments p
            JOIN payment_allocations pa ON pa.payment_id = p.payment_id
            JOIN charges c ON c.charge_id = pa.charge_id
            JOIN learners l ON l.learner_id = c.learner_id
            WHERE ${WHERE}
        ) AS distinct_payments
        `,
        params
    );

    return {
        rows: rowsResult.rows as PaymentReportRow[],
        total: Number(totalResult.rows[0]?.total ?? 0),
    };
}
