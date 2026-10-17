-- Up Migration
--
-- Indexes for the tables that grow with every payment and expense.
--
-- PostgreSQL does not index foreign-key columns automatically, and until now
-- only the auth, documents and payroll tables had any secondary indexes — so
-- every join from learners to charges, charges to payment_allocations, and
-- expense_categories to expenses was a full table scan. That stays invisible
-- with a few hundred rows and becomes the dominant cost once a school has a
-- few years of payments.
--
-- Columns already covered by an existing UNIQUE constraint are not repeated:
-- payment_allocations (payment_id, charge_id) covers lookups by payment_id,
-- and enrolments (learner_id, academic_year_id) covers lookups by learner_id.

-- A school's live learners — the starting point of nearly every list.
CREATE INDEX idx_learners_school_live ON learners (school_id) WHERE deleted_at IS NULL;

-- Charges by learner, in the column order the balances and obligations
-- queries match on (learner, fee, period, year). Also serves learner_id alone.
CREATE INDEX idx_charges_learner_fee_period ON charges (learner_id, income_category_id, payment_period_id, academic_year_id);
CREATE INDEX idx_charges_enrolment ON charges (enrolment_id);
CREATE INDEX idx_charges_income_category ON charges (income_category_id);

-- charge -> payment, the other direction from the existing unique constraint.
CREATE INDEX idx_payment_allocations_charge ON payment_allocations (charge_id);

-- Newest-first payment lists and date-range reports.
CREATE INDEX idx_payments_paid_at ON payments (paid_at DESC);

-- A school's expenses newest-first (schools reach expenses through their
-- categories), matching the Expenses page's sort and paging cursor.
CREATE INDEX idx_expenses_category_date ON expenses (expense_category_id, expense_date DESC, expense_id DESC);
CREATE INDEX idx_expenses_date ON expenses (expense_date DESC);

-- Enrolments by year and class, for class/year filters and reports.
CREATE INDEX idx_enrolments_year_class ON enrolments (academic_year_id, class_category_id);

-- Down Migration

DROP INDEX IF EXISTS idx_enrolments_year_class;
DROP INDEX IF EXISTS idx_expenses_date;
DROP INDEX IF EXISTS idx_expenses_category_date;
DROP INDEX IF EXISTS idx_payments_paid_at;
DROP INDEX IF EXISTS idx_payment_allocations_charge;
DROP INDEX IF EXISTS idx_charges_income_category;
DROP INDEX IF EXISTS idx_charges_enrolment;
DROP INDEX IF EXISTS idx_charges_learner_fee_period;
DROP INDEX IF EXISTS idx_learners_school_live;
