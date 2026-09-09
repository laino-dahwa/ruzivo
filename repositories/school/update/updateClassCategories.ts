import { updateReferenceRows } from "../referenceTable";
import { CLASS_CATEGORIES } from "../referenceTables";

export type UpdateClassCategoryInput = {
  school_id: string;
  class_category_id: number;
  class_name: string;
};

/**
 * Renames existing rows, matched by their own id and scoped to the owning
 * school. The id itself is never editable, so records that reference it
 * (learners, charges, payments, expenses) are unaffected by a rename.
 */
export async function UpdateClassCategory(rows: UpdateClassCategoryInput[]) {
  return updateReferenceRows(CLASS_CATEGORIES, rows as unknown as Record<string, unknown>[]);
}
