import { deleteReferenceRow } from "../referenceTable";
import { ACADEMIC_YEARS } from "../referenceTables";

/** Refuses to delete while anything still references the row. */
export async function deleteAcademicYear(school_id: string, academic_year_id: number) {
  return deleteReferenceRow(ACADEMIC_YEARS, school_id, academic_year_id);
}
