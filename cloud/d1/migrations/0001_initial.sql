-- Ruzivo cloud mirror: Cloudflare D1 (SQLite) schema, version 1.
--
-- A read-only copy of the desktop app's Postgres database (migrations
-- 001-013), kept up to date by the desktop sync (electron/sync/) and seeded
-- from a backup by scripts/backup-to-d1.mjs. Rows are only ever written by
-- the sync Worker; the website only reads.
--
-- Same table and column names as Postgres, with these changes (see
-- electron/sync/normalize.ts, which does the conversion):
--   * money is INTEGER cents, columns renamed <name>_cents
--   * timestamps are TEXT, UTC ISO-8601 with microseconds ("...Z")
--   * dates are TEXT "YYYY-MM-DD"; booleans are 0/1; JSONB is JSON TEXT
--   * school_id has no CHAR padding ("SSV", not "SSV ")
--   * payments and expenses carry a derived school_id
--   * logos live in R2; their rows hold the R2 keys
--   * employees have no password_hash or security_key_hash
--   * ids are the desktop's own ids (no AUTOINCREMENT): the desktop app is
--     the only source of rows
--   * every table has _synced_at, when the Worker last wrote the row (used
--     to delete rows a full sync did not send; see sync_installs)
--
-- Foreign keys mirror Postgres. The Worker sets PRAGMA defer_foreign_keys
-- for each batch, so a batch's rows can arrive in any order.

-- ── Schools and reference data ─────────────────────────────────────────────

