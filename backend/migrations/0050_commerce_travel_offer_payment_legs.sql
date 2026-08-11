-- 0050 Commerce prerequisites for Travel offers and payment legs.
-- Additive only; no backfill, seed data, fake offers, fake orders, or Travel business tables.
PRAGMA foreign_keys = ON;

ALTER TABLE commerce_products
  ADD COLUMN product_kind TEXT NOT NULL DEFAULT 'STANDARD'
  CHECK(product_kind IN ('STANDARD','TRAVEL_DEPARTURE'));

CREATE INDEX IF NOT EXISTS idx_commerce_products_kind_list
  ON commerce_products(workspace_id,product_kind,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS commerce_product_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  source_domain TEXT NOT NULL CHECK(source_domain='TRAVEL_DEPARTURE'),
  source_reference TEXT NOT NULL CHECK(length(source_reference) BETWEEN 16 AND 160),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,product_id) REFERENCES commerce_products(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,product_id),
  UNIQUE(workspace_id,source_domain,source_reference)
);

CREATE INDEX IF NOT EXISTS idx_commerce_product_sources_lookup
  ON commerce_product_sources(workspace_id,source_domain,source_reference);

ALTER TABLE commerce_payment_intents
  ADD COLUMN payment_leg TEXT NOT NULL DEFAULT 'FULL'
  CHECK(payment_leg IN ('FULL','DEPOSIT','BALANCE'));

ALTER TABLE commerce_payment_transactions
  ADD COLUMN payment_leg TEXT NOT NULL DEFAULT 'FULL'
  CHECK(payment_leg IN ('FULL','DEPOSIT','BALANCE'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_payment_one_pending_leg
  ON commerce_payment_intents(workspace_id,order_id,payment_leg)
  WHERE status='PENDING';

CREATE TABLE IF NOT EXISTS commerce_order_payment_obligations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payment_leg TEXT NOT NULL CHECK(payment_leg IN ('FULL','DEPOSIT','BALANCE')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency_code TEXT NOT NULL DEFAULT 'TWD' CHECK(currency_code='TWD'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','CANCELLED')),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(paid_amount_minor BETWEEN 0 AND amount_minor),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  FOREIGN KEY(workspace_id,order_id) REFERENCES commerce_orders(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,order_id,payment_leg),
  CHECK(
    (status='PENDING' AND paid_amount_minor=0 AND paid_at IS NULL)
    OR (status='PAID' AND paid_amount_minor=amount_minor AND paid_at IS NOT NULL)
    OR (status='CANCELLED' AND paid_amount_minor=0 AND paid_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_commerce_payment_obligations_order
  ON commerce_order_payment_obligations(workspace_id,order_id,status,payment_leg);

CREATE TRIGGER IF NOT EXISTS commerce_product_kind_immutable BEFORE UPDATE ON commerce_products
WHEN NEW.product_kind<>OLD.product_kind
BEGIN SELECT RAISE(ABORT,'COMMERCE_PRODUCT_KIND_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS commerce_product_sources_no_update BEFORE UPDATE ON commerce_product_sources
BEGIN SELECT RAISE(ABORT,'COMMERCE_PRODUCT_SOURCE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS commerce_product_sources_no_delete BEFORE DELETE ON commerce_product_sources
BEGIN SELECT RAISE(ABORT,'COMMERCE_PRODUCT_SOURCE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS commerce_payment_intent_leg_immutable BEFORE UPDATE ON commerce_payment_intents
WHEN NEW.payment_leg<>OLD.payment_leg
BEGIN SELECT RAISE(ABORT,'COMMERCE_PAYMENT_INTENT_BINDING_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS commerce_payment_obligation_binding_immutable BEFORE UPDATE ON commerce_order_payment_obligations
WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.order_id<>OLD.order_id
  OR NEW.payment_leg<>OLD.payment_leg OR NEW.amount_minor<>OLD.amount_minor
  OR NEW.currency_code<>OLD.currency_code OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'COMMERCE_PAYMENT_OBLIGATION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS commerce_payment_obligation_paid_terminal BEFORE UPDATE ON commerce_order_payment_obligations
WHEN OLD.status='PAID' AND (NEW.status<>'PAID' OR NEW.paid_amount_minor<>OLD.paid_amount_minor OR NEW.paid_at<>OLD.paid_at)
BEGIN SELECT RAISE(ABORT,'COMMERCE_PAYMENT_OBLIGATION_PAID_TERMINAL'); END;

CREATE TRIGGER IF NOT EXISTS commerce_payment_obligations_no_delete BEFORE DELETE ON commerce_order_payment_obligations
BEGIN SELECT RAISE(ABORT,'COMMERCE_PAYMENT_OBLIGATION_IMMUTABLE'); END;
