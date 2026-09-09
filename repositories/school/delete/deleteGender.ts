import { deleteReferenceRow } from "../referenceTable";
import { GENDERS } from "../referenceTables";

/** Refuses to delete while anything still references the row. */
export async function deleteGender(school_id: string, gender_id: number) {
  return deleteReferenceRow(GENDERS, school_id, gender_id);
}
