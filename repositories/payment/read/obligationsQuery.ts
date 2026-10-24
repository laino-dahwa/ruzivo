/**
 * The Unpaid Mandatory Payments engine's core fragment (repositories/payment/
 * read/getObligations.ts — its only consumer): one row per learner x
 * applicable income category x applicable payment period x academic year
 * that the learner is currently "in scope" for, including fees never
 * charged. `$1` is `school_id`; the caller appends its own filters in an
 * outer `SELECT ... FROM obligations WHERE ...`.
 *
 * Deliberately NOT used by getBalances (the /owing page and the Record
 * Payment form) — that one stays a plain reflection of real charges, so a
 * learner who has never been charged for a fee doesn't show up there. This
 * "owed even with zero payments" view is specific to the Unpaid Mandatory
 * Payments page.
 *
 * Three branches, UNIONed:
 *
 *  - `mandatory`: enumerated from learners/enrolments x income_categories
 *    (priority = MANDATORY) x payment_periods, kept only where the
 *    category's class/learner and period applicability resolve true for
 *    that row (via EXISTS against the three income_category_* join tables,
 *    or the ALL_* shortcuts). The existing charges/payment_allocations/
 *    payments chain is LEFT JOINed on (learner, income_category,
 *    payment_period, academic_year) — NOT on enrolment_id, so a mid-year
 *    re-enrolment can't silently drop an earlier instalment — so `paid` is
 *    0 when nothing has ever been charged and correctly summed when it has.
 *    This one query covers "never paid" and "already paid" without a charge
 *    needing to pre-exist, which is the actual fix.
 *
 *  - `optional`: unchanged from the app's existing logic — an OPTIONAL fee
 *    only ever appears once a `charges` row already exists (proof the
 *    learner has engaged with it). Optional fees never auto-create an
 *    obligation.
 *
 *  - `optional_recurring`: once an OPTIONAL fee has been paid for at least
 *    one applicable period, every *later* applicable period (by calendar
 *    month order) that still has no charge of its own is projected as a
 *    NO_PAYMENT row — not just the one immediately after. A "Swimming"
 *    charge in "September" alone (nothing paid since) surfaces unpaid
 *    "Swimming" obligations for October, November, December, … every later
 *    applicable month, until either a payment resumes the chain or the
 *    fee's applicable periods run out — a learner who misses two periods in
 *    a row doesn't fall off the list after the first. Matched by period
 *    *name* against calendar month names (`period_months`, below), the same
 *    convention components/payments/payments-view.tsx already uses
 *    client-side to default the period picker to "this month" — so this
 *    only fires for periods actually named after months; a school using
 *    "Term 1"/"Term 2" naming gets no month match and this branch
 *    contributes nothing for them, same as that existing default silently
 *    does nothing for them today. Gated by the fee's own
 *    period_applicability, same as `mandatory` — a fee scoped to
 *    "Selected periods" (SPECIFIC_PERIODS) never gets projected outside
 *    that selection. Suppressed period-by-period once a real charge exists
 *    for it, so it never duplicates a row `optional` already produces.
 *
 *  - ONCE_OFF fees ride along in `optional`: a once-off fee is never owed
 *    just by existing - it can be paid in any period, or never - but in each
 *    period it HAS been paid in, its limit applies to that period and the
 *    remainder shows as outstanding (5 of 20 paid in January: 15 owing for
 *    January). Unlike OPTIONAL it is never projected into later periods.
 *
 * `income_limit` is nullable; a mandatory fee with no configured limit
 * resolves `expected`/`balance`/`status` to NULL and is therefore excluded
 * from every outstanding/unpaid filter — an existing quirk (the same thing
 * already happened via `HAVING balance > 0` dropping `NULL > 0`), preserved
 * here rather than "fixed" as an unrelated behaviour change.
 */
