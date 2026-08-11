-- 0048 Commerce conversion bridge. Additive only; no backfill, seed, or fake conversion data.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commerce_conversion_events (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  crm_person_id TEXT,
  conversion_type TEXT NOT NULL CHECK(conversion_type='ORDER_PAID'),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000),
  currency_code TEXT NOT NULL CHECK(currency_code='TWD'),
  source_kind TEXT NOT NULL DEFAULT 'DIRECT_COMMERCE' CHECK(source_kind='DIRECT_COMMERCE'),
  customer_label_snapshot TEXT NOT NULL CHECK(length(customer_label_snapshot) BETWEEN 1 AND 40),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,order_id) REFERENCES commerce_orders(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,order_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_conversions_workspace_time
  ON commerce_conversion_events(workspace_id,occurred_at DESC,id DESC);

CREATE TRIGGER IF NOT EXISTS commerce_conversion_paid_order_insert
BEFORE INSERT ON commerce_conversion_events
WHEN NOT EXISTS (
  SELECT 1 FROM commerce_orders o
  WHERE o.workspace_id=NEW.workspace_id
    AND o.id=NEW.order_id
    AND o.status='PAID'
    AND o.payment_status='PAID'
    AND o.total_amount_minor=NEW.amount_minor
    AND o.currency_code=NEW.currency_code
) OR (
  NEW.crm_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce_order_member_owners own
    JOIN crm_people p ON p.id=own.crm_person_id AND p.workspace_id=own.workspace_id
    WHERE own.workspace_id=NEW.workspace_id
      AND own.order_id=NEW.order_id
      AND own.crm_person_id=NEW.crm_person_id
  )
)
BEGIN SELECT RAISE(ABORT,'COMMERCE_CONVERSION_PAID_ORDER_REQUIRED'); END;

CREATE TRIGGER IF NOT EXISTS commerce_conversion_events_no_update
BEFORE UPDATE ON commerce_conversion_events
BEGIN SELECT RAISE(ABORT,'COMMERCE_CONVERSION_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS commerce_conversion_events_no_delete
BEFORE DELETE ON commerce_conversion_events
BEGIN SELECT RAISE(ABORT,'COMMERCE_CONVERSION_APPEND_ONLY'); END;
