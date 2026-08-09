PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commission_payout_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  settlement_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('TWD')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by_user_id TEXT,
  rejection_reason_code TEXT CHECK (rejection_reason_code IS NULL OR rejection_reason_code IN ('INVALID_REQUEST','SETTLEMENT_MISMATCH','DEALER_NOT_ELIGIBLE','DUPLICATE_REQUEST','OTHER_POLICY')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (settlement_id) REFERENCES commission_settlements(id) ON DELETE RESTRICT,
  FOREIGN KEY (dealer_id) REFERENCES line_oa_dealers(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_commission_payout_requests_scope_status ON commission_payout_requests(workspace_id,line_account_id,status,requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_payout_requests_dealer ON commission_payout_requests(workspace_id,line_account_id,dealer_id,requested_at DESC);

CREATE TRIGGER IF NOT EXISTS commission_payout_requests_one_active_per_settlement_dealer
BEFORE INSERT ON commission_payout_requests
WHEN EXISTS (
  SELECT 1 FROM commission_payout_requests existing_request
  WHERE existing_request.settlement_id=NEW.settlement_id
    AND existing_request.dealer_id=NEW.dealer_id
    AND existing_request.status IN ('REQUESTED','APPROVED')
)
BEGIN
  SELECT RAISE(ABORT,'ACTIVE_PAYOUT_REQUEST_EXISTS');
END;

CREATE TABLE IF NOT EXISTS commission_payout_request_status_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  payout_request_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('DEALER','TENANT_ADMIN')),
  actor_user_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('INVALID_REQUEST','SETTLEMENT_MISMATCH','DEALER_NOT_ELIGIBLE','DUPLICATE_REQUEST','OTHER_POLICY')),
  FOREIGN KEY (payout_request_id) REFERENCES commission_payout_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_payout_request_status_events_request_time ON commission_payout_request_status_events(payout_request_id,occurred_at);
