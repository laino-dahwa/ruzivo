-- Up Migration
--
-- Expected fees become suggestions that someone confirms, and Balances becomes
-- the single source of truth for what a learner owes.
--
-- The obligations engine (repositories/expected-fees/) still works out which
-- fees a learner should be paying. Until now those projections were counted
-- as owing in places (the cloud website); from here on they are only
-- suggestions, and nothing is owed until it is accepted:
--
--   fee_decisions   one row per learner + fee + period + academic year that
--                   someone has decided on:
--                     ACCEPTED - owed. `amount` is fixed at the moment of
--                                acceptance, so a later change to the fee's
--                                limit never rewrites an existing balance.
--                     SKIPPED  - denied for this period only. The same fee is
--                                suggested again for the next period.
--                   `source` says how a fee was accepted: DECISION (someone
--                   pressed Accept) or PAYMENT (a payment was recorded against
--                   it, which counts as accepting it). A PAYMENT acceptance is
--                   removed again if its last payment is deleted, so deleting a
--                   mistaken payment never leaves a debt behind.
--
--   fee_exemptions  denied forever: this learner is never suggested this fee
--                   again, in any period or year. A reason is required.
--
-- Every learner + fee + period that already has a payment is accepted here,
-- at the fee's current limit - exactly the figure Balances showed for it
-- before this migration - so no balance changes on upgrade.

CREATE TABLE fee_decisions (
    fee_decision_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    learner_id VARCHAR(8) NOT NULL,
    income_category_id BIGINT NOT NULL,
    payment_period_id BIGINT NOT NULL,
    academic_year_id BIGINT NOT NULL,
    decision VARCHAR(10) NOT NULL,
    -- NULL for an accepted fee with no limit configured (it can be paid, but
    -- there is no figure to owe) and always NULL for a skipped one.
    amount NUMERIC(12,2),
    source VARCHAR(10) NOT NULL DEFAULT 'DECISION',
    -- SET NULL like payments.recorded_by_employee_id; the label keeps the
    -- name readable after the employee row is gone.
    decided_by_employee_id BIGINT,
    decided_by_label VARCHAR(255),
    decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Every parent cascades. Deleting a fee, period or academic year that
    -- has decisions is refused earlier, by the reference-data guard
    -- (repositories/school/referenceTables.ts); the cascades are for deleting
    -- a whole school, and learners, which are only ever hard-deleted with it.
    CONSTRAINT fk_fee_decision_school FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_decision_learner FOREIGN KEY (learner_id) REFERENCES learners(learner_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_decision_income FOREIGN KEY (income_category_id) REFERENCES income_categories(income_category_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_decision_period FOREIGN KEY (payment_period_id) REFERENCES payment_periods(payment_period_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_decision_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_decision_employee FOREIGN KEY (decided_by_employee_id) REFERENCES employees(employee_id) ON DELETE SET NULL,

    CONSTRAINT uq_fee_decision UNIQUE (learner_id, income_category_id, payment_period_id, academic_year_id),
    CONSTRAINT chk_fee_decision CHECK (decision IN ('ACCEPTED', 'SKIPPED')),
    CONSTRAINT chk_fee_decision_source CHECK (source IN ('DECISION', 'PAYMENT')),
    CONSTRAINT chk_fee_decision_amount CHECK (amount IS NULL OR amount >= 0),
    CONSTRAINT chk_fee_decision_skip_amount CHECK (decision = 'ACCEPTED' OR amount IS NULL)
);

CREATE INDEX idx_fee_decisions_school ON fee_decisions (school_id, decision);

CREATE TABLE fee_exemptions (
    fee_exemption_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    learner_id VARCHAR(8) NOT NULL,
    income_category_id BIGINT NOT NULL,
    reason TEXT NOT NULL,
    exempted_by_employee_id BIGINT,
    exempted_by_label VARCHAR(255),
    exempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_fee_exemption_school FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_exemption_learner FOREIGN KEY (learner_id) REFERENCES learners(learner_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_exemption_income FOREIGN KEY (income_category_id) REFERENCES income_categories(income_category_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_exemption_employee FOREIGN KEY (exempted_by_employee_id) REFERENCES employees(employee_id) ON DELETE SET NULL,

    CONSTRAINT uq_fee_exemption UNIQUE (learner_id, income_category_id),
    CONSTRAINT chk_fee_exemption_reason CHECK (length(trim(reason)) > 0)
);

CREATE INDEX idx_fee_exemptions_school ON fee_exemptions (school_id);

-- Mirrored to the cloud website like every other table (014_sync_outbox).
-- Created before the backfill below, so the accepted rows it writes reach the
-- website as ordinary changes.
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON fee_decisions  FOR EACH ROW EXECUTE FUNCTION sync_capture('fee_decision_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON fee_exemptions FOR EACH ROW EXECUTE FUNCTION sync_capture('fee_exemption_id');

INSERT INTO fee_decisions (
    school_id, learner_id, income_category_id, payment_period_id, academic_year_id,
    decision, amount, source, decided_by_label, decided_at
)
SELECT
    l.school_id, c.learner_id, c.income_category_id, c.payment_period_id, c.academic_year_id,
    'ACCEPTED', ic.income_limit, 'PAYMENT', 'Recorded payment', MIN(c.created_at)
FROM charges c
JOIN learners l ON l.learner_id = c.learner_id
JOIN income_categories ic ON ic.income_category_id = c.income_category_id
GROUP BY l.school_id, c.learner_id, c.income_category_id, c.payment_period_id, c.academic_year_id, ic.income_limit;

-- Down Migration

DROP TRIGGER IF EXISTS sync_capture ON fee_exemptions;
DROP TRIGGER IF EXISTS sync_capture ON fee_decisions;
DROP TABLE IF EXISTS fee_exemptions;
DROP TABLE IF EXISTS fee_decisions;
