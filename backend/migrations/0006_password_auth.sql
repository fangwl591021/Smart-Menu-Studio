PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 210000;
ALTER TABLE users ADD COLUMN password_updated_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
ON users(username)
WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
ON users(lower(email))
WHERE email IS NOT NULL;

UPDATE users
SET username = 'dev-owner'
WHERE id = 'usr_dev_owner'
  AND username IS NULL;