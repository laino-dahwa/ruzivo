/**
 * The expected fees engine: which fees the system suggests a learner should
 * be paying, that nobody has acted on yet. One row per learner x fee x
 * payment period x academic year. Nothing here is owed - a suggestion only
 * becomes a balance once it is accepted (fee_decisions, migration 015).
 * docs/expected-fees.md has the rules in plain language.
 *
 * Parameters: `$1` is school_id; `todayParam` names the parameter holding
 * today's date (in the school's timezone), so callers can number their own
 * filters freely. The caller appends `SELECT ... FROM pending WHERE ...`.
 *
 * Candidates, UNIONed:
 *
 *  - Mandatory fees: every enrolled learner x every MANDATORY fee x every
 *    payment period, kept where the fee's class/learner and period
 *    applicability allow it.
 *
 *  - Optional fees, carried forward: once a learner has an accepted OPTIONAL
 *    fee for some month, every later applicable month (by calendar order) is
 *    suggested too, until the fee's periods run out. Only month-named periods
 *    take part, since only they have an order.
 *
 *  - Once-off fees are never suggested: they are paid when they are paid.
 *
 * A candidate is pending unless any of these hold:
 *
 *  - it already has a payment (a charge). Paying a fee accepts it, so it
 *    lives on Balances;
 *  - someone has accepted or skipped it (fee_decisions);
 *  - the learner is exempt from the fee (fee_exemptions, "deny forever");
 *  - its period has not started. A month-named period starts on the 1st of
 *    that month inside its academic year; periods named anything else have
 *    no dates, so they are always treated as started;
 *  - the fee has no limit, so there is no amount to suggest.
 */
export const pendingFeesCte = (todayParam: string) => `
  WITH month_names (month_number, month_name) AS (
    VALUES (1,'january'),(2,'february'),(3,'march'),(4,'april'),(5,'may'),(6,'june'),
           (7,'july'),(8,'august'),(9,'september'),(10,'october'),(11,'november'),(12,'december')
  ),
  period_months AS (
    SELECT pp.payment_period_id, pp.school_id, mn.month_number
    FROM payment_periods pp
    JOIN month_names mn ON mn.month_name = lower(trim(pp.period_name))
  ),
  mandatory AS (
    SELECT
      l.learner_id, l.first_name, l.last_name,
      ca.class_category_id, ca.class_name,
      ic.income_category_id, ic.income_name, ic.priority,
      pp.payment_period_id, pp.period_name,
      ay.academic_year_id, ay.academic_year_name, ay.start_date AS year_start,
      ic.income_limit AS amount
    FROM learners l
    JOIN enrolments e ON e.learner_id = l.learner_id
    JOIN class_categories ca ON ca.class_category_id = e.class_category_id
    JOIN academic_years ay ON ay.academic_year_id = e.academic_year_id
    JOIN income_categories ic
      ON ic.school_id = l.school_id AND ic.priority = 'MANDATORY'
    JOIN payment_periods pp ON pp.school_id = l.school_id
    WHERE l.school_id = $1
      AND l.deleted_at IS NULL
      AND (
        ic.class_applicability = 'ALL_LEARNERS'
        OR (ic.class_applicability = 'SPECIFIC_CLASSES' AND EXISTS (
              SELECT 1 FROM income_category_classes icc
              WHERE icc.income_category_id = ic.income_category_id
                AND icc.class_category_id = ca.class_category_id))
        OR (ic.class_applicability = 'SPECIFIC_LEARNERS' AND EXISTS (
              SELECT 1 FROM income_category_learners icl
              WHERE icl.income_category_id = ic.income_category_id
                AND icl.learner_id = l.learner_id))
      )
      AND (
        ic.period_applicability = 'ALL_PERIODS'
        OR EXISTS (
              SELECT 1 FROM income_category_periods icp
              WHERE icp.income_category_id = ic.income_category_id
                AND icp.payment_period_id = pp.payment_period_id)
      )
  ),
  optional_recurring AS (
    SELECT DISTINCT
      l.learner_id, l.first_name, l.last_name,
      ca.class_category_id, ca.class_name,
      ic.income_category_id, ic.income_name, ic.priority,
      pp_now.payment_period_id, pp_now.period_name,
      ay.academic_year_id, ay.academic_year_name, ay.start_date AS year_start,
      ic.income_limit AS amount
    FROM learners l
    JOIN enrolments e ON e.learner_id = l.learner_id
    JOIN class_categories ca ON ca.class_category_id = e.class_category_id
    JOIN academic_years ay ON ay.academic_year_id = e.academic_year_id
    JOIN income_categories ic
      ON ic.school_id = l.school_id AND ic.priority = 'OPTIONAL'
    JOIN period_months pm_now ON pm_now.school_id = l.school_id
    JOIN payment_periods pp_now ON pp_now.payment_period_id = pm_now.payment_period_id
    WHERE l.school_id = $1
      AND l.deleted_at IS NULL
      AND (
        ic.period_applicability = 'ALL_PERIODS'
        OR EXISTS (
              SELECT 1 FROM income_category_periods icp
              WHERE icp.income_category_id = ic.income_category_id
                AND icp.payment_period_id = pp_now.payment_period_id)
      )
      -- The learner has taken this fee up: some earlier month is accepted
      -- (paying it accepts it too).
      AND EXISTS (
        SELECT 1
        FROM fee_decisions prior
        JOIN period_months pm_prior ON pm_prior.payment_period_id = prior.payment_period_id
        WHERE prior.learner_id = l.learner_id
          AND prior.income_category_id = ic.income_category_id
          AND prior.decision = 'ACCEPTED'
          AND pm_prior.month_number < pm_now.month_number
      )
  ),
  pending AS (
    SELECT candidate.*
    FROM (
      SELECT * FROM mandatory
      UNION ALL SELECT * FROM optional_recurring
    ) candidate
    LEFT JOIN period_months pm ON pm.payment_period_id = candidate.payment_period_id
    WHERE candidate.amount IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM charges c
        WHERE c.learner_id = candidate.learner_id
          AND c.income_category_id = candidate.income_category_id
          AND c.payment_period_id = candidate.payment_period_id
          AND c.academic_year_id = candidate.academic_year_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM fee_decisions fd
        WHERE fd.learner_id = candidate.learner_id
          AND fd.income_category_id = candidate.income_category_id
          AND fd.payment_period_id = candidate.payment_period_id
          AND fd.academic_year_id = candidate.academic_year_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM fee_exemptions fx
        WHERE fx.learner_id = candidate.learner_id
          AND fx.income_category_id = candidate.income_category_id
      )
      -- Month-named periods are suggested once their month has started; the
      -- month falls in the academic year's first calendar year when it is on
      -- or after the year's starting month, otherwise in the next one.
      AND (
        pm.month_number IS NULL
        OR make_date(
             EXTRACT(YEAR FROM candidate.year_start)::int
               + CASE WHEN pm.month_number < EXTRACT(MONTH FROM candidate.year_start)::int THEN 1 ELSE 0 END,
             pm.month_number,
             1
           ) <= ${todayParam}::date
      )
  )
`;
