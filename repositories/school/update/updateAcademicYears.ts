import { updateReferenceRows } from "../referenceTable";
import { ACADEMIC_YEARS } from "../referenceTables";

export type UpdateAcademicYearInput = {
  school_id: string;
  academic_year_id: number;
  academic_year_name?: string; start_date?: string; end_date?: string;
};

/**
 * Renames existing rows, matched by their own id and scoped to the owning
 * school. The id itself is never editable, so records that reference it
 * (learners, charges, payments, expenses) are unaffected by a rename.
 */
export async function UpdateAcademicYear(rows: UpdateAcademicYearInput[]) {
  return updateReferenceRows(ACADEMIC_YEARS, rows as unknown as Record<string, unknown>[]);
}
