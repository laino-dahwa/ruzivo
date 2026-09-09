import { deleteReferenceRow } from "../referenceTable";
import { INCOME_CATEGORIES } from "../referenceTables";

/** Refuses to delete while anything still references the row. */
export async function deleteIncomeCategory(school_id: string, income_category_id: number) {
  return deleteReferenceRow(INCOME_CATEGORIES, school_id, income_category_id);
}
