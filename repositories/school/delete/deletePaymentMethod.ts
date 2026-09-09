import { deleteReferenceRow } from "../referenceTable";
import { PAYMENT_METHODS } from "../referenceTables";

/** Refuses to delete while anything still references the row. */
export async function deletePaymentMethod(school_id: string, payment_method_id: number) {
  return deleteReferenceRow(PAYMENT_METHODS, school_id, payment_method_id);
}
