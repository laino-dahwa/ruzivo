import { deleteReferenceRow } from "../referenceTable";
import { EXPENSE_CATEGORIES } from "../referenceTables";

/** Refuses to delete while anything still references the row. */
export async function deleteExpenseCategory(school_id: string, expense_category_id: number) {
  return deleteReferenceRow(EXPENSE_CATEGORIES, school_id, expense_category_id);
}
