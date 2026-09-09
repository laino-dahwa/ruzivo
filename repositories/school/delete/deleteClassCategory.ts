import { deleteReferenceRow } from "../referenceTable";
import { CLASS_CATEGORIES } from "../referenceTables";

/** Refuses to delete while anything still references the row. */
export async function deleteClassCategory(school_id: string, class_category_id: number) {
  return deleteReferenceRow(CLASS_CATEGORIES, school_id, class_category_id);
}