CREATE TABLE schools (
    school_id       TEXT PRIMARY KEY,
    school_name     TEXT NOT NULL,
    school_type     TEXT,
    school_address  TEXT,
    school_contact  TEXT,
    school_email    TEXT,
    created_at      TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE genders (
    gender_id    INTEGER PRIMARY KEY,
    school_id    TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    gender_name  TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE payment_methods (
    payment_method_id  INTEGER PRIMARY KEY,
    school_id          TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    method_name        TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE class_categories (
    class_category_id  INTEGER PRIMARY KEY,
    school_id          TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    class_name         TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE payment_periods (
    payment_period_id  INTEGER PRIMARY KEY,
    school_id          TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    period_name        TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE expense_categories (
    expense_category_id  INTEGER PRIMARY KEY,
    school_id            TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    expense_name         TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE income_categories (
    income_category_id    INTEGER PRIMARY KEY,
    school_id             TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    income_name           TEXT NOT NULL,
    income_limit_cents    INTEGER CHECK (income_limit_cents IS NULL OR income_limit_cents >= 0),
    priority              TEXT NOT NULL DEFAULT 'MANDATORY'
                          CHECK (priority IN ('MANDATORY', 'OPTIONAL', 'ONCE_OFF')),
    class_applicability   TEXT NOT NULL DEFAULT 'ALL_LEARNERS'
                          CHECK (class_applicability IN ('ALL_LEARNERS', 'SPECIFIC_CLASSES', 'SPECIFIC_LEARNERS')),
    period_applicability  TEXT NOT NULL DEFAULT 'ALL_PERIODS'
                          CHECK (period_applicability IN ('ALL_PERIODS', 'SPECIFIC_PERIODS')),
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE academic_years (
    academic_year_id    INTEGER PRIMARY KEY,
    school_id           TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    academic_year_name  TEXT NOT NULL,
    start_date          TEXT NOT NULL,
    end_date            TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE school_logos (
    school_id         TEXT PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
    original_r2_key   TEXT,
    ico_r2_key        TEXT,
    content_type      TEXT NOT NULL DEFAULT 'image/png',
    updated_at        TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE school_logo_renditions (
    school_id   TEXT NOT NULL REFERENCES school_logos(school_id) ON DELETE CASCADE,
    size        INTEGER NOT NULL,
    png_r2_key  TEXT,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (school_id, size)
);

-- ── Staff ──────────────────────────────────────────────────────────────────

CREATE TABLE roles (
    role_id       INTEGER PRIMARY KEY,
    school_id     TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    role_name     TEXT NOT NULL,
    access_level  TEXT NOT NULL DEFAULT 'CASHIER' CHECK (access_level IN ('ADMIN', 'CASHIER')),
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- No password_hash / security_key_hash: sign-in secrets never leave the school computer.
CREATE TABLE employees (
    employee_id                INTEGER PRIMARY KEY,
    school_id                  TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    first_name                 TEXT NOT NULL,
    last_name                  TEXT NOT NULL,
    email                      TEXT NOT NULL,
    must_change_password       INTEGER NOT NULL DEFAULT 1,
    created_at                 TEXT NOT NULL,
    role_id                    INTEGER NOT NULL REFERENCES roles(role_id),
    deleted_at                 TEXT,
    last_login_at              TEXT,
    failed_login_count         INTEGER NOT NULL DEFAULT 0,
    locked_until               TEXT,
    basic_salary_cents         INTEGER,
    transport_allowance_cents  INTEGER NOT NULL DEFAULT 0,
    housing_allowance_cents    INTEGER NOT NULL DEFAULT 0,
    paye_deduction_cents       INTEGER NOT NULL DEFAULT 0,
    pension_deduction_cents    INTEGER NOT NULL DEFAULT 0,
    security_key_created_at    TEXT,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── Learners and fees ──────────────────────────────────────────────────────

CREATE TABLE learners (
    learner_id     TEXT PRIMARY KEY,
    school_id      TEXT NOT NULL REFERENCES schools(school_id),
    first_name     TEXT NOT NULL,
    last_name      TEXT NOT NULL,
    gender_id      INTEGER REFERENCES genders(gender_id),
    date_of_birth  TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,
    email          TEXT,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE enrolments (
    enrolment_id       INTEGER PRIMARY KEY,
    learner_id         TEXT NOT NULL REFERENCES learners(learner_id),
    class_category_id  INTEGER NOT NULL REFERENCES class_categories(class_category_id),
    academic_year_id   INTEGER NOT NULL REFERENCES academic_years(academic_year_id),
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE income_category_classes (
    income_category_class_id  INTEGER PRIMARY KEY,
    income_category_id        INTEGER NOT NULL REFERENCES income_categories(income_category_id) ON DELETE CASCADE,
    class_category_id         INTEGER NOT NULL REFERENCES class_categories(class_category_id) ON DELETE CASCADE,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE income_category_learners (
    income_category_learner_id  INTEGER PRIMARY KEY,
    income_category_id          INTEGER NOT NULL REFERENCES income_categories(income_category_id) ON DELETE CASCADE,
    learner_id                  TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE income_category_periods (
    income_category_period_id  INTEGER PRIMARY KEY,
    income_category_id         INTEGER NOT NULL REFERENCES income_categories(income_category_id) ON DELETE CASCADE,
    payment_period_id          INTEGER NOT NULL REFERENCES payment_periods(payment_period_id) ON DELETE CASCADE,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE charges (
    charge_id           INTEGER PRIMARY KEY,
    learner_id          TEXT NOT NULL REFERENCES learners(learner_id),
    enrolment_id        INTEGER NOT NULL REFERENCES enrolments(enrolment_id),
    income_category_id  INTEGER NOT NULL REFERENCES income_categories(income_category_id),
    payment_period_id   INTEGER NOT NULL REFERENCES payment_periods(payment_period_id),
    academic_year_id    INTEGER NOT NULL REFERENCES academic_years(academic_year_id),
    created_at          TEXT NOT NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── Money ──────────────────────────────────────────────────────────────────

-- school_id is derived (payments have none in Postgres): the school of the
-- learner the payment is allocated to.
CREATE TABLE payments (
    payment_id               INTEGER PRIMARY KEY,
    school_id                TEXT REFERENCES schools(school_id),
    amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
    payment_method_id        INTEGER REFERENCES payment_methods(payment_method_id),
    paid_at                  TEXT NOT NULL,
    recorded_by_employee_id  INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE payment_allocations (
    allocation_id  INTEGER PRIMARY KEY,
    payment_id     INTEGER NOT NULL REFERENCES payments(payment_id),
    charge_id      INTEGER NOT NULL REFERENCES charges(charge_id),
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- school_id is derived from the expense category.
CREATE TABLE expenses (
    expense_id               INTEGER PRIMARY KEY,
    school_id                TEXT REFERENCES schools(school_id),
    expense_category_id      INTEGER NOT NULL REFERENCES expense_categories(expense_category_id) ON DELETE CASCADE,
    amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
    expense_date             TEXT NOT NULL,
    description              TEXT,
    created_at               TEXT NOT NULL,
    recorded_by_employee_id  INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE payroll_runs (
    payroll_run_id            INTEGER PRIMARY KEY,
    school_id                 TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    period_year               INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 2200),
    period_month              INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    generated_by_employee_id  INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    generated_by_label        TEXT NOT NULL,
    generated_at              TEXT NOT NULL,
    expense_id                INTEGER REFERENCES expenses(expense_id) ON DELETE SET NULL,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE payroll_lines (
    payroll_line_id            INTEGER PRIMARY KEY,
    payroll_run_id             INTEGER NOT NULL REFERENCES payroll_runs(payroll_run_id) ON DELETE CASCADE,
    employee_id                INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    employee_label             TEXT NOT NULL,
    role_label                 TEXT NOT NULL,
    employee_email             TEXT,
    basic_salary_cents         INTEGER NOT NULL,
    transport_allowance_cents  INTEGER NOT NULL DEFAULT 0,
    housing_allowance_cents    INTEGER NOT NULL DEFAULT 0,
    paye_deduction_cents       INTEGER NOT NULL DEFAULT 0,
    pension_deduction_cents    INTEGER NOT NULL DEFAULT 0,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── Documents and audit ────────────────────────────────────────────────────

CREATE TABLE documents (
    document_id            INTEGER PRIMARY KEY,
    school_id              TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    learner_id             TEXT REFERENCES learners(learner_id) ON DELETE SET NULL,
    document_type          TEXT NOT NULL,
    title                  TEXT NOT NULL,
    reference              TEXT NOT NULL,
    body_html              TEXT NOT NULL,
    statement_data         TEXT,
    signatory_name         TEXT NOT NULL,
    signatory_title        TEXT NOT NULL,
    issued_by_employee_id  INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    issued_by_label        TEXT NOT NULL,
    issued_at              TEXT NOT NULL,
    invoice_data           TEXT,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- No foreign keys: an audit row outlives what it describes.
CREATE TABLE audit_log (
    audit_id     INTEGER PRIMARY KEY,
    occurred_at  TEXT NOT NULL,
    employee_id  INTEGER,
    actor_label  TEXT NOT NULL,
    school_id    TEXT,
    action       TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    TEXT,
    summary      TEXT NOT NULL,
    detail       TEXT,
    _synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── Sync bookkeeping (written by the Worker only) ──────────────────────────

-- One row per desktop install ever linked. Exactly one is active (revoked_at
-- IS NULL): each school computer has its own Postgres with its own ids, so a
-- second computer writing here would overwrite the first one's rows. Linking
-- a new computer revokes the previous one.
--
-- `secret` is the HMAC key the install signs batches with (the Worker needs
-- the key itself to verify a signature).
--
-- A full sync stamps every row it sends with _synced_at; when it finishes,
-- rows older than full_sync_started_at were not sent, so no longer exist on
-- the computer, and are deleted.
CREATE TABLE sync_installs (
    install_id            TEXT PRIMARY KEY,
    label                 TEXT NOT NULL,
    secret                TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    revoked_at            TEXT,
    last_batch_at         TEXT,
    app_version           TEXT,
    schema_migration      TEXT,
    full_sync_id          TEXT,
    full_sync_started_at  TEXT,
    last_full_sync_at     TEXT
);

-- Every batch already applied, so a resent batch is a no-op.
CREATE TABLE sync_batches (
    batch_id     TEXT PRIMARY KEY,
    install_id   TEXT NOT NULL REFERENCES sync_installs(install_id),
    mode         TEXT NOT NULL,
    received_at  TEXT NOT NULL,
    row_count    INTEGER NOT NULL
);

-- ── Indexes (from Postgres 009_performance_indexes, plus website lookups) ──
--
-- The uq_* indexes match Postgres's UNIQUE constraints but are deliberately
-- NOT unique here. Postgres already guarantees uniqueness; SQLite checks it
-- row by row with no deferral, so a legitimate change sent as one batch
-- (rename period "January", then create a new "January"), or a stale row a
-- full sync has not pruned yet, would otherwise make the sync fail.

CREATE INDEX uq_gender            ON genders (school_id, gender_name);
CREATE INDEX uq_payment_method    ON payment_methods (school_id, method_name);
CREATE INDEX uq_class_category    ON class_categories (school_id, class_name);
CREATE INDEX uq_payment_period    ON payment_periods (school_id, period_name);
CREATE INDEX uq_expense_category  ON expense_categories (school_id, expense_name);
CREATE INDEX uq_income_category   ON income_categories (school_id, income_name);
CREATE INDEX uq_academic_year     ON academic_years (school_id, academic_year_name);
CREATE INDEX uq_role              ON roles (school_id, role_name);
CREATE INDEX uq_employee_email    ON employees (school_id, email);
CREATE INDEX uq_learner_year      ON enrolments (learner_id, academic_year_id);
CREATE INDEX uq_payment_charge    ON payment_allocations (payment_id, charge_id);
CREATE INDEX uq_income_category_class   ON income_category_classes (income_category_id, class_category_id);
CREATE INDEX uq_income_category_learner ON income_category_learners (income_category_id, learner_id);
CREATE INDEX uq_income_category_period  ON income_category_periods (income_category_id, payment_period_id);
CREATE INDEX uq_payroll_run_period ON payroll_runs (school_id, period_year, period_month);
CREATE INDEX uq_document_reference ON documents (reference);

CREATE INDEX idx_learners_school_live         ON learners (school_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_charges_learner_fee_period   ON charges (learner_id, income_category_id, payment_period_id, academic_year_id);
CREATE INDEX idx_charges_enrolment            ON charges (enrolment_id);
CREATE INDEX idx_charges_income_category      ON charges (income_category_id);
CREATE INDEX idx_payment_allocations_charge   ON payment_allocations (charge_id);
CREATE INDEX idx_payments_school_paid_at      ON payments (school_id, paid_at DESC);
CREATE INDEX idx_expenses_school_date         ON expenses (school_id, expense_date DESC);
CREATE INDEX idx_expenses_category_date       ON expenses (expense_category_id, expense_date DESC, expense_id DESC);
CREATE INDEX idx_enrolments_year_class        ON enrolments (academic_year_id, class_category_id);
CREATE INDEX idx_payroll_lines_run            ON payroll_lines (payroll_run_id);
CREATE INDEX idx_documents_school_issued      ON documents (school_id, issued_at DESC);
CREATE INDEX idx_documents_learner            ON documents (learner_id);
CREATE INDEX idx_audit_log_school             ON audit_log (school_id, occurred_at DESC);

-- ── Read-only views for the website ────────────────────────────────────────

-- One row per payment and the fee/period it paid for (a payment is
-- allocated to exactly one charge in practice; a split payment shows once
-- per charge).
CREATE VIEW v_payment_lines AS
SELECT
    p.payment_id, p.school_id, p.paid_at, date(p.paid_at) AS paid_on,
    p.amount_cents, pm.method_name,
    l.learner_id, l.first_name, l.last_name,
    ic.income_category_id, ic.income_name, ic.priority,
    pp.payment_period_id, pp.period_name,
    ay.academic_year_id, ay.academic_year_name,
    TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS recorded_by
FROM payments p
JOIN payment_allocations pa ON pa.payment_id = p.payment_id
JOIN charges c ON c.charge_id = pa.charge_id
JOIN learners l ON l.learner_id = c.learner_id
JOIN income_categories ic ON ic.income_category_id = c.income_category_id
JOIN payment_periods pp ON pp.payment_period_id = c.payment_period_id
JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id
LEFT JOIN payment_methods pm ON pm.payment_method_id = p.payment_method_id
LEFT JOIN employees e ON e.employee_id = p.recorded_by_employee_id;

-- Takings per school per day (dates are UTC).
CREATE VIEW v_daily_takings AS
SELECT school_id, date(paid_at) AS day, COUNT(*) AS payments, SUM(amount_cents) AS total_cents
FROM payments
GROUP BY school_id, date(paid_at);

-- Spending per school, category and month.
CREATE VIEW v_expense_totals AS
SELECT x.school_id, ec.expense_category_id, ec.expense_name,
       substr(x.expense_date, 1, 7) AS month,
       COUNT(*) AS expenses, SUM(x.amount_cents) AS total_cents
FROM expenses x
JOIN expense_categories ec ON ec.expense_category_id = x.expense_category_id
GROUP BY x.school_id, ec.expense_category_id, ec.expense_name, substr(x.expense_date, 1, 7);

-- What each learner should be paying, per fee, period and year, and how
-- much of it is paid. A direct port of the desktop app's obligations engine
-- (repositories/payment/read/obligationsQuery.ts) with money in cents and
-- school_id as a column instead of a parameter: keep the two in step.
CREATE VIEW v_obligations AS
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
    l.school_id, l.learner_id, l.first_name, l.last_name, g.gender_name,
    ca.class_category_id, ca.class_name,
    ic.income_category_id, ic.income_name, ic.priority,
    pp.payment_period_id, pp.period_name,
    ay.academic_year_id, ay.academic_year_name,
    ic.income_limit_cents AS expected_cents,
    COALESCE(SUM(p.amount_cents), 0) AS paid_cents
  FROM learners l
  JOIN enrolments e ON e.learner_id = l.learner_id
  JOIN class_categories ca ON ca.class_category_id = e.class_category_id
  JOIN academic_years ay ON ay.academic_year_id = e.academic_year_id
  LEFT JOIN genders g ON g.gender_id = l.gender_id
  JOIN income_categories ic ON ic.school_id = l.school_id AND ic.priority = 'MANDATORY'
  JOIN payment_periods pp ON pp.school_id = l.school_id
  LEFT JOIN charges c
    ON c.learner_id = l.learner_id
   AND c.income_category_id = ic.income_category_id
   AND c.payment_period_id = pp.payment_period_id
   AND c.academic_year_id = ay.academic_year_id
  LEFT JOIN payment_allocations pa ON pa.charge_id = c.charge_id
  LEFT JOIN payments p ON p.payment_id = pa.payment_id
  WHERE l.deleted_at IS NULL
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
  GROUP BY l.school_id, l.learner_id, ca.class_category_id, ic.income_category_id,
           pp.payment_period_id, ay.academic_year_id
),
optional AS (
  SELECT
    l.school_id, l.learner_id, l.first_name, l.last_name, g.gender_name,
    ca.class_category_id, ca.class_name,
    ic.income_category_id, ic.income_name, ic.priority,
    pp.payment_period_id, pp.period_name,
    ay.academic_year_id, ay.academic_year_name,
    ic.income_limit_cents AS expected_cents,
    COALESCE(SUM(p.amount_cents), 0) AS paid_cents
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
  WHERE l.deleted_at IS NULL
  GROUP BY l.school_id, l.learner_id, ca.class_category_id, ic.income_category_id,
           pp.payment_period_id, ay.academic_year_id
),
optional_recurring AS (
  SELECT DISTINCT
    l.school_id, l.learner_id, l.first_name, l.last_name, g.gender_name,
    ca.class_category_id, ca.class_name,
    ic.income_category_id, ic.income_name, ic.priority,
    pp_now.payment_period_id, pp_now.period_name,
    ay.academic_year_id, ay.academic_year_name,
    ic.income_limit_cents AS expected_cents,
    0 AS paid_cents
  FROM learners l
  JOIN enrolments e ON e.learner_id = l.learner_id
  JOIN class_categories ca ON ca.class_category_id = e.class_category_id
  JOIN academic_years ay ON ay.academic_year_id = e.academic_year_id
  LEFT JOIN genders g ON g.gender_id = l.gender_id
  JOIN income_categories ic ON ic.school_id = l.school_id AND ic.priority = 'OPTIONAL'
  JOIN period_months pm_now ON pm_now.school_id = l.school_id
  JOIN payment_periods pp_now ON pp_now.payment_period_id = pm_now.payment_period_id
  WHERE l.deleted_at IS NULL
    AND (
      ic.period_applicability = 'ALL_PERIODS'
      OR EXISTS (
            SELECT 1 FROM income_category_periods icp
            WHERE icp.income_category_id = ic.income_category_id
              AND icp.payment_period_id = pp_now.payment_period_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM charges already
      WHERE already.learner_id = l.learner_id
        AND already.income_category_id = ic.income_category_id
        AND already.payment_period_id = pp_now.payment_period_id
    )
    AND EXISTS (
      SELECT 1
      FROM charges prior
      JOIN period_months pm_prior ON pm_prior.payment_period_id = prior.payment_period_id
      WHERE prior.learner_id = l.learner_id
        AND prior.income_category_id = ic.income_category_id
        AND pm_prior.school_id = l.school_id
        AND pm_prior.month_number < pm_now.month_number
    )
)
SELECT *,
  (expected_cents - paid_cents) AS balance_cents,
  CASE
    WHEN paid_cents <= 0 THEN 'NO_PAYMENT'
    WHEN paid_cents < expected_cents THEN 'PARTIALLY_PAID'
    ELSE 'FULLY_PAID'
  END AS status
FROM (
  SELECT * FROM mandatory
  UNION ALL SELECT * FROM optional
  UNION ALL SELECT * FROM optional_recurring
)
WHERE expected_cents IS NOT NULL;

-- Each learner's totals across v_obligations (the desktop "Owing" page).
CREATE VIEW v_learner_balances AS
SELECT school_id, learner_id, first_name, last_name, class_name,
       SUM(CASE WHEN priority = 'MANDATORY' AND balance_cents > 0 THEN balance_cents ELSE 0 END) AS mandatory_owing_cents,
       SUM(CASE WHEN priority <> 'MANDATORY' AND balance_cents > 0 THEN balance_cents ELSE 0 END) AS optional_owing_cents,
       SUM(CASE WHEN balance_cents > 0 THEN balance_cents ELSE 0 END) AS total_owing_cents,
       SUM(paid_cents) AS paid_cents,
       SUM(paid_cents) + SUM(CASE WHEN balance_cents > 0 THEN balance_cents ELSE 0 END) AS billed_cents
FROM v_obligations
GROUP BY school_id, learner_id, first_name, last_name, class_name;
