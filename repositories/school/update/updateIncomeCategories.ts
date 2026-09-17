import { transaction } from "../../../lib/db";
import { insertIncomeCategoryMembership } from "../incomeCategoryMembership";
import type { ClassApplicability, IncomeCategoryPriority, PeriodApplicability } from "../create/createIncomeCategory";

export type UpdateIncomeCategoryInput = {
  school_id: string;
  income_category_id: number;
  income_name?: string;
  income_limit?: string | null;
  priority?: IncomeCategoryPriority;
  class_applicability?: ClassApplicability;
  period_applicability?: PeriodApplicability;
  class_category_ids?: number[];
  learner_ids?: string[];
  payment_period_ids?: number[];
};

/**
 * Updates the parent row and replaces its applicability membership, both in
 * one transaction — a partial success (the scalar rename applied but the
 * membership rewrite failed, or vice versa) would leave a fee's rule and its
 * actual membership disagreeing. Bespoke rather than the generic
 * updateReferenceRows used by genders/etc., for the same reason create is:
 * that helper updates exactly one table per call, with no way to also
 * rewrite two independent many-to-many relations.
 *
 * Membership is always replaced wholesale (delete then reinsert) rather than
 * diffed — these are small, admin-curated sets, so a real diff isn't worth
 * the complexity. The caller (the Income Categories form) always submits the
 * full current class/learner/period selection on every save.
 */
export async function UpdateIncomeCategory(rows: UpdateIncomeCategoryInput[]) {
  return transaction(async (client) => {
    const updated = [];

    for (const row of rows) {
      const result = await client.query(
        `
        UPDATE income_categories
        SET
          income_name = COALESCE($3, income_name),
          income_limit = COALESCE($4, income_limit),
          priority = COALESCE($5, priority),
          class_applicability = COALESCE($6, class_applicability),
          period_applicability = COALESCE($7, period_applicability)
        WHERE income_category_id = $1
          AND school_id = $2
        RETURNING *
        `,
        [
          row.income_category_id,
          row.school_id,
          row.income_name ?? null,
          row.income_limit ?? null,
          row.priority ?? null,
          row.class_applicability ?? null,
          row.period_applicability ?? null,
        ]
      );

      if (result.rowCount === 0) {
        throw new Error("No income category with that id belongs to this school.");
      }

      await client.query(`DELETE FROM income_category_classes WHERE income_category_id = $1`, [row.income_category_id]);
      await client.query(`DELETE FROM income_category_learners WHERE income_category_id = $1`, [row.income_category_id]);
      await client.query(`DELETE FROM income_category_periods WHERE income_category_id = $1`, [row.income_category_id]);
      await insertIncomeCategoryMembership(client, row.income_category_id, row);

      updated.push(result.rows[0]);
    }

    return updated;
  });
}
