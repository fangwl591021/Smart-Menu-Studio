-- 0046 Commerce/order/payment foundation. Additive only; no backfill or seed data.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commerce_products (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','ARCHIVED')),
  price_amount_minor INTEGER NOT NULL CHECK(price_amount_minor BETWEEN 1 AND 100000000),
  currency_code TEXT NOT NULL DEFAULT 'TWD' CHECK(currency_code='TWD'),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,sku)
);
CREATE INDEX IF NOT EXISTS idx_commerce_products_list ON commerce_products(workspace_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS commerce_orders (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','PENDING_PAYMENT','PAID','CANCELLED','PAYMENT_FAILED')),
  payment_status TEXT NOT NULL CHECK(payment_status IN ('UNPAID','PENDING','PAID','FAILED','CANCELLED')),
  subtotal_amount_minor INTEGER NOT NULL CHECK(subtotal_amount_minor BETWEEN 1 AND 100000000),
  discount_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_amount_minor=0),
  total_amount_minor INTEGER NOT NULL CHECK(total_amount_minor=subtotal_amount_minor-discount_amount_minor),
  currency_code TEXT NOT NULL DEFAULT 'TWD' CHECK(currency_code='TWD'),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  cancelled_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_list ON commerce_orders(workspace_id,created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_order_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  unit_amount_minor INTEGER NOT NULL CHECK(unit_amount_minor > 0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  line_amount_minor INTEGER NOT NULL CHECK(line_amount_minor=unit_amount_minor*quantity),
  currency_code TEXT NOT NULL CHECK(currency_code='TWD'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,order_id) REFERENCES commerce_orders(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,product_id) REFERENCES commerce_products(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,order_id,product_id)
);

CREATE TABLE IF NOT EXISTS commerce_payment_intents (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider='NEWEBPAY'),
  merchant_order_no TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL,
  provider_mode TEXT NOT NULL CHECK(provider_mode IN ('test','production')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency_code TEXT NOT NULL CHECK(currency_code='TWD'),
  status TEXT NOT NULL CHECK(status IN ('PENDING','PAID','FAILED','EXPIRED','CANCELLED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,order_id) REFERENCES commerce_orders(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_payment_one_pending
  ON commerce_payment_intents(workspace_id,order_id) WHERE status='PENDING';

CREATE TABLE IF NOT EXISTS commerce_payment_transactions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider='NEWEBPAY'),
  callback_hash TEXT NOT NULL CHECK(length(callback_hash)=64),
  provider_transaction_hash TEXT,
  status TEXT NOT NULL CHECK(status IN ('SUCCEEDED','FAILED','VERIFICATION_FAILED')),
  amount_minor INTEGER,
  currency_code TEXT CHECK(currency_code IS NULL OR currency_code='TWD'),
  provider_response_code TEXT,
  safe_failure_code TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,payment_intent_id) REFERENCES commerce_payment_intents(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,order_id) REFERENCES commerce_orders(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id), UNIQUE(provider,callback_hash), UNIQUE(provider,provider_transaction_hash)
);

CREATE TRIGGER IF NOT EXISTS commerce_order_items_no_update BEFORE UPDATE ON commerce_order_items
BEGIN SELECT RAISE(ABORT,'COMMERCE_ORDER_ITEM_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS commerce_order_items_no_delete BEFORE DELETE ON commerce_order_items
BEGIN SELECT RAISE(ABORT,'COMMERCE_ORDER_ITEM_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS commerce_orders_paid_terminal BEFORE UPDATE ON commerce_orders
WHEN OLD.payment_status='PAID' AND (NEW.payment_status<>'PAID' OR NEW.status<>'PAID')
BEGIN SELECT RAISE(ABORT,'COMMERCE_ORDER_PAID_TERMINAL'); END;
CREATE TRIGGER IF NOT EXISTS commerce_payment_intents_binding_immutable BEFORE UPDATE ON commerce_payment_intents
WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.order_id<>OLD.order_id OR NEW.provider<>OLD.provider
  OR NEW.merchant_order_no<>OLD.merchant_order_no OR NEW.merchant_id<>OLD.merchant_id
  OR NEW.amount_minor<>OLD.amount_minor OR NEW.currency_code<>OLD.currency_code
BEGIN SELECT RAISE(ABORT,'COMMERCE_PAYMENT_INTENT_BINDING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS commerce_payment_intents_paid_terminal BEFORE UPDATE ON commerce_payment_intents
WHEN OLD.status='PAID' AND NEW.status<>'PAID'
BEGIN SELECT RAISE(ABORT,'COMMERCE_PAYMENT_PAID_TERMINAL'); END;
CREATE TRIGGER IF NOT EXISTS commerce_payment_transactions_no_update BEFORE UPDATE ON commerce_payment_transactions
BEGIN SELECT RAISE(ABORT,'COMMERCE_PAYMENT_TRANSACTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS commerce_payment_transactions_no_delete BEFORE DELETE ON commerce_payment_transactions
BEGIN SELECT RAISE(ABORT,'COMMERCE_PAYMENT_TRANSACTION_IMMUTABLE'); END;
