import { query } from "../../../lib/db";
import { OBLIGATIONS_CTE } from "./obligationsQuery";

export type ObligationFilters = {
    class_category_id: number | null;
    learner_id: string | null;
    income_category_id: number | null;
    priority: string | null;
    status: string | null;
    academic_year_id: number | null;
    payment_period_id: number | null;
};

/**
 * The full obligations list (mandatory — even unpaid — plus optional fees a
 * learner has engaged with), filtered by id rather than by name. Backs the
 * "Unpaid Mandatory Payments" page; unlike getBalances, this is a new
 * endpoint with no legacy name-based filter contract to preserve.
 */
export async function getObligations(school_id: string, filters: ObligationFilters) {
    const result = await query(
        `
        ${OBLIGATIONS_CTE}
        SELECT
            learner_id, first_name, last_name, class_name,
            income_name, priority, period_name, academic_year_name,
            expected, paid, balance, status
        FROM obligations
        WHERE
        ($2::bigint IS NULL OR class_category_id = $2::bigint)
         AND
        ($3::text IS NULL OR learner_id = $3::text)
         AND
        ($4::bigint IS NULL OR income_category_id = $4::bigint)
         AND
        ($5::text IS NULL OR priority = $5::text)
         AND
        ($6::text IS NULL OR status = $6::text)
         AND
        ($7::bigint IS NULL OR academic_year_id = $7::bigint)
         AND
        ($8::bigint IS NULL OR payment_period_id = $8::bigint)
        ORDER BY last_name, first_name
        `,
        [
            school_id,
            filters.class_category_id,
            filters.learner_id,
            filters.income_category_id,
            filters.priority,
            filters.status,
            filters.academic_year_id,
            filters.payment_period_id,
        ]
    );
    return result.rows;
}
