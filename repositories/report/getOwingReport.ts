import { query } from "../../lib/db";
import { REPORT_TIMEZONE } from "../../lib/reportTimezone";

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

const OWING_CTE = `
    WITH owing AS (
        SELECT
            c.charge_id,
            ((c.created_at AT TIME ZONE $3)::date)::text AS charge_date,
            l.learner_id,
            l.first_name,
            l.last_name,
            ca.class_name,
            ic.income_name,
            pp.period_name,
            ay.academic_year_name,
            ic.income_limit AS expected,
            COALESCE(SUM(p.amount), 0) AS paid,
            ic.income_limit - COALESCE(SUM(p.amount), 0) AS balance
        FROM learners l
        JOIN charges c ON c.learner_id = l.learner_id
        JOIN enrolments e ON e.enrolment_id = c.enrolment_id
        JOIN class_categories ca ON ca.class_category_id = e.class_category_id
        JOIN income_categories ic ON ic.income_category_id = c.income_category_id
        JOIN payment_periods pp ON pp.payment_period_id = c.payment_period_id
        JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id
        LEFT JOIN payment_allocations pa ON pa.charge_id = c.charge_id
        LEFT JOIN payments p ON p.payment_id = pa.payment_id
        WHERE l.school_id = $1
          AND ($2::date IS NULL OR (c.created_at AT TIME ZONE $3)::date = $2::date)
        GROUP BY
            c.charge_id, l.learner_id, l.first_name, l.last_name,
            ca.class_name, ic.income_name, ic.income_limit,
            pp.period_name, ay.academic_year_name
        HAVING ic.income_limit - COALESCE(SUM(p.amount), 0) > 0
    )
`;

export async function getOwingReport(school_id: string, report_date: string | null) {
    const rowsResult = await query(
        `
        ${OWING_CTE}
        SELECT *
        FROM owing
        ORDER BY charge_date ASC, learner_id ASC
        `,
        [school_id, report_date, REPORT_TIMEZONE]
    );

    const totalResult = await query(
        `
        ${OWING_CTE}
        SELECT COALESCE(SUM(balance), 0) AS total
        FROM owing
        `,
        [school_id, report_date, REPORT_TIMEZONE]
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
