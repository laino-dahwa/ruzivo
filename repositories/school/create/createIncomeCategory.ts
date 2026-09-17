import { transaction } from "../../../lib/db";
import { insertIncomeCategoryMembership } from "../incomeCategoryMembership";

export type IncomeCategoryPriority = "MANDATORY" | "OPTIONAL";
export type ClassApplicability = "ALL_LEARNERS" | "SPECIFIC_CLASSES" | "SPECIFIC_LEARNERS";
export type PeriodApplicability = "ALL_PERIODS" | "SPECIFIC_PERIODS";

export type CreateIncomeCategoryInput = {
  school_id: string;
  income_name: string;
  income_limit: string | null;
  priority?: IncomeCategoryPriority;
  class_applicability?: ClassApplicability;
  period_applicability?: PeriodApplicability;
  class_category_ids?: number[];
  learner_ids?: string[];
  payment_period_ids?: number[];
};

/**
 * Creates one or more income categories, each with its own applicability
 * membership (which classes/learners/periods it applies to). Bespoke rather
 * than the generic reference-data insert used by genders/etc., because each
 * row's generated id is needed before its membership rows can be written —
 * one row per loop iteration, inside one transaction, matching
 * repositories/employee/create/createEmployee.ts's "parent row, then
 * related work" pattern.
 *
 * priority/class_applicability/period_applicability default to
 * MANDATORY/ALL_LEARNERS/ALL_PERIODS when omitted, so every existing caller
 * that only ever sent {school_id, income_name, income_limit} keeps working
 * unchanged.
 */
export async function createIncomeCategory(income_categories: CreateIncomeCategoryInput[]) {
  return transaction(async (client) => {
    const created = [];

    for (const input of income_categories) {
      const result = await client.query(
        `
        INSERT INTO income_categories (
          school_id, income_name, income_limit, priority, class_applicability, period_applicability
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [
          input.school_id,
          input.income_name,
          input.income_limit,
          input.priority ?? "MANDATORY",
          input.class_applicability ?? "ALL_LEARNERS",
          input.period_applicability ?? "ALL_PERIODS",
        ]
      );

      const row = result.rows[0];
      await insertIncomeCategoryMembership(client, row.income_category_id, input);
      created.push(row);
    }

    return created;
  });
}
