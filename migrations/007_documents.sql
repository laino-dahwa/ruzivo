-- Up Migration
--
-- Issued documents: transfer letters, acknowledgements, newsletters and
-- learner statements of account.
--
-- The point of this table is not storage, it is proof. Every document the
-- school issues gets a reference printed on it, and the row here is what a
-- reference can be checked against — so a letter presented back to the
-- school months later can be confirmed genuine, or shown to be a forgery.
-- That is also why there are no uploaded signature images anywhere in this
-- schema: a signature image sitting in a database is a forgery kit, and it
-- cannot be revoked once copied. Documents are signed by hand on paper.

-- References are drawn from their own sequence rather than the identity
-- column, so the number printed on a document can be reserved before the row
-- is written and never changes afterwards.
CREATE SEQUENCE document_reference_seq;

CREATE TABLE documents (
    document_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,

    -- Null for school-wide documents (a general newsletter or public notice
    -- is addressed to nobody in particular).
    learner_id VARCHAR(8),

    document_type VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,

    -- Printed on the document, e.g. "SSV-TL-000147".
    reference VARCHAR(40) NOT NULL,

    -- The final, edited content as issued — not the template it started from.
    -- Stored so a reprint is identical to the original down to the wording;
    -- a "copy" that differs from what the parent holds would defeat the
    -- verification this table exists for.
    body_html TEXT NOT NULL,

    -- For a statement of account: the figures exactly as they stood when it
    -- was issued. Kept because balances move, and a statement must still be
    -- explicable a year later against the numbers it actually showed.
    statement_data JSONB,

    signatory_name VARCHAR(120) NOT NULL,
    signatory_title VARCHAR(120) NOT NULL,

    -- Who issued it. SET NULL rather than CASCADE for the same reason as
    -- payments.recorded_by_employee_id (006): losing the member of staff must
    -- never erase the record of what the school sent out.
    issued_by_employee_id BIGINT,
    -- Name snapshot, so the entry stays readable once the account is gone.
    issued_by_label VARCHAR(255) NOT NULL,

    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_document_reference UNIQUE (reference),

    CONSTRAINT fk_document_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    -- The document survives the learner record being removed; it is evidence
    -- of something the school did, not a property of the learner.
    CONSTRAINT fk_document_learner
        FOREIGN KEY (learner_id)
        REFERENCES learners(learner_id)
        ON DELETE SET NULL,

    CONSTRAINT fk_document_issued_by
        FOREIGN KEY (issued_by_employee_id)
        REFERENCES employees(employee_id)
        ON DELETE SET NULL
);

CREATE INDEX idx_documents_school_issued ON documents (school_id, issued_at DESC);
CREATE INDEX idx_documents_learner ON documents (learner_id);

-- Down Migration

DROP TABLE IF EXISTS documents;
DROP SEQUENCE IF EXISTS document_reference_seq;
