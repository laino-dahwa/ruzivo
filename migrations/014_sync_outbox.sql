-- Up Migration
--
-- Change capture for the cloud mirror (Cloudflare D1, see electron/sync/).
--
-- Every insert, update or delete on a mirrored table records the changed
-- row's primary key in sync_outbox. The sync engine reads the outbox, fetches
-- each row's CURRENT state (a row that no longer exists is sent as a delete),
-- sends the batch, and removes the outbox rows it sent. Only keys are
-- recorded, never values: the outbox can never disagree with the tables.
--
-- The trigger writes to the outbox in its own table's schema (TG_TABLE_SCHEMA),
-- so the restore's scratch schema (electron/backup/restore-backup.ts) fills
-- its own outbox, which is dropped with it, never the live one.
--
-- Neither table is backed up (EXCLUDED_TABLES in electron/backup/format.ts):
-- they describe this computer's link to the website, not school data. A
-- restore clears the outbox and asks for a full sync instead.

CREATE TABLE sync_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name TEXT NOT NULL,
    pk JSONB NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Small key/value store: needs_full_sync, last_success_at, last_error, ...
CREATE TABLE sync_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A fresh install (or one upgrading to this version) has never been synced.
INSERT INTO sync_state (key, value) VALUES ('needs_full_sync', 'true');

-- Trigger arguments are the table's primary key column names.
CREATE FUNCTION sync_capture() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    old_row JSONB;
    new_row JSONB;
    old_pk JSONB := '{}'::jsonb;
    new_pk JSONB := '{}'::jsonb;
    i INT;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;

    FOR i IN 0 .. TG_NARGS - 1 LOOP
        IF old_row IS NOT NULL THEN old_pk := old_pk || jsonb_build_object(TG_ARGV[i], old_row -> TG_ARGV[i]); END IF;
        IF new_row IS NOT NULL THEN new_pk := new_pk || jsonb_build_object(TG_ARGV[i], new_row -> TG_ARGV[i]); END IF;
    END LOOP;

    IF old_row IS NOT NULL THEN
        EXECUTE format('INSERT INTO %I.sync_outbox (table_name, pk) VALUES ($1, $2)', TG_TABLE_SCHEMA)
            USING TG_TABLE_NAME, old_pk;
    END IF;
    -- An update that changes the key also needs the new key synced.
    IF new_row IS NOT NULL AND (old_row IS NULL OR new_pk <> old_pk) THEN
        EXECUTE format('INSERT INTO %I.sync_outbox (table_name, pk) VALUES ($1, $2)', TG_TABLE_SCHEMA)
            USING TG_TABLE_NAME, new_pk;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON schools                  FOR EACH ROW EXECUTE FUNCTION sync_capture('school_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON genders                  FOR EACH ROW EXECUTE FUNCTION sync_capture('gender_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON payment_methods          FOR EACH ROW EXECUTE FUNCTION sync_capture('payment_method_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON class_categories         FOR EACH ROW EXECUTE FUNCTION sync_capture('class_category_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON payment_periods          FOR EACH ROW EXECUTE FUNCTION sync_capture('payment_period_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON expense_categories       FOR EACH ROW EXECUTE FUNCTION sync_capture('expense_category_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON income_categories        FOR EACH ROW EXECUTE FUNCTION sync_capture('income_category_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON academic_years           FOR EACH ROW EXECUTE FUNCTION sync_capture('academic_year_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON roles                    FOR EACH ROW EXECUTE FUNCTION sync_capture('role_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON employees                FOR EACH ROW EXECUTE FUNCTION sync_capture('employee_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON learners                 FOR EACH ROW EXECUTE FUNCTION sync_capture('learner_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON enrolments               FOR EACH ROW EXECUTE FUNCTION sync_capture('enrolment_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON income_category_classes  FOR EACH ROW EXECUTE FUNCTION sync_capture('income_category_class_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON income_category_learners FOR EACH ROW EXECUTE FUNCTION sync_capture('income_category_learner_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON income_category_periods  FOR EACH ROW EXECUTE FUNCTION sync_capture('income_category_period_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON charges                  FOR EACH ROW EXECUTE FUNCTION sync_capture('charge_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON payments                 FOR EACH ROW EXECUTE FUNCTION sync_capture('payment_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON payment_allocations      FOR EACH ROW EXECUTE FUNCTION sync_capture('allocation_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON expenses                 FOR EACH ROW EXECUTE FUNCTION sync_capture('expense_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON payroll_runs             FOR EACH ROW EXECUTE FUNCTION sync_capture('payroll_run_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON payroll_lines            FOR EACH ROW EXECUTE FUNCTION sync_capture('payroll_line_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON documents                FOR EACH ROW EXECUTE FUNCTION sync_capture('document_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON audit_log                FOR EACH ROW EXECUTE FUNCTION sync_capture('audit_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON school_logos             FOR EACH ROW EXECUTE FUNCTION sync_capture('school_id');
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON school_logo_renditions   FOR EACH ROW EXECUTE FUNCTION sync_capture('school_id', 'size');

-- Down Migration

DROP TRIGGER IF EXISTS sync_capture ON school_logo_renditions;
DROP TRIGGER IF EXISTS sync_capture ON school_logos;
DROP TRIGGER IF EXISTS sync_capture ON audit_log;
DROP TRIGGER IF EXISTS sync_capture ON documents;
DROP TRIGGER IF EXISTS sync_capture ON payroll_lines;
DROP TRIGGER IF EXISTS sync_capture ON payroll_runs;
DROP TRIGGER IF EXISTS sync_capture ON expenses;
DROP TRIGGER IF EXISTS sync_capture ON payment_allocations;
DROP TRIGGER IF EXISTS sync_capture ON payments;
DROP TRIGGER IF EXISTS sync_capture ON charges;
DROP TRIGGER IF EXISTS sync_capture ON income_category_periods;
DROP TRIGGER IF EXISTS sync_capture ON income_category_learners;
DROP TRIGGER IF EXISTS sync_capture ON income_category_classes;
DROP TRIGGER IF EXISTS sync_capture ON enrolments;
DROP TRIGGER IF EXISTS sync_capture ON learners;
DROP TRIGGER IF EXISTS sync_capture ON employees;
DROP TRIGGER IF EXISTS sync_capture ON roles;
DROP TRIGGER IF EXISTS sync_capture ON academic_years;
DROP TRIGGER IF EXISTS sync_capture ON income_categories;
DROP TRIGGER IF EXISTS sync_capture ON expense_categories;
DROP TRIGGER IF EXISTS sync_capture ON payment_periods;
DROP TRIGGER IF EXISTS sync_capture ON class_categories;
DROP TRIGGER IF EXISTS sync_capture ON payment_methods;
DROP TRIGGER IF EXISTS sync_capture ON genders;
DROP TRIGGER IF EXISTS sync_capture ON schools;
DROP FUNCTION IF EXISTS sync_capture();
DROP TABLE IF EXISTS sync_state;
DROP TABLE IF EXISTS sync_outbox;
