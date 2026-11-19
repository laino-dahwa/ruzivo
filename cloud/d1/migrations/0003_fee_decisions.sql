-- Expected fees become suggestions that someone confirms (desktop migration
-- 015_fee_decisions). Owing on the website is now exactly the desktop app's
-- Balances: fees that have been accepted, minus what has been paid. Fees the
-- system merely suggests are no longer counted as owed.
--
-- Apply this and deploy the Worker BEFORE desktop computers upgrade to the
-- version with migration 015: until then the Worker refuses rows for these
-- tables, and the desktop keeps them queued and retries.

CREATE TABLE fee_decisions (
    fee_decision_id         INTEGER PRIMARY KEY,
    school_id               TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    learner_id              TEXT NOT NULL REFERENCES learners(learner_id),
    income_category_id      INTEGER NOT NULL REFERENCES income_categories(income_category_id),
    payment_period_id       INTEGER NOT NULL REFERENCES payment_periods(payment_period_id),
    academic_year_id        INTEGER NOT NULL REFERENCES academic_years(academic_year_id),
    decision                TEXT NOT NULL,          -- ACCEPTED | SKIPPED
    amount_cents            INTEGER,
    source                  TEXT NOT NULL,          -- DECISION | PAYMENT
    decided_by_employee_id  INTEGER,
    decided_by_label        TEXT,
    decided_at              TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_fee_decisions_key ON fee_decisions (learner_id, income_category_id, payment_period_id, academic_year_id);
CREATE INDEX idx_fee_decisions_school ON fee_decisions (school_id, decision);

CREATE TABLE fee_exemptions (
    fee_exemption_id         INTEGER PRIMARY KEY,
    school_id                TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    learner_id               TEXT NOT NULL REFERENCES learners(learner_id),
    income_category_id       INTEGER NOT NULL REFERENCES income_categories(income_category_id),
    reason                   TEXT NOT NULL,
    exempted_by_employee_id  INTEGER,
    exempted_by_label        TEXT,
    exempted_at              TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- v_obligations counted suggested fees as owed; it is replaced by v_balances.
DROP VIEW IF EXISTS v_learner_balances;
DROP VIEW IF EXISTS v_obligations;

-- Every accepted fee with what has been paid toward it, per learner + fee +
-- period + year: a port of the desktop's getBalances
-- (repositories/payment/read/getBalances.ts) with money in cents. Keep the
-- two in step. Column names match the old v_obligations so the website's
-- learner page reads it unchanged.
CREATE VIEW v_balances AS
SELECT
  b.*,
  (b.expected_cents - b.paid_cents) AS balance_cents,
  CASE
    WHEN b.paid_cents <= 0 THEN 'NO_PAYMENT'
    WHEN b.paid_cents < b.expected_cents THEN 'PARTIALLY_PAID'
    ELSE 'FULLY_PAID'
  END AS status
FROM (
  SELECT
    fd.school_id, l.learner_id, l.first_name, l.last_name,
    ca.class_category_id, ca.class_name,
    ic.income_category_id, ic.income_name, ic.priority,
    pp.payment_period_id, pp.period_name,
    ay.academic_year_id, ay.academic_year_name,
    COALESCE(fd.amount_cents, ic.income_limit_cents) AS expected_cents,
    COALESCE((
      SELECT SUM(p.amount_cents)
      FROM charges c
      JOIN payment_allocations pa ON pa.charge_id = c.charge_id
      JOIN payments p ON p.payment_id = pa.payment_id
      WHERE c.learner_id = fd.learner_id
        AND c.income_category_id = fd.income_category_id
        AND c.payment_period_id = fd.payment_period_id
        AND c.academic_year_id = fd.academic_year_id
    ), 0) AS paid_cents
  FROM fee_decisions fd
  JOIN learners l ON l.learner_id = fd.learner_id
  JOIN income_categories ic ON ic.income_category_id = fd.income_category_id
  JOIN payment_periods pp ON pp.payment_period_id = fd.payment_period_id
  JOIN academic_years ay ON ay.academic_year_id = fd.academic_year_id
  LEFT JOIN enrolments e ON e.learner_id = fd.learner_id AND e.academic_year_id = fd.academic_year_id
  LEFT JOIN class_categories ca ON ca.class_category_id = e.class_category_id
  WHERE fd.decision = 'ACCEPTED'
    AND l.deleted_at IS NULL
) b
WHERE b.expected_cents IS NOT NULL;

-- Each learner's totals across v_balances (the desktop Balances page).
CREATE VIEW v_learner_balances AS
SELECT school_id, learner_id, first_name, last_name, class_name,
       SUM(CASE WHEN priority = 'MANDATORY' AND balance_cents > 0 THEN balance_cents ELSE 0 END) AS mandatory_owing_cents,
       SUM(CASE WHEN priority <> 'MANDATORY' AND balance_cents > 0 THEN balance_cents ELSE 0 END) AS optional_owing_cents,
       SUM(CASE WHEN balance_cents > 0 THEN balance_cents ELSE 0 END) AS total_owing_cents,
       SUM(paid_cents) AS paid_cents,
       SUM(paid_cents) + SUM(CASE WHEN balance_cents > 0 THEN balance_cents ELSE 0 END) AS billed_cents
FROM v_balances
GROUP BY school_id, learner_id, first_name, last_name, class_name;
