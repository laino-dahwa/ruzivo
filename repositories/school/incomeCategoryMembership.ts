import type { PoolClient } from "pg";

// Shared between createIncomeCategory and updateIncomeCategories: bulk-inserts
// whichever of an income category's three applicability join tables the
// caller supplied rows for. Kept in one place because both callers run it
// inside the same transaction as the parent row write, and a bug here would
// affect what a fee actually applies to.

export type IncomeCategoryMembershipInput = {
  class_category_ids?: number[];
  learner_ids?: string[];
  payment_period_ids?: number[];
};

async function bulkInsert(
  client: PoolClient,
  table: string,
  column: string,
  income_category_id: number,
  values: (number | string)[]
) {
  if (values.length === 0) return;

  const params: unknown[] = [];
  const placeholders = values.map((value, index) => {
    const offset = index * 2;
    params.push(income_category_id, value);
    return `($${offset + 1}, $${offset + 2})`;
  });

  await client.query(
    `INSERT INTO ${table} (income_category_id, ${column}) VALUES ${placeholders.join(", ")}`,
    params
  );
}

export async function insertIncomeCategoryMembership(
  client: PoolClient,
  income_category_id: number,
  input: IncomeCategoryMembershipInput
) {
  await bulkInsert(client, "income_category_classes", "class_category_id", income_category_id, input.class_category_ids ?? []);
  await bulkInsert(client, "income_category_learners", "learner_id", income_category_id, input.learner_ids ?? []);
  await bulkInsert(client, "income_category_periods", "payment_period_id", income_category_id, input.payment_period_ids ?? []);
}
