import { updateReferenceRows } from "../referenceTable";
import { INCOME_CATEGORIES } from "../referenceTables";

export type UpdateIncomeCategoryInput = {
  school_id: string;
  income_category_id: number;
  income_name?: string; income_limit?: string;
};

/**
 * Renames existing rows, matched by their own id and scoped to the owning
 * school. The id itself is never editable, so records that reference it
 * (learners, charges, payments, expenses) are unaffected by a rename.
 */
export async function UpdateIncomeCategory(rows: UpdateIncomeCategoryInput[]) {
  return updateReferenceRows(INCOME_CATEGORIES, rows as unknown as Record<string, unknown>[]);
}