export const OBLIGATIONS_CTE = `
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
      l.learner_id, l.first_name, l.last_name, g.gender_name,
      ca.class_category_id, ca.class_name,
      ic.income_category_id, ic.income_name, ic.priority,
      pp.payment_period_id, pp.period_name,
      ay.academic_year_id, ay.academic_year_name,
      ic.income_limit AS expected,
      COALESCE(SUM(p.amount), 0) AS paid
    FROM learners l
    JOIN enrolments e ON e.learner_id = l.learner_id
    JOIN class_categories ca ON ca.class_category_id = e.class_category_id
    JOIN academic_years ay ON ay.academic_year_id = e.academic_year_id
    LEFT JOIN genders g ON g.gender_id = l.gender_id
    JOIN income_categories ic
      ON ic.school_id = l.school_id AND ic.priority = 'MANDATORY'
    JOIN payment_periods pp ON pp.school_id = l.school_id
    LEFT JOIN charges c
      ON c.learner_id = l.learner_id
     AND c.income_category_id = ic.income_category_id
     AND c.payment_period_id = pp.payment_period_id
     AND c.academic_year_id = ay.academic_year_id
    LEFT JOIN payment_allocations pa ON pa.charge_id = c.charge_id
    LEFT JOIN payments p ON p.payment_id = pa.payment_id
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
    GROUP BY l.learner_id, l.first_name, l.last_name, g.gender_name,
             ca.class_category_id, ca.class_name,
             ic.income_category_id, ic.income_name, ic.priority,
             pp.payment_period_id, pp.period_name,
             ay.academic_year_id, ay.academic_year_name, ic.income_limit
  ),
  optional AS (
    SELECT
      l.learner_id, l.first_name, l.last_name, g.gender_name,
      ca.class_category_id, ca.class_name,
      ic.income_category_id, ic.income_name, ic.priority,
      pp.payment_period_id, pp.period_name,
      ay.academic_year_id, ay.academic_year_name,
      ic.income_limit AS expected,
      COALESCE(SUM(p.amount), 0) AS paid
    FROM learners l
    JOIN charges c ON c.learner_id = l.learner_id
    JOIN enrolments e ON e.enrolment_id = c.enrolment_id
    JOIN class_categories ca ON ca.class_category_id = e.class_category_id
    LEFT JOIN genders g ON g.gender_id = l.gender_id
    JOIN income_categories ic
      ON ic.income_category_id = c.income_category_id AND ic.priority IN ('OPTIONAL', 'ONCE_OFF')
    JOIN payment_periods pp ON pp.payment_period_id = c.payment_period_id
    JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id
    LEFT JOIN payment_allocations pa ON pa.charge_id = c.charge_id
    LEFT JOIN payments p ON p.payment_id = pa.payment_id
    WHERE l.school_id = $1
      AND l.deleted_at IS NULL
    GROUP BY l.learner_id, l.first_name, l.last_name, g.gender_name,
             ca.class_category_id, ca.class_name,
             ic.income_category_id, ic.income_name, ic.priority,
             pp.payment_period_id, pp.period_name,
             ay.academic_year_id, ay.academic_year_name, ic.income_limit
  ),
  optional_recurring AS (
    -- Enumerated like 'mandatory' (learner x every applicable period for the
    -- fee, via period_months rather than a cross join against ALL periods so
    -- only month-named ones are ever candidates), not anchored to a single
    -- prior charge -- so a learner who pays once and then misses several
    -- periods in a row stays flagged through every one of them, not just
    -- the first, until either they pay again or an applicable period runs
    -- out. A period only counts as "in scope" once some *earlier* applicable
    -- period (by calendar month order) already has a real charge for this
    -- learner+fee -- that earlier charge is what turns "optional, never
    -- touched" into "optional, now expected every period going forward".
    SELECT DISTINCT
      l.learner_id, l.first_name, l.last_name, g.gender_name,
      ca.class_category_id, ca.class_name,
      ic.income_category_id, ic.income_name, ic.priority,
      pp_now.payment_period_id, pp_now.period_name,
      ay.academic_year_id, ay.academic_year_name,
      ic.income_limit AS expected,
      0::numeric AS paid
    FROM learners l
    JOIN enrolments e ON e.learner_id = l.learner_id
    JOIN class_categories ca ON ca.class_category_id = e.class_category_id
    JOIN academic_years ay ON ay.academic_year_id = e.academic_year_id
    LEFT JOIN genders g ON g.gender_id = l.gender_id
    JOIN income_categories ic
      ON ic.school_id = l.school_id AND ic.priority = 'OPTIONAL'
    JOIN period_months pm_now ON pm_now.school_id = l.school_id
    JOIN payment_periods pp_now ON pp_now.payment_period_id = pm_now.payment_period_id
    WHERE l.school_id = $1
      AND l.deleted_at IS NULL
      -- Only a period the fee is actually configured to apply to -- the
      -- same check the 'mandatory' branch uses. A fee scoped to "Selected
      -- periods" (SPECIFIC_PERIODS) never gets projected outside that set.
      AND (
        ic.period_applicability = 'ALL_PERIODS'
        OR EXISTS (
              SELECT 1 FROM income_category_periods icp
              WHERE icp.income_category_id = ic.income_category_id
                AND icp.payment_period_id = pp_now.payment_period_id)
      )
      -- Not a duplicate of a row 'optional' already produces: only projected
      -- when this specific period has no charge of its own yet.
      AND NOT EXISTS (
        SELECT 1 FROM charges already
        WHERE already.learner_id = l.learner_id
          AND already.income_category_id = ic.income_category_id
          AND already.payment_period_id = pp_now.payment_period_id
      )
      -- The chain-starting condition: some earlier applicable period (by
      -- month order) already has a real charge for this learner+fee.
      AND EXISTS (
        SELECT 1
        FROM charges prior
        JOIN period_months pm_prior ON pm_prior.payment_period_id = prior.payment_period_id
        WHERE prior.learner_id = l.learner_id
          AND prior.income_category_id = ic.income_category_id
          AND pm_prior.school_id = l.school_id
          AND pm_prior.month_number < pm_now.month_number
      )
  ),
  obligations AS (
    SELECT *,
      (expected - paid) AS balance,
      CASE
        WHEN paid <= 0 THEN 'NO_PAYMENT'
        WHEN paid < expected THEN 'PARTIALLY_PAID'
        ELSE 'FULLY_PAID'
      END AS status
    FROM (
      SELECT * FROM mandatory
      UNION ALL SELECT * FROM optional
      UNION ALL SELECT * FROM optional_recurring
    ) all_obligations
    -- A fee with no configured limit has no real expected amount to owe —
    -- excluded entirely rather than shown with null expected/balance/status,
    -- the same as the app's pre-existing behaviour (HAVING balance > 0
    -- already dropped these, since NULL > 0 is unknown).
    WHERE expected IS NOT NULL
  )
`;
