import { query } from "../../../lib/db";

/**
 * Balances per learner + fee + period + year — scoped to fees that have
 * actually been charged. A learner who has never been charged for a fee
 * (mandatory or optional) does not appear here, regardless of priority —
 * that's what the Unpaid Mandatory Payments page (repositories/payment/read/
 * getObligations.ts) is for. This one stays a straight reflection of real
 * charges/payments, which is also what the Record Payment form reads to
 * show how much of a fee is already paid.
 *
 * `only_outstanding` drops rows that are settled exactly. It is opt-in because
 * the Record Payment form reads these same rows to show how much of a fee is
 * already paid — a fully paid fee missing from the list would read there as
 * "nothing paid yet" and invite a duplicate payment.
 *
 * Overpaid rows (a negative balance, which a lowered fee limit can produce
 * after the fact) are deliberately kept: they are not settled, and hiding them
 * would bury the discrepancy.
 */
export async function getBalances(
    school_id: string,
    learner_id: string | null,
    class_name: string | null,
    gender_name: string | null,
    academic_year: string | null,
    income_name: string | null,
    payment_period: string | null,
    only_outstanding: boolean = false,
) {
    const result = await query(`
        SELECT
            l.learner_id,
            l.first_name,
            l.last_name,
            ic.income_name,
            ic.income_limit AS charged,
            COALESCE(SUM(p.amount), 0) AS paid,
            ic.income_limit - COALESCE(SUM(p.amount), 0) AS balance,
            pp.period_name,
            ay.academic_year_name
        FROM learners l
        JOIN charges c
        ON l.learner_id = c.learner_id
        JOIN enrolments e
        ON e.enrolment_id = c.enrolment_id
        JOIN class_categories ca
        ON ca.class_category_id = e.class_category_id
        JOIN income_categories ic
        ON ic.income_category_id = c.income_category_id
        JOIN payment_periods pp
        ON pp.payment_period_id = c.payment_period_id
        JOIN academic_years ay
        ON ay.academic_year_id = c.academic_year_id
        JOIN payment_allocations pa
        ON pa.charge_id = c.charge_id
        JOIN payments p
        ON p.payment_id = pa.payment_id
        JOIN genders g
        ON g.gender_id = l.gender_id
        WHERE
        l.school_id = $1
         AND
        l.deleted_at IS NULL
         AND
        ($2::text IS NULL OR l.learner_id= $2::text)
         AND
        ($3::text IS NULL OR ca.class_name= $3::text)
         AND
        ($4::text IS NULL OR g.gender_name= $4::text)
         AND
        ($5::text IS NULL OR ay.academic_year_name= $5::text)
        AND
        ($6::text IS NULL OR ic.income_name= $6::text)
        AND
        ($7::text IS NULL OR pp.period_name= $7::text)
        GROUP BY
            l.learner_id,
            ic.income_name,
            ic.income_limit,
            pp.period_name,
            ay.academic_year_name
        HAVING
        ($8::boolean IS NOT TRUE OR ic.income_limit - COALESCE(SUM(p.amount), 0) <> 0)

        `,
        [school_id, learner_id, class_name, gender_name, academic_year, income_name, payment_period, only_outstanding]
    );
    return result.rows;
}
