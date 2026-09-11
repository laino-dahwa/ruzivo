import { deleteReferenceRow } from "../referenceTable";
import { ROLES } from "../referenceTables";

/** Refuses to delete while any employee still holds the role. */
export async function deleteRole(school_id: string, role_id: number) {
  return deleteReferenceRow(ROLES, school_id, role_id);
}
