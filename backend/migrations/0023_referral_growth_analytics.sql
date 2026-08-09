PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS member_referral_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  referral_identity_id TEXT,
  inviter_member_id TEXT,
  invitee_member_id TEXT,
  referral_code_fingerprint TEXT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (referral_identity_id) REFERENCES member_referral_identities(id) ON DELETE SET NULL,
  FOREIGN KEY (inviter_member_id) REFERENCES line_oa_members(id) ON DELETE SET NULL,
  FOREIGN KEY (invitee_member_id) REFERENCES line_oa_members(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_referral_events_workspace_time ON member_referral_events(workspace_id,line_account_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_source_time ON member_referral_events(workspace_id,line_account_id,source,occurred_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_identity_time ON member_referral_events(workspace_id,line_account_id,referral_identity_id,occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_events_dedupe ON member_referral_events(workspace_id,line_account_id,event_type,dedupe_key);