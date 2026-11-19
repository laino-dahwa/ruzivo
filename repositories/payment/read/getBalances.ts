import { query } from "../../../lib/db";
import { PAID_TOWARD_FEE } from "./paidTowardFee";

/**
 * Balances per learner + fee + period + year: every fee that has been
 * accepted (fee_decisions, migration 015), with what has been paid toward it.
 * This is the single source of truth for what a learner owes. Backs the
 * Balances page, learner statements and the Record Payment form.
 *
 * A fee is accepted either by someone pressing Accept on the Expected fees
 * page or by a payment being recorded against it, so an accepted fee with
 * nothing paid yet shows here as owing in full. Fees the system merely
 * suggests (repositories/expected-fees/) never appear here.
 *
 * `charged` is the amount fixed when the fee was accepted. Only an accepted
 * fee that had no limit at the time (it could only have been accepted by a
 * payment) falls back to the fee's current limit, and stays NULL while the
 * fee has none.
 *
 * `only_outstanding` drops rows that are settled exactly. It is opt-in because
 * the Record Payment form reads these same rows to show how much of a fee is
 * already paid — a fully paid fee missing from the list would read there as
 * "nothing paid yet" and invite a duplicate payment.
 *
 * Overpaid rows (a negative balance) are deliberately kept: they are not
 * settled, and hiding them would bury the discrepancy.
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
        WITH balances AS (
            SELECT
                l.learner_id,
                l.first_name,
                l.last_name,
                ic.income_name,
                COALESCE(fd.amount, ic.income_limit) AS charged,
                COALESCE(paid.total, 0) AS paid,
                COALESCE(fd.amount, ic.income_limit) - COALESCE(paid.total, 0) AS balance,
                pp.period_name,
                ay.academic_year_name,
                ca.class_name,
                g.gender_name
            FROM fee_decisions fd
            JOIN learners l ON l.learner_id = fd.learner_id
            JOIN income_categories ic ON ic.income_category_id = fd.income_category_id
            JOIN payment_periods pp ON pp.payment_period_id = fd.payment_period_id
            JOIN academic_years ay ON ay.academic_year_id = fd.academic_year_id
            LEFT JOIN enrolments e ON e.learner_id = fd.learner_id AND e.academic_year_id = fd.academic_year_id
            LEFT JOIN class_categories ca ON ca.class_category_id = e.class_category_id
            LEFT JOIN genders g ON g.gender_id = l.gender_id
            ${PAID_TOWARD_FEE}
            WHERE fd.school_id = $1
              AND fd.decision = 'ACCEPTED'
              AND l.deleted_at IS NULL
        )
        SELECT learner_id, first_name, last_name, income_name, charged, paid, balance, period_name, academic_year_name
        FROM balances
        WHERE
            ($2::text IS NULL OR learner_id = $2::text)
            AND ($3::text IS NULL OR class_name = $3::text)
            AND ($4::text IS NULL OR gender_name = $4::text)
            AND ($5::text IS NULL OR academic_year_name = $5::text)
            AND ($6::text IS NULL OR income_name = $6::text)
            AND ($7::text IS NULL OR period_name = $7::text)
            AND ($8::boolean IS NOT TRUE OR balance <> 0)
        ORDER BY last_name, first_name, learner_id, academic_year_name, period_name, income_name
        `,
        [school_id, learner_id, class_name, gender_name, academic_year, income_name, payment_period, only_outstanding]
    );
    return result.rows;
}
