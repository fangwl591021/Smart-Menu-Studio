PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commission_attributions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  conversion_event_id TEXT NOT NULL,
  conversion_referral_evidence_id TEXT NOT NULL,
  member_referral_attribution_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  attribution_source TEXT NOT NULL CHECK (attribution_source IN ('REFERRAL_EVIDENCE')),
  attributed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversion_event_id),
  UNIQUE(conversion_referral_evidence_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (conversion_event_id) REFERENCES line_conversion_events(id) ON DELETE CASCADE,
  FOREIGN KEY (conversion_referral_evidence_id) REFERENCES conversion_referral_evidence(id) ON DELETE CASCADE,
  FOREIGN KEY (member_referral_attribution_id) REFERENCES member_referral_attributions(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES commission_programs(id) ON DELETE CASCADE,
  FOREIGN KEY (dealer_id) REFERENCES line_oa_dealers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_attributions_scope_time ON commission_attributions(workspace_id,line_account_id,attributed_at);
CREATE INDEX IF NOT EXISTS idx_commission_attributions_program_dealer ON commission_attributions(workspace_id,line_account_id,program_id,dealer_id);
