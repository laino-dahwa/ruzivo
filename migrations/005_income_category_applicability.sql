-- Up Migration
--
-- Income categories gain a priority — MANDATORY fees are owed by every
-- applicable learner even before any charge exists; OPTIONAL fees only ever
-- appear once a learner has an actual charge, exactly as today — plus two
-- independent applicability dimensions: which learners a fee applies to
-- (class_applicability), and which of the school's own payment periods it
-- applies to (period_applicability). Nothing about class/period names is
-- hardcoded anywhere — the admin configures membership via the two join
-- tables below.
--
-- Defaults (MANDATORY / ALL_LEARNERS / ALL_PERIODS) preserve exactly today's
-- implicit behaviour for every existing category. The one deliberate
-- behaviour change is the point of this migration: existing mandatory fees
-- will now correctly surface learners who have never made a payment.

ALTER TABLE income_categories
    ADD COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'MANDATORY',
    ADD COLUMN class_applicability VARCHAR(20) NOT NULL DEFAULT 'ALL_LEARNERS',
    ADD COLUMN period_applicability VARCHAR(20) NOT NULL DEFAULT 'ALL_PERIODS';

ALTER TABLE income_categories
    ADD CONSTRAINT chk_income_priority
        CHECK (priority IN ('MANDATORY', 'OPTIONAL')),
    ADD CONSTRAINT chk_income_class_applicability
        CHECK (class_applicability IN ('ALL_LEARNERS', 'SPECIFIC_CLASSES', 'SPECIFIC_LEARNERS')),
    ADD CONSTRAINT chk_income_period_applicability
        CHECK (period_applicability IN ('ALL_PERIODS', 'SPECIFIC_PERIODS'));

-- Modeled on payment_allocations: surrogate PK + 2 FKs + composite UNIQUE.
-- Cascades from all three sides (income_categories, class_categories,
-- learners, payment_periods) — matching the existing
-- expenses.fk_expense_category precedent (see referenceTables.ts's
-- EXPENSE_CATEGORIES comment): a school-wide delete must be able to remove
-- everything in one statement, and Postgres's cascade resolution across two
-- independent CASCADE paths that both terminate here (schools -> class_categories
-- and schools -> income_categories -> income_category_classes) is not
-- reliably ordered within one DELETE FROM schools otherwise, which broke
-- deleteSchool() outright once any fee had class/period applicability
-- configured. Deleting a class/period while a fee still names it directly
-- (outside a whole-school delete) is still refused up front by the app-level
-- dependents-check in repositories/school/referenceTable.ts — the DB-level
-- cascade here is never exercised by that guarded path.

CREATE TABLE income_category_classes (
    income_category_class_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    income_category_id BIGINT NOT NULL,
    class_category_id BIGINT NOT NULL,

    CONSTRAINT fk_icc_income_category
        FOREIGN KEY (income_category_id)
        REFERENCES income_categories(income_category_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_icc_class_category
        FOREIGN KEY (class_category_id)
        REFERENCES class_categories(class_category_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_income_category_class
        UNIQUE (income_category_id, class_category_id)
);

CREATE TABLE income_category_learners (
    income_category_learner_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    income_category_id BIGINT NOT NULL,
    learner_id VARCHAR(8) NOT NULL,

    CONSTRAINT fk_icl_income_category
        FOREIGN KEY (income_category_id)
        REFERENCES income_categories(income_category_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_icl_learner
        FOREIGN KEY (learner_id)
        REFERENCES learners(learner_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_income_category_learner
        UNIQUE (income_category_id, learner_id)
);

CREATE TABLE income_category_periods (
    income_category_period_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    income_category_id BIGINT NOT NULL,
    payment_period_id BIGINT NOT NULL,

    CONSTRAINT fk_icp_income_category
        FOREIGN KEY (income_category_id)
        REFERENCES income_categories(income_category_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_icp_payment_period
        FOREIGN KEY (payment_period_id)
        REFERENCES payment_periods(payment_period_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_income_category_period
        UNIQUE (income_category_id, payment_period_id)
);

-- Down Migration

DROP TABLE IF EXISTS income_category_periods;
DROP TABLE IF EXISTS income_category_learners;
DROP TABLE IF EXISTS income_category_classes;

ALTER TABLE income_categories
    DROP CONSTRAINT IF EXISTS chk_income_priority,
    DROP CONSTRAINT IF EXISTS chk_income_class_applicability,
    DROP CONSTRAINT IF EXISTS chk_income_period_applicability;

ALTER TABLE income_categories
    DROP COLUMN IF EXISTS priority,
    DROP COLUMN IF EXISTS class_applicability,
    DROP COLUMN IF EXISTS period_applicability;
