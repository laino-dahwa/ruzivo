-- Up Migration
--
-- Extracted from the previous ad hoc bootstrap in lib/db.ts (`initializeDatabase()`,
-- now removed — it was dead code, never actually called anywhere in the app),
-- then reconciled column-for-column and constraint-for-constraint against the
-- real, working development database (which the app has always actually run
-- against) using `information_schema`/`pg_constraint`. That live database had
-- clearly been patched by hand at some point without the DDL script ever being
-- updated to match — several real, functional bugs were found and fixed here
-- rather than preserved, since a genuinely fresh install (this migration's
-- whole purpose) would otherwise produce a database the application cannot
-- actually use correctly:
--
--   1. Table creation order: `learners` referenced `genders`, and `payments`
--      referenced `payment_methods`, before either table was defined —
--      running the original script against a truly empty database would
--      fail outright. `genders` and `payment_methods` are created first here.
--   2. Column name drift: the DDL said `academic_years.name`, but every
--      repository query (getLearners, getPayments, createAcademicYear, etc.)
--      reads/writes `academic_years.academic_year_name`.
--   3. `genders` and `payment_methods` were missing their `school_id` column
--      entirely, even though `getGender`/`getPaymentMethods`/the create
--      repositories all filter/insert by it — every other per-school
--      reference table has it. Without this fix, loading School Setup (or
--      any page that fetches reference data) on a fresh database fails with
--      `column "school_id" does not exist`.
--   4. Every `fk_*_school` foreign key (class_categories, payment_periods,
--      expense_categories, income_categories, academic_years, genders,
--      payment_methods) is `ON DELETE CASCADE` in the live database, but the
--      DDL never had that. `deleteSchool()` is a bare
--      `DELETE FROM schools WHERE school_id = $1` with no manual cleanup of
--      child rows — without CASCADE, deleting any school that already has
--      reference data fails with a foreign-key violation instead of working.
--      `expenses.fk_expense_category` is also CASCADE in the live database.
--      (`learners`' FKs to `schools`/`genders` are deliberately NOT cascading,
--      matching the live database — learner deletion is a soft delete, not
--      a hard one, so this was never actually inconsistent.)
--   5. `schools` had extra `updated_at`/`deleted_at` columns, and `payments`
--      had extra `payment_method`/`reference` columns plus a `UNIQUE
--      (reference)` constraint, none of which exist in the live database or
--      are read/written by any repository — removed rather than carried
--      forward as unused, inconsistent schema.

CREATE TABLE schools (
    school_id CHAR(4) PRIMARY KEY,
    school_name VARCHAR(200) NOT NULL,
    school_type VARCHAR(100),
    school_address TEXT,
    school_contact VARCHAR(50),
    school_email VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE genders (
    gender_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    gender_name VARCHAR(100) NOT NULL,

    CONSTRAINT fk_gender_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_gender
        UNIQUE (school_id, gender_name)
);

CREATE TABLE payment_methods (
    payment_method_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    method_name VARCHAR(100) NOT NULL,

    CONSTRAINT fk_payment_methods_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_payment_method
        UNIQUE (school_id, method_name)
);

CREATE TABLE class_categories (
    class_category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    class_name VARCHAR(100) NOT NULL,

    CONSTRAINT fk_class_category_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_class_category
        UNIQUE (school_id, class_name)
);

CREATE TABLE payment_periods (
    payment_period_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    period_name VARCHAR(100) NOT NULL,

    CONSTRAINT fk_payment_period_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_payment_period
        UNIQUE (school_id, period_name)
);

CREATE TABLE expense_categories (
    expense_category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    expense_name VARCHAR(150) NOT NULL,

    CONSTRAINT fk_expense_category_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_expense_category
        UNIQUE (school_id, expense_name)
);

CREATE TABLE income_categories (
    income_category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    income_name VARCHAR(150) NOT NULL,
    income_limit NUMERIC(12,2),

    CONSTRAINT fk_income_category_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_income_category
        UNIQUE (school_id, income_name),

    CONSTRAINT chk_income_limit
        CHECK (income_limit IS NULL OR income_limit >= 0)
);

CREATE TABLE academic_years (
    academic_year_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    academic_year_name VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    CONSTRAINT fk_academic_year_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_academic_year
        UNIQUE (school_id, academic_year_name),

    CONSTRAINT chk_academic_year_dates
        CHECK (end_date > start_date)
);

CREATE TABLE learners (
    learner_id VARCHAR(8) PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    gender_id BIGINT,
    date_of_birth DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,

    CONSTRAINT fk_learner_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id),

    CONSTRAINT fk_learner_gender
        FOREIGN KEY (gender_id)
        REFERENCES genders(gender_id)
);

