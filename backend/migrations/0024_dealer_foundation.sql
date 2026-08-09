PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS line_oa_dealers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REJECTED')),
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  suspended_at TEXT,
  rejected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_oa_dealer_member ON line_oa_dealers(workspace_id,line_account_id,member_id);
CREATE INDEX IF NOT EXISTS idx_line_oa_dealer_status ON line_oa_dealers(workspace_id,line_account_id,status,applied_at);

CREATE TABLE IF NOT EXISTS dealer_status_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('PENDING','ACTIVE','SUSPENDED','REJECTED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('MEMBER','TENANT_ADMIN')),
  actor_user_id TEXT,
  reason_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (dealer_id) REFERENCES line_oa_dealers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dealer_status_events_dealer_time ON dealer_status_events(workspace_id,line_account_id,dealer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_dealer_status_events_workspace_time ON dealer_status_events(workspace_id,line_account_id,created_at);
