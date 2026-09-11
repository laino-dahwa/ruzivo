import { updateReferenceRows } from "../referenceTable";
import { ROLES } from "../referenceTables";

export type UpdateRole = {
  school_id: string;
  role_id: number;
  role_name: string;
};

/**
 * Renames existing rows, matched by their own id and scoped to the owning
 * school. The id itself is never editable, so employees pointing at it are
 * unaffected by a rename.
 */
export async function updateRole(rows: UpdateRole[]) {
  return updateReferenceRows(ROLES, rows as unknown as Record<string, unknown>[]);
}
