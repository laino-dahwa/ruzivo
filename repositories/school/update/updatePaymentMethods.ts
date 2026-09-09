import { updateReferenceRows } from "../referenceTable";
import { PAYMENT_METHODS } from "../referenceTables";

export type UpdatePaymentMethodInput = {
  school_id: string;
  payment_method_id: number;
  method_name: string;
};

/**
 * Renames existing rows, matched by their own id and scoped to the owning
 * school. The id itself is never editable, so records that reference it
 * (learners, charges, payments, expenses) are unaffected by a rename.
 */
export async function UpdatePaymentMethod(rows: UpdatePaymentMethodInput[]) {
  return updateReferenceRows(PAYMENT_METHODS, rows as unknown as Record<string, unknown>[]);
}
