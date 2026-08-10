PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS point_rewards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  current_version_no INTEGER NOT NULL DEFAULT 0 CHECK (current_version_no >= 0),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_point_rewards_scope_status
  ON point_rewards(workspace_id,line_account_id,status,created_at);

CREATE TABLE IF NOT EXISTS point_reward_versions (
  id TEXT PRIMARY KEY,
  reward_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points_cost INTEGER NOT NULL CHECK (points_cost > 0 AND points_cost <= 100000000),
  effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reward_id) REFERENCES point_rewards(id) ON DELETE CASCADE,
  UNIQUE(reward_id,version_no)
);
CREATE INDEX IF NOT EXISTS idx_point_reward_versions_reward_effective
  ON point_reward_versions(reward_id,effective_from,version_no);

CREATE TRIGGER IF NOT EXISTS point_reward_versions_no_update
BEFORE UPDATE ON point_reward_versions
BEGIN
  SELECT RAISE(ABORT, 'REWARD_VERSION_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS point_reward_versions_no_delete
BEFORE DELETE ON point_reward_versions
BEGIN
  SELECT RAISE(ABORT, 'REWARD_VERSION_IMMUTABLE');
END;

CREATE TABLE IF NOT EXISTS point_redemptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  point_account_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  reward_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED')),
  points_cost_snapshot INTEGER NOT NULL CHECK (points_cost_snapshot > 0 AND points_cost_snapshot <= 100000000),
  reward_name_snapshot TEXT NOT NULL,
  action_ref TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (point_account_id) REFERENCES member_point_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (reward_id) REFERENCES point_rewards(id) ON DELETE CASCADE,
  FOREIGN KEY (reward_version_id) REFERENCES point_reward_versions(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,action_ref)
);
CREATE INDEX IF NOT EXISTS idx_point_redemptions_account_time
  ON point_redemptions(workspace_id,line_account_id,point_account_id,completed_at);
CREATE INDEX IF NOT EXISTS idx_point_redemptions_reward_time
  ON point_redemptions(workspace_id,line_account_id,reward_id,completed_at);

CREATE TRIGGER IF NOT EXISTS point_redemptions_prevent_overspend
BEFORE INSERT ON point_redemptions
BEGIN
  SELECT CASE
    WHEN (
      COALESCE((
        SELECT SUM(CASE WHEN entry_type = 'CREDIT' THEN points ELSE -points END)
        FROM member_point_ledger_entries
        WHERE workspace_id = NEW.workspace_id
          AND line_account_id = NEW.line_account_id
          AND point_account_id = NEW.point_account_id
      ),0)
    ) < NEW.points_cost_snapshot
    THEN RAISE(ABORT, 'INSUFFICIENT_POINTS')
  END;
END;

CREATE TRIGGER IF NOT EXISTS point_redemptions_no_update
BEFORE UPDATE ON point_redemptions
BEGIN
  SELECT RAISE(ABORT, 'REDEMPTION_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS point_redemptions_no_delete
BEFORE DELETE ON point_redemptions
BEGIN
  SELECT RAISE(ABORT, 'REDEMPTION_IMMUTABLE');
END;
