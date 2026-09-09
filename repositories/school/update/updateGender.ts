import { updateReferenceRows } from "../referenceTable";
import { GENDERS } from "../referenceTables";

export type UpdateGender = {
  school_id: string;
  gender_id: number;
  gender_name: string;
};

/**
 * Renames existing rows, matched by their own id and scoped to the owning
 * school. The id itself is never editable, so records that reference it
 * (learners, charges, payments, expenses) are unaffected by a rename.
 */
export async function updateGender(rows: UpdateGender[]) {
  return updateReferenceRows(GENDERS, rows as unknown as Record<string, unknown>[]);
}
