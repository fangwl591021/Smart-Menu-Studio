PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commission_programs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  attribution_window_days INTEGER NOT NULL CHECK (attribution_window_days >= 1 AND attribution_window_days <= 90),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_programs_scope_status ON commission_programs(workspace_id,line_account_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_programs_one_active_per_account ON commission_programs(workspace_id,line_account_id) WHERE status='ACTIVE';

CREATE TABLE IF NOT EXISTS commission_program_status_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  actor_user_id TEXT,
  reason_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES commission_programs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_program_status_events_program_time ON commission_program_status_events(workspace_id,line_account_id,program_id,created_at);

CREATE TABLE IF NOT EXISTS commission_program_dealers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ELIGIBLE','DISABLED')),
  eligible_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(program_id,dealer_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES commission_programs(id) ON DELETE CASCADE,
  FOREIGN KEY (dealer_id) REFERENCES line_oa_dealers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_program_dealers_scope_status ON commission_program_dealers(workspace_id,line_account_id,program_id,status);

CREATE TABLE IF NOT EXISTS commission_program_dealer_status_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('ELIGIBLE','DISABLED')),
  actor_user_id TEXT,
  reason_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES commission_programs(id) ON DELETE CASCADE,
  FOREIGN KEY (dealer_id) REFERENCES line_oa_dealers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_program_dealer_status_events_time ON commission_program_dealer_status_events(workspace_id,line_account_id,program_id,dealer_id,created_at);
