-- Up Migration
--
-- Security keys: a way back in when a password is forgotten, without an
-- administrator — which matters most when the forgotten password *is* the
-- only administrator's.
--
-- One per account, stored only as a scrypt hash like the password itself
-- (lib/auth/password.ts) and shown to its owner once. Using it to recover an
-- account replaces it with a fresh one, so a key that has been typed in
-- somewhere is never good twice.

ALTER TABLE employees ADD COLUMN security_key_hash TEXT;
ALTER TABLE employees ADD COLUMN security_key_created_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE employees DROP COLUMN IF EXISTS security_key_created_at;
ALTER TABLE employees DROP COLUMN IF EXISTS security_key_hash;
