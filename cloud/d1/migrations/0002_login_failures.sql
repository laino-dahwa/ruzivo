-- Wrong website passwords, per connection, so guessing can be slowed down
-- (cloud/src/password.ts). Rows older than the lockout window are deleted
-- as new ones arrive. Written by the Worker only; never synced.
CREATE TABLE login_failures (
    ip  TEXT NOT NULL,
    at  TEXT NOT NULL
);

CREATE INDEX idx_login_failures_ip_at ON login_failures (ip, at);
