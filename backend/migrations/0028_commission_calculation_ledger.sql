PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commission_rule_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  calculation_type TEXT NOT NULL CHECK (calculation_type IN ('FIXED_PER_ATTRIBUTION')),
  fixed_amount_minor INTEGER NOT NULL CHECK (fixed_amount_minor > 0 AND fixed_amount_minor <= 100000000),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('TWD')),
  effective_from TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(program_id, version_no),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES commission_programs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_rule_versions_historical
  ON commission_rule_versions(workspace_id,line_account_id,program_id,effective_from DESC,version_no DESC);

CREATE TABLE IF NOT EXISTS commission_calculations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  commission_attribution_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  rule_version_id TEXT NOT NULL,
  calculation_type TEXT NOT NULL CHECK (calculation_type IN ('FIXED_PER_ATTRIBUTION')),
  base_amount_minor INTEGER,
  commission_amount_minor INTEGER NOT NULL CHECK (commission_amount_minor > 0 AND commission_amount_minor <= 100000000),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('TWD')),
  calculated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(commission_attribution_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (commission_attribution_id) REFERENCES commission_attributions(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES commission_programs(id) ON DELETE CASCADE,
  FOREIGN KEY (dealer_id) REFERENCES line_oa_dealers(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_version_id) REFERENCES commission_rule_versions(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_commission_calculations_scope_time
  ON commission_calculations(workspace_id,line_account_id,calculated_at);
CREATE INDEX IF NOT EXISTS idx_commission_calculations_program_dealer
  ON commission_calculations(workspace_id,line_account_id,program_id,dealer_id);

CREATE TABLE IF NOT EXISTS commission_ledger_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  commission_attribution_id TEXT NOT NULL,
  commission_calculation_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('COMMISSION_EARNED')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 100000000),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('TWD')),
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(commission_calculation_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (dealer_id) REFERENCES line_oa_dealers(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES commission_programs(id) ON DELETE CASCADE,
  FOREIGN KEY (commission_attribution_id) REFERENCES commission_attributions(id) ON DELETE CASCADE,
  FOREIGN KEY (commission_calculation_id) REFERENCES commission_calculations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_entries_scope_effective
  ON commission_ledger_entries(workspace_id,line_account_id,effective_at);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_entries_dealer
  ON commission_ledger_entries(workspace_id,line_account_id,dealer_id,effective_at);
