PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_liff_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  liff_id TEXT NOT NULL,
  liff_entry_url TEXT NOT NULL,
  verified_line_login_channel_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  linkage_confirmed_at TEXT,
  linkage_confirmed_by_user_id TEXT,
  runtime_verified_at TEXT,
  friendship_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_liff_config_workspace_account ON workspace_liff_configs(workspace_id,line_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_liff_config_liff_id ON workspace_liff_configs(liff_id);

CREATE TABLE IF NOT EXISTS line_oa_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  line_identity_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_oa_member_identity ON line_oa_members(workspace_id,line_account_id,line_identity_hash);

CREATE TABLE IF NOT EXISTS member_referral_identities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_identity_member ON member_referral_identities(workspace_id,line_account_id,member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_identity_code ON member_referral_identities(workspace_id,line_account_id,referral_code);

CREATE TABLE IF NOT EXISTS member_referral_attributions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  invitee_member_id TEXT NOT NULL,
  inviter_member_id TEXT NOT NULL,
  referral_identity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'qualified',
  qualified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE,
  FOREIGN KEY (inviter_member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE,
  FOREIGN KEY (referral_identity_id) REFERENCES member_referral_identities(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_attribution_first_lock ON member_referral_attributions(workspace_id,line_account_id,invitee_member_id);
CREATE INDEX IF NOT EXISTS idx_referral_attribution_inviter ON member_referral_attributions(workspace_id,line_account_id,inviter_member_id);
