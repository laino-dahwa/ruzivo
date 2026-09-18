import { getBalances } from "../../repositories/payment/read/getBalances";
import { formatCurrency } from "../currency";
import type { StatementData } from "./renderDocumentPdf";

/**
 * A learner's statement of account, built from the same charges-and-payments
 * query the Owing page and the Record Payment form read.
 *
 * Deliberately reuses getBalances rather than writing a second query: a
 * statement that disagreed with what the Owing page shows would be worse
 * than no statement at all. `only_outstanding` is false here because a
 * statement has to show what was settled too, not just what is still due.
 */
export async function buildStatementFor(school_id: string, learner_id: string): Promise<StatementData> {
  const rows = await getBalances(school_id, learner_id, null, null, null, null, null, false);

  let totalCharged = 0;
  let totalPaid = 0;

  const lines = rows.map((row) => {
    totalCharged += Number(row.charged ?? 0);
    totalPaid += Number(row.paid ?? 0);

    return {
      income_name: row.income_name ?? "",
      period_name: row.period_name ?? "",
      academic_year_name: row.academic_year_name ?? "",
      charged: formatCurrency(row.charged),
      paid: formatCurrency(row.paid),
      balance: formatCurrency(row.balance),
    };
  });

  return {
    lines,
    totalCharged: formatCurrency(totalCharged),
    totalPaid: formatCurrency(totalPaid),
    totalBalance: formatCurrency(totalCharged - totalPaid),
  };
}
