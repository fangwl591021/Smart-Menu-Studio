PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversion_referral_contexts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  member_referral_attribution_id TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, token_fingerprint),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (member_referral_attribution_id) REFERENCES member_referral_attributions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversion_referral_context_expiry ON conversion_referral_contexts(workspace_id,line_account_id,expires_at);
CREATE INDEX IF NOT EXISTS idx_conversion_referral_context_attribution ON conversion_referral_contexts(workspace_id,line_account_id,member_referral_attribution_id);

CREATE TABLE IF NOT EXISTS conversion_referral_evidence (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  conversion_event_id TEXT NOT NULL,
  member_referral_attribution_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('SERVER_CONTEXT')),
  established_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversion_event_id),
  UNIQUE(context_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (conversion_event_id) REFERENCES line_conversion_events(id) ON DELETE CASCADE,
  FOREIGN KEY (member_referral_attribution_id) REFERENCES member_referral_attributions(id) ON DELETE CASCADE,
  FOREIGN KEY (context_id) REFERENCES conversion_referral_contexts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversion_referral_evidence_scope_time ON conversion_referral_evidence(workspace_id,line_account_id,established_at);
CREATE INDEX IF NOT EXISTS idx_conversion_referral_evidence_attribution ON conversion_referral_evidence(workspace_id,line_account_id,member_referral_attribution_id);
