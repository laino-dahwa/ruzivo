/**
 * `LEFT JOIN LATERAL ... paid`: what has been paid toward the accepted fee
 * `fd` (a fee_decisions row) as `paid.total`, NULL when nothing has.
 *
 * Every payment writes its own charge row, so one fee (learner + fee + period
 * + year) can have several; they are summed by that key rather than joined
 * one by one. Shared by every query that turns accepted fees into balances
 * (getBalances, getOwingReport, getReportSummary) so they agree to the cent.
 */
export const PAID_TOWARD_FEE = `
  LEFT JOIN LATERAL (
    SELECT SUM(p.amount) AS total
    FROM charges c
    JOIN payment_allocations pa ON pa.charge_id = c.charge_id
    JOIN payments p ON p.payment_id = pa.payment_id
    WHERE c.learner_id = fd.learner_id
      AND c.income_category_id = fd.income_category_id
      AND c.payment_period_id = fd.payment_period_id
      AND c.academic_year_id = fd.academic_year_id
  ) paid ON TRUE
`;
