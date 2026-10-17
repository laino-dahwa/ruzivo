-- Up Migration
--
-- Invoices, issued from the Documents page like any other document.
--
-- The line items are stored on the document exactly as they were issued —
-- the fee names and amounts as printed, plus the total — for the same reason
-- a statement keeps statement_data: a reprint has to be identical to the
-- copy the parent holds, even after the fee itself has been renamed or its
-- limit changed. Its own column rather than a second shape inside
-- statement_data, so neither ever has to be told apart from the other.

ALTER TABLE documents ADD COLUMN invoice_data JSONB;

-- Down Migration

ALTER TABLE documents DROP COLUMN IF EXISTS invoice_data;
