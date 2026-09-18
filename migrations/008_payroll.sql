-- Up Migration
--
-- Payroll: what each member of staff is paid, and a frozen record of every
-- month that has been run.
--
-- Employees carried no pay information at all before this — name, role,
-- email and login state only.

-- 1. What each employee is paid ---------------------------------------------
--
-- Fixed columns rather than a general "pay components" table: the set here
-- is what a payslip in this setting actually carries, and a table of
-- arbitrary named lines would need its own editing UI for no benefit anyone
-- has asked for. If bonuses or loan repayments are needed later, that is the
-- point to add the table — not before.
--
-- All nullable and defaulting to zero, so existing staff are unaffected
-- until somebody enters their figures. An employee with no basic salary is
-- deliberately left out of a payroll run rather than being paid nothing.
--
-- NUMERIC(12,2), matching payments.amount and income_categories.income_limit:
-- money is never a float in this schema.
ALTER TABLE employees ADD COLUMN basic_salary        NUMERIC(12,2);
ALTER TABLE employees ADD COLUMN transport_allowance NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN housing_allowance   NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN paye_deduction      NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN pension_deduction   NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE employees ADD CONSTRAINT chk_employee_pay_not_negative
    CHECK (
        (basic_salary IS NULL OR basic_salary >= 0)
        AND transport_allowance >= 0
        AND housing_allowance >= 0
        AND paye_deduction >= 0
        AND pension_deduction >= 0
    );

-- 2. A month that has been run ----------------------------------------------
--
-- One row per school per month. Re-running a month updates this row and
-- replaces its lines: payroll for September is a single fact, not a growing
-- pile of attempts. The audit log keeps the record that it was re-run.

CREATE TABLE payroll_runs (
    payroll_run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    period_year INT NOT NULL,
    period_month INT NOT NULL,

    generated_by_employee_id BIGINT,
    -- Name snapshot, so the run stays readable after the account is gone.
    generated_by_label VARCHAR(255) NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Salaries are the school's largest outgoing, so running payroll posts
    -- an expense for the month. Held here so re-running a month can update
    -- that one expense rather than posting a second one and double-counting
    -- the wage bill in every report.
    --
    -- SET NULL: if somebody deletes the expense by hand, the payroll run and
    -- its payslips must survive.
    expense_id BIGINT,

    CONSTRAINT uq_payroll_run_period UNIQUE (school_id, period_year, period_month),

    CONSTRAINT chk_payroll_month CHECK (period_month BETWEEN 1 AND 12),
    CONSTRAINT chk_payroll_year CHECK (period_year BETWEEN 2000 AND 2200),

    CONSTRAINT fk_payroll_run_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_payroll_run_generated_by
        FOREIGN KEY (generated_by_employee_id)
        REFERENCES employees(employee_id)
        ON DELETE SET NULL,

    CONSTRAINT fk_payroll_run_expense
        FOREIGN KEY (expense_id)
        REFERENCES expenses(expense_id)
        ON DELETE SET NULL
);

-- 3. What each person was actually paid that month ---------------------------
--
-- A frozen copy of the figures as they stood when the month was run. The
-- whole point: a pay rise in October must not silently rewrite what
-- September's payslip said. Only the components are stored — gross and net
-- are derived by lib/payroll/compute.ts, so a stored total can never drift
-- from the numbers it is supposed to be the sum of.

CREATE TABLE payroll_lines (
    payroll_line_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payroll_run_id BIGINT NOT NULL,

    -- SET NULL, like every other actor reference in this schema: losing the
    -- employee record must not erase what the school paid out.
    employee_id BIGINT,
    employee_label VARCHAR(255) NOT NULL,
    role_label VARCHAR(100) NOT NULL,
    employee_email VARCHAR(255),

    basic_salary        NUMERIC(12,2) NOT NULL,
    transport_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
    housing_allowance   NUMERIC(12,2) NOT NULL DEFAULT 0,
    paye_deduction      NUMERIC(12,2) NOT NULL DEFAULT 0,
    pension_deduction   NUMERIC(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT fk_payroll_line_run
        FOREIGN KEY (payroll_run_id)
        REFERENCES payroll_runs(payroll_run_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_payroll_line_employee
        FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id)
        ON DELETE SET NULL
);

CREATE INDEX idx_payroll_lines_run ON payroll_lines (payroll_run_id);
CREATE INDEX idx_payroll_runs_school ON payroll_runs (school_id, period_year DESC, period_month DESC);

-- Down Migration

DROP TABLE IF EXISTS payroll_lines;
DROP TABLE IF EXISTS payroll_runs;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_pay_not_negative;
ALTER TABLE employees DROP COLUMN IF EXISTS pension_deduction;
ALTER TABLE employees DROP COLUMN IF EXISTS paye_deduction;
ALTER TABLE employees DROP COLUMN IF EXISTS housing_allowance;
ALTER TABLE employees DROP COLUMN IF EXISTS transport_allowance;
ALTER TABLE employees DROP COLUMN IF EXISTS basic_salary;
