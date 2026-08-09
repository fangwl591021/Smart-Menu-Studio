PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commission_settlement_periods (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','LOCKED','FINALIZED','CANCELLED')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  finalized_at TEXT,
  cancelled_at TEXT,
  CHECK (period_start < period_end),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_settlement_periods_scope_window ON commission_settlement_periods(workspace_id,line_account_id,period_start,period_end);
CREATE INDEX IF NOT EXISTS idx_commission_settlement_periods_scope_status ON commission_settlement_periods(workspace_id,line_account_id,status);

CREATE TABLE IF NOT EXISTS commission_settlements (
  id TEXT PRIMARY KEY,
  settlement_period_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','LOCKED','FINALIZED','CANCELLED')),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('TWD')),
  total_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_amount_minor >= 0),
  entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
  snapshot_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (settlement_period_id) REFERENCES commission_settlement_periods(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_settlements_scope_status ON commission_settlements(workspace_id,line_account_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS commission_settlement_items (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL,
  ledger_entry_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('TWD')),
  ledger_effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(settlement_id,ledger_entry_id),
  FOREIGN KEY (settlement_id) REFERENCES commission_settlements(id) ON DELETE RESTRICT,
  FOREIGN KEY (ledger_entry_id) REFERENCES commission_ledger_entries(id) ON DELETE RESTRICT,
  FOREIGN KEY (dealer_id) REFERENCES line_oa_dealers(id) ON DELETE RESTRICT,
  FOREIGN KEY (program_id) REFERENCES commission_programs(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_commission_settlement_items_ledger ON commission_settlement_items(ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_commission_settlement_items_settlement ON commission_settlement_items(settlement_id,ledger_effective_at);
CREATE TRIGGER IF NOT EXISTS commission_settlement_items_single_active_claim
BEFORE INSERT ON commission_settlement_items
WHEN EXISTS (
  SELECT 1 FROM commission_settlement_items existing_item
  JOIN commission_settlements existing_settlement ON existing_settlement.id=existing_item.settlement_id
  WHERE existing_item.ledger_entry_id=NEW.ledger_entry_id
    AND existing_settlement.status IN ('LOCKED','FINALIZED')
)
BEGIN
  SELECT RAISE(ABORT,'LEDGER_ALREADY_SETTLED');
end;

CREATE TABLE IF NOT EXISTS commission_settlement_status_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  settlement_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('DRAFT','LOCKED','FINALIZED','CANCELLED')),
  actor_user_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (settlement_id) REFERENCES commission_settlements(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_settlement_status_events_settlement_time ON commission_settlement_status_events(settlement_id,occurred_at);
