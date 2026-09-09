import { updateReferenceRows } from "../referenceTable";
import { PAYMENT_PERIODS } from "../referenceTables";

export type UpdatePaymentPeriodInput = {
  school_id: string;
  payment_period_id: number;
  period_name: string;
};

/**
 * Renames existing rows, matched by their own id and scoped to the owning
 * school. The id itself is never editable, so records that reference it
 * (learners, charges, payments, expenses) are unaffected by a rename.
 */
export async function UpdatePaymentPeriod(rows: UpdatePaymentPeriodInput[]) {
  return updateReferenceRows(PAYMENT_PERIODS, rows as unknown as Record<string, unknown>[]);
}
