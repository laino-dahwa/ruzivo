import { deleteReferenceRow } from "../referenceTable";
import { PAYMENT_PERIODS } from "../referenceTables";

/** Refuses to delete while anything still references the row. */
export async function deletePaymentPeriod(school_id: string, payment_period_id: number) {
  return deleteReferenceRow(PAYMENT_PERIODS, school_id, payment_period_id);
}
