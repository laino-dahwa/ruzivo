import { transaction } from "../../../lib/db";

/**
 * Deletes a school and everything belonging to it.
 *
 * The transaction tables (learners, enrolments, charges, payments,
 * allocations) are cleared explicitly, in child-to-parent order, rather than
 * by foreign keys. A single `DELETE FROM schools` used to be enough only for
 * a school with no real data: `learners.school_id`, `charges.*` and
 * `payments.payment_method_id` are all non-cascading, so deleting any school
 * that had ever enrolled a learner or taken a payment failed outright with a
 * foreign-key error.
 *
 * The fix is here rather than in the schema on purpose. Making those keys
 * cascade would also make them cascade from their *own* parents — deleting a
 * single payment period or class category would then silently erase the
 * charges and enrolments referencing it, turning a guarded reference-data
 * edit into data loss. Keeping the keys strict leaves that guard
 * (ReferenceInUseError, see repositories/school/referenceTable.ts) intact and
 * confines the destructive scope to this one function, where it is readable.
 *
 * Reference data (genders, classes, periods, methods, fees, years, expense
 * categories, roles, employees, logos) still goes by cascade from `schools`,
 * as it always has — those keys were declared ON DELETE CASCADE from the
 * start.
 */
export async function deleteSchool(school_id: string) {
    return transaction(async (client) => {
        // Captured before anything is deleted: once the allocations are gone
        // there is no longer a path from a payment back to its school.
        const paymentRows = await client.query(
            `
            SELECT DISTINCT pa.payment_id
            FROM payment_allocations pa
            JOIN charges c ON c.charge_id = pa.charge_id
            JOIN learners l ON l.learner_id = c.learner_id
            WHERE l.school_id = $1
            `,
            [school_id]
        );
        const paymentIds = paymentRows.rows.map((row) => row.payment_id);

        await client.query(`DELETE FROM payment_allocations WHERE payment_id = ANY($1::bigint[])`, [paymentIds]);
        await client.query(`DELETE FROM payments WHERE payment_id = ANY($1::bigint[])`, [paymentIds]);

        await client.query(
            `DELETE FROM charges WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`,
            [school_id]
        );
        await client.query(
            `DELETE FROM enrolments WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`,
            [school_id]
        );
        await client.query(`DELETE FROM learners WHERE school_id = $1`, [school_id]);

        // A payment that was never allocated to a charge has no learner to
        // reach it through, so the sweep above misses it. Scoped to this
        // school's own payment methods, which is the only other link a
        // payment has to a school — and it must go, or the methods cascading
        // away with the school would fail against it.
        await client.query(
            `DELETE FROM payments WHERE payment_method_id IN (SELECT payment_method_id FROM payment_methods WHERE school_id = $1)`,
            [school_id]
        );

        const result = await client.query(
            `
            DELETE FROM schools
            WHERE school_id = $1
            RETURNING *
            `,
            [school_id]
        );

        return result.rows;
    });
}