CREATE TABLE enrolments (
    enrolment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    learner_id VARCHAR(8) NOT NULL,
    class_category_id BIGINT NOT NULL,
    academic_year_id BIGINT NOT NULL,

    CONSTRAINT fk_enrolment_learner
        FOREIGN KEY (learner_id)
        REFERENCES learners(learner_id),

    CONSTRAINT fk_enrolment_class
        FOREIGN KEY (class_category_id)
        REFERENCES class_categories(class_category_id),

    CONSTRAINT fk_enrolment_year
        FOREIGN KEY (academic_year_id)
        REFERENCES academic_years(academic_year_id),

    CONSTRAINT uq_learner_year
        UNIQUE (learner_id, academic_year_id)
);

CREATE TABLE expenses (
    expense_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    expense_category_id BIGINT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    expense_date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_expense_category
        FOREIGN KEY (expense_category_id)
        REFERENCES expense_categories(expense_category_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_expense_amount
        CHECK (amount > 0)
);

CREATE TABLE charges (
    charge_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    learner_id VARCHAR(8) NOT NULL,
    enrolment_id BIGINT NOT NULL,
    income_category_id BIGINT NOT NULL,
    payment_period_id BIGINT NOT NULL,
    academic_year_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_charge_learner
        FOREIGN KEY (learner_id)
        REFERENCES learners(learner_id),

    CONSTRAINT fk_charge_enrolment
        FOREIGN KEY (enrolment_id)
        REFERENCES enrolments(enrolment_id),

    CONSTRAINT fk_charge_income_category
        FOREIGN KEY (income_category_id)
        REFERENCES income_categories(income_category_id),

    CONSTRAINT fk_charge_period
        FOREIGN KEY (payment_period_id)
        REFERENCES payment_periods(payment_period_id),

    CONSTRAINT fk_charge_year
        FOREIGN KEY (academic_year_id)
        REFERENCES academic_years(academic_year_id)
);

CREATE TABLE payments (
    payment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    amount NUMERIC(12,2) NOT NULL,
    payment_method_id BIGINT,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payment_method
        FOREIGN KEY (payment_method_id)
        REFERENCES payment_methods(payment_method_id),

    CONSTRAINT chk_payment_amount
        CHECK (amount > 0)
);

CREATE TABLE payment_allocations (
    allocation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL,
    charge_id BIGINT NOT NULL,

    CONSTRAINT fk_allocation_payment
        FOREIGN KEY (payment_id)
        REFERENCES payments(payment_id),

    CONSTRAINT fk_allocation_charge
        FOREIGN KEY (charge_id)
        REFERENCES charges(charge_id),

    CONSTRAINT uq_payment_charge
        UNIQUE (payment_id, charge_id)
);

-- Down Migration

DROP TABLE IF EXISTS payment_allocations CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS charges CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS enrolments CASCADE;
DROP TABLE IF EXISTS learners CASCADE;
DROP TABLE IF EXISTS academic_years CASCADE;
DROP TABLE IF EXISTS income_categories CASCADE;
DROP TABLE IF EXISTS expense_categories CASCADE;
DROP TABLE IF EXISTS payment_periods CASCADE;
DROP TABLE IF EXISTS class_categories CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;
DROP TABLE IF EXISTS genders CASCADE;
DROP TABLE IF EXISTS schools CASCADE;
