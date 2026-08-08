PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN is_system_admin INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET is_system_admin = 1
WHERE username = 'admin'
   OR id = 'usr_system_admin';

CREATE INDEX IF NOT EXISTS idx_users_system_admin
ON users(is_system_admin, status);

CREATE TABLE IF NOT EXISTS workspace_profiles (
  workspace_id TEXT PRIMARY KEY,
  contact_name TEXT,
  phone TEXT,
  company_name TEXT,
  tax_id TEXT,
  industry TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id)
    ON DELETE CASCADE
);

INSERT OR IGNORE INTO workspace_profiles (
  workspace_id,
  company_name
)
SELECT id, name
FROM workspaces
WHERE deleted_at IS NULL;
