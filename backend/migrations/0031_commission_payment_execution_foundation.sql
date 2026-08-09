PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commission_payment_attempts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  payout_request_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  provider_code TEXT NOT NULL CHECK (provider_code IN ('INTERNAL_TEST')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('TWD')),
  idempotency_key_hash TEXT NOT NULL,
  failure_reason_code TEXT CHECK (failure_reason_code IS NULL OR failure_reason_code IN ('PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','INVALID_PAYMENT_STATE','IDEMPOTENCY_CONFLICT','TECHNICAL_FAILURE')),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(payout_request_id,attempt_no),
  UNIQUE(payout_request_id,idempotency_key_hash),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (payout_request_id) REFERENCES commission_payout_requests(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_commission_payment_attempts_scope_request ON commission_payment_attempts(workspace_id,line_account_id,payout_request_id,created_at DESC);

CREATE TABLE IF NOT EXISTS commission_payment_attempt_status_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  payment_attempt_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED')),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','INVALID_PAYMENT_STATE','IDEMPOTENCY_CONFLICT','TECHNICAL_FAILURE')),
  FOREIGN KEY (payment_attempt_id) REFERENCES commission_payment_attempts(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commission_payment_attempt_status_events_attempt_time ON commission_payment_attempt_status_events(payment_attempt_id,occurred_at);

CREATE TABLE IF NOT EXISTS commission_payment_transactions (
  id TEXT PRIMARY KEY,
  payment_attempt_id TEXT NOT NULL UNIQUE,
  payout_request_id TEXT NOT NULL UNIQUE,
  provider_code TEXT NOT NULL CHECK (provider_code IN ('INTERNAL_TEST')),
  provider_transaction_ref TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('TWD')),
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED')),
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_attempt_id) REFERENCES commission_payment_attempts(id) ON DELETE RESTRICT,
  FOREIGN KEY (payout_request_id) REFERENCES commission_payout_requests(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_commission_payment_transactions_request ON commission_payment_transactions(payout_request_id,confirmed_at);
