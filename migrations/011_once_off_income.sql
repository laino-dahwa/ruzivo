-- Up Migration
--
-- A third kind of income category: ONCE_OFF.
--
-- MANDATORY and OPTIONAL both feed the obligations engine (Unpaid Mandatory,
-- optional-recurring projections). A once-off fee — registration in Term 1,
-- an exam levy in a given month — is neither: it is never projected as owed,
-- and is set up for specific payment periods (income_category_periods, at
-- least one). It is paid once in each of those periods, cannot be paid in any
-- other, and only by the learners it applies to (all, specific classes or
-- specific learners) — enforced in repositories/payment/create/createNewPayment.ts.

ALTER TABLE income_categories DROP CONSTRAINT chk_income_priority;
ALTER TABLE income_categories
    ADD CONSTRAINT chk_income_priority
        CHECK (priority IN ('MANDATORY', 'OPTIONAL', 'ONCE_OFF'));

-- Down Migration

-- Rolling back cannot leave rows the old constraint rejects, so any once-off
-- fees revert to OPTIONAL (owed only once charged — the closest behaviour).
UPDATE income_categories SET priority = 'OPTIONAL' WHERE priority = 'ONCE_OFF';
ALTER TABLE income_categories DROP CONSTRAINT IF EXISTS chk_income_priority;
ALTER TABLE income_categories
    ADD CONSTRAINT chk_income_priority
        CHECK (priority IN ('MANDATORY', 'OPTIONAL'));
