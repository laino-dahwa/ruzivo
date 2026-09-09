import { updateReferenceRows } from "../referenceTable";
import { EXPENSE_CATEGORIES } from "../referenceTables";

export type UpdateExpenseCategoryInput = {
  school_id: string;
  expense_category_id: number;
  expense_name: string;
};

/**
 * Renames existing rows, matched by their own id and scoped to the owning
 * school. The id itself is never editable, so records that reference it
 * (learners, charges, payments, expenses) are unaffected by a rename.
 */
export async function UpdateExpenseCategory(rows: UpdateExpenseCategoryInput[]) {
  return updateReferenceRows(EXPENSE_CATEGORIES, rows as unknown as Record<string, unknown>[]);
}
