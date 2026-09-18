-- Up Migration
--
-- Authentication, two access levels, and an audit trail.
--
-- Everything here is additive: no existing row is rewritten, and the app
-- keeps working with the new columns unused until the application code
-- starts reading them.
--
-- This migration deliberately INSERTS NO ROWS. There is no seeded
-- administrator and no default password anywhere in the schema or the
-- codebase — the first administrator is created by POST /api/auth/bootstrap
-- with a password the user chooses, and that endpoint refuses to run once
-- one exists.

-- 1. Access level on roles ---------------------------------------------------
--
-- Roles were free-text labels with no semantics (004_roles). They now carry
-- the only two access levels the app has. DEFAULT 'CASHIER' is what makes
-- this safe to apply to a database that already has roles and employees:
-- every existing role lands least-privilege, so nobody gains administrator
-- access by the mere act of migrating.

ALTER TABLE roles
    ADD COLUMN access_level VARCHAR(10) NOT NULL DEFAULT 'CASHIER';

ALTER TABLE roles
    ADD CONSTRAINT chk_role_access_level
        CHECK (access_level IN ('ADMIN', 'CASHIER'));

-- 2. Employee account lifecycle ----------------------------------------------
--
-- deleted_at mirrors learners.deleted_at (001_initial_schema): deactivating
-- an employee must be a soft delete, because payments.recorded_by_employee_id
-- and audit_log.employee_id point here, and hard-deleting would erase who
-- recorded what.

ALTER TABLE employees ADD COLUMN deleted_at         TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN last_login_at      TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN locked_until       TIMESTAMPTZ;

-- 3. Sessions ----------------------------------------------------------------
--
-- Server-side sessions rather than a signed stateless cookie: there is
-- nowhere to keep a signing secret that works for both the web deployment and
-- the desktop build (electron/config-store.ts holds only the Postgres
-- password), and revocation — forced password change, admin reset, employee
-- deactivation — needs a database round trip regardless.
--
-- token_hash is a plain SHA-256 of a 256-bit random token, NOT a scrypt hash.
-- The token has no dictionary to attack, and a KDF here would add ~80ms to
-- every single API request rather than just to logins. See lib/auth/token.ts.

CREATE TABLE sessions (
    session_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id BIGINT NOT NULL,
    token_hash CHAR(64) NOT NULL,

    -- The school this session is currently acting on. Replaces the
    -- client-side localStorage "current school" as the source of truth;
    -- an administrator may change it, a cashier may not.
    active_school_id CHAR(4) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Idle expiry, slid forward on use.
    expires_at TIMESTAMPTZ NOT NULL,
    -- Hard cap, never extended.
    absolute_expires_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT uq_session_token UNIQUE (token_hash),

    -- CASCADE: a session is worthless without its employee, and deleting a
    -- school already cascades into employees (003_employees), so this must
    -- cascade too or deleteSchool() would fail for any school with a live
    -- login. Same reasoning for the school reference.
    CONSTRAINT fk_session_employee
        FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_session_school
        FOREIGN KEY (active_school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE
);

-- uq_session_token already indexes the lookup column; these two cover
-- revoke-all-for-employee and the expired-session sweep.
CREATE INDEX idx_sessions_employee   ON sessions (employee_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

-- 4. Who recorded it ---------------------------------------------------------
--
-- A column as well as an audit row, because "who took this money" is a
-- display attribute: it appears in the Payments table, the payments PDF, and
-- the printed receipt (lib/receipt/buildReceiptHtml.ts).
--
-- Nullable and never backfilled: payments recorded before this migration have
-- no knowable actor, and inventing one would be worse than an honest blank.
--
-- ON DELETE SET NULL, not NO ACTION. NO ACTION reads better ("never lose the
-- actor") but deadlocks the schema: employees.fk_employee_school is already
-- ON DELETE CASCADE, so DELETE FROM schools cascades into employees, and a
-- restricting reference from payments would make deleting any school with
-- staff fail outright. SET NULL keeps deleteSchool() a single statement while
-- still never cascading a payment away along with its recorder.

ALTER TABLE payments ADD COLUMN recorded_by_employee_id BIGINT;

ALTER TABLE payments
    ADD CONSTRAINT fk_payment_recorded_by
        FOREIGN KEY (recorded_by_employee_id)
        REFERENCES employees(employee_id)
        ON DELETE SET NULL;

CREATE INDEX idx_payments_recorded_by ON payments (recorded_by_employee_id);

ALTER TABLE expenses ADD COLUMN recorded_by_employee_id BIGINT;

ALTER TABLE expenses
    ADD CONSTRAINT fk_expense_recorded_by
        FOREIGN KEY (recorded_by_employee_id)
        REFERENCES employees(employee_id)
        ON DELETE SET NULL;

-- 5. Audit log ---------------------------------------------------------------
--
-- Payment deletion is a hard delete, so "who removed this payment" has no row
-- left to hang a column off. This table is where those facts live, alongside
-- sign-ins, account changes and school deletions.

CREATE TABLE audit_log (
    audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- SET NULL for the same reason as payments.recorded_by_employee_id.
    employee_id BIGINT,
    -- Snapshot of who it was, so the entry stays readable after the employee
    -- row is gone and employee_id has been nulled.
    actor_label VARCHAR(255) NOT NULL,

    -- Deliberately NOT a foreign key. Every other school_id in this schema
    -- cascades, and cascading here would erase the audit trail of a school
    -- deletion at the very moment it is most wanted. This column records a
    -- fact about the past, not a live relationship.
    school_id CHAR(4),

    action VARCHAR(60) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    -- TEXT, not BIGINT: learner_id is VARCHAR(8) while every other id is a
    -- bigint, and one nullable text column beats two typed ones.
    entity_id TEXT,
    summary TEXT NOT NULL,
    detail JSONB,

    CONSTRAINT fk_audit_employee
        FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id)
        ON DELETE SET NULL
);

CREATE INDEX idx_audit_log_occurred_at ON audit_log (occurred_at DESC);
CREATE INDEX idx_audit_log_school      ON audit_log (school_id, occurred_at DESC);

-- Down Migration

DROP TABLE IF EXISTS audit_log;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS fk_expense_recorded_by;
ALTER TABLE expenses DROP COLUMN IF EXISTS recorded_by_employee_id;

DROP INDEX IF EXISTS idx_payments_recorded_by;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS fk_payment_recorded_by;
ALTER TABLE payments DROP COLUMN IF EXISTS recorded_by_employee_id;

DROP TABLE IF EXISTS sessions;

ALTER TABLE employees DROP COLUMN IF EXISTS locked_until;
ALTER TABLE employees DROP COLUMN IF EXISTS failed_login_count;
ALTER TABLE employees DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE employees DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE roles DROP CONSTRAINT IF EXISTS chk_role_access_level;
ALTER TABLE roles DROP COLUMN IF EXISTS access_level;
