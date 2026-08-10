PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contribution_rule_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('QUALIFIED_REFERRAL','VERIFIED_REFERRAL_CONVERSION','COMPLETED_REWARD_REDEMPTION')),
  score_delta INTEGER NOT NULL CHECK (score_delta > 0 AND score_delta <= 100000000),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,event_type,version_no)
);
CREATE INDEX IF NOT EXISTS idx_contribution_rule_versions_effective ON contribution_rule_versions(workspace_id,line_account_id,event_type,effective_from,version_no);
CREATE TRIGGER IF NOT EXISTS contribution_rule_versions_no_update BEFORE UPDATE ON contribution_rule_versions BEGIN SELECT RAISE(ABORT,'CONTRIBUTION_RULE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS contribution_rule_versions_no_delete BEFORE DELETE ON contribution_rule_versions BEGIN SELECT RAISE(ABORT,'CONTRIBUTION_RULE_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS member_contribution_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('QUALIFIED_REFERRAL','VERIFIED_REFERRAL_CONVERSION','COMPLETED_REWARD_REDEMPTION')),
  score_delta INTEGER NOT NULL CHECK (score_delta > 0 AND score_delta <= 100000000),
  source_type TEXT NOT NULL CHECK (source_type IN ('REFERRAL_ATTRIBUTION','CONVERSION_REFERRAL_EVIDENCE','POINT_REDEMPTION')),
  source_ref TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,source_type,source_ref)
);
CREATE INDEX IF NOT EXISTS idx_member_contribution_member_time ON member_contribution_events(workspace_id,line_account_id,member_id,effective_at);
CREATE INDEX IF NOT EXISTS idx_member_contribution_event_time ON member_contribution_events(workspace_id,line_account_id,event_type,effective_at);
CREATE TRIGGER IF NOT EXISTS member_contribution_events_no_update BEFORE UPDATE ON member_contribution_events BEGIN SELECT RAISE(ABORT,'CONTRIBUTION_EVENTS_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS member_contribution_events_no_delete BEFORE DELETE ON member_contribution_events BEGIN SELECT RAISE(ABORT,'CONTRIBUTION_EVENTS_APPEND_ONLY'); END;

CREATE TABLE IF NOT EXISTS member_tier_rule_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  tier_code TEXT NOT NULL CHECK (tier_code IN ('BRONZE','SILVER','GOLD','PLATINUM')),
  tier_name TEXT NOT NULL,
  min_contribution_score INTEGER NOT NULL CHECK (min_contribution_score >= 0 AND min_contribution_score <= 100000000),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,tier_code,version_no)
);
CREATE INDEX IF NOT EXISTS idx_member_tier_rule_versions_effective ON member_tier_rule_versions(workspace_id,line_account_id,effective_from,tier_code,version_no);
CREATE TRIGGER IF NOT EXISTS member_tier_rule_versions_no_update BEFORE UPDATE ON member_tier_rule_versions BEGIN SELECT RAISE(ABORT,'TIER_RULE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS member_tier_rule_versions_no_delete BEFORE DELETE ON member_tier_rule_versions BEGIN SELECT RAISE(ABORT,'TIER_RULE_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS member_tier_qualification_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  tier_code TEXT NOT NULL CHECK (tier_code IN ('BRONZE','SILVER','GOLD','PLATINUM')),
  contribution_score_snapshot INTEGER NOT NULL CHECK (contribution_score_snapshot >= 0),
  rule_version_snapshot INTEGER NOT NULL CHECK (rule_version_snapshot > 0),
  qualified_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,member_id,tier_code,rule_version_snapshot,qualified_at)
);
CREATE INDEX IF NOT EXISTS idx_member_tier_qualification_member_time ON member_tier_qualification_events(workspace_id,line_account_id,member_id,qualified_at);
CREATE TRIGGER IF NOT EXISTS member_tier_qualification_events_no_update BEFORE UPDATE ON member_tier_qualification_events BEGIN SELECT RAISE(ABORT,'TIER_QUALIFICATION_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS member_tier_qualification_events_no_delete BEFORE DELETE ON member_tier_qualification_events BEGIN SELECT RAISE(ABORT,'TIER_QUALIFICATION_APPEND_ONLY'); END;
