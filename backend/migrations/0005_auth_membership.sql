PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  revoked_at TEXT,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
ON auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
ON auth_sessions(expires_at);

-- 開發用 owner：讓目前 default workspace 可繼續測試 Membership。
INSERT OR IGNORE INTO users (
  id, email, display_name, status
) VALUES (
  'usr_dev_owner',
  'dev-owner@local.invalid',
  'Development Owner',
  'active'
);

INSERT OR IGNORE INTO workspace_members (
  id, workspace_id, user_id, role, status
) VALUES (
  'wsm_default_dev_owner',
  'default',
  'usr_dev_owner',
  'owner',
  'active'
);