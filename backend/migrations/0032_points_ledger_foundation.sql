PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS member_point_accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,member_id)
);

CREATE TABLE IF NOT EXISTS point_rule_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('QUALIFIED_REFERRAL','VERIFIED_REFERRAL_CONVERSION')),
  points INTEGER NOT NULL CHECK (points > 0 AND points <= 100000000),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,reason_code,version_no)
);
CREATE INDEX IF NOT EXISTS idx_point_rule_versions_effective
  ON point_rule_versions(workspace_id,line_account_id,reason_code,effective_from,version_no);

CREATE TRIGGER IF NOT EXISTS point_rule_versions_no_update
BEFORE UPDATE ON point_rule_versions
BEGIN
  SELECT RAISE(ABORT, 'POINT_RULE_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS point_rule_versions_no_delete
BEFORE DELETE ON point_rule_versions
BEGIN
  SELECT RAISE(ABORT, 'POINT_RULE_IMMUTABLE');
END;

CREATE TABLE IF NOT EXISTS member_point_ledger_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  point_account_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('CREDIT','DEBIT')),
  points INTEGER NOT NULL CHECK (points > 0 AND points <= 100000000),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('QUALIFIED_REFERRAL','VERIFIED_REFERRAL_CONVERSION','REWARD_REDEMPTION')),
  source_type TEXT NOT NULL CHECK (source_type IN ('REFERRAL_ATTRIBUTION','CONVERSION_REFERRAL_EVIDENCE','REDEMPTION')),
  source_ref TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (point_account_id) REFERENCES member_point_accounts(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,source_type,source_ref)
);
CREATE INDEX IF NOT EXISTS idx_member_point_ledger_account_time
  ON member_point_ledger_entries(workspace_id,line_account_id,point_account_id,effective_at);
CREATE INDEX IF NOT EXISTS idx_member_point_ledger_reason_time
  ON member_point_ledger_entries(workspace_id,line_account_id,reason_code,effective_at);

CREATE TRIGGER IF NOT EXISTS member_point_ledger_entries_no_update
BEFORE UPDATE ON member_point_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'POINT_LEDGER_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS member_point_ledger_entries_no_delete
BEFORE DELETE ON member_point_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'POINT_LEDGER_APPEND_ONLY');
END;
