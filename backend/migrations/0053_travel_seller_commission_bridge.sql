-- 0053 Travel seller permission, immutable booking attribution, and Commission bridge.
-- Additive only; no backfill, seed data, fake sellers, bookings, or commissions.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS travel_seller_permissions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  dealer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  created_by_user_id TEXT,
  revoked_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(dealer_id) REFERENCES line_oa_dealers(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,line_account_id,dealer_id),
  UNIQUE(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS idx_travel_seller_permissions_status
  ON travel_seller_permissions(workspace_id,line_account_id,status,created_at,id);

CREATE TABLE IF NOT EXISTS travel_booking_seller_contexts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  seller_dealer_id TEXT NOT NULL,
  seller_permission_id TEXT NOT NULL,
  member_referral_attribution_id TEXT NOT NULL,
  safe_seller_reference_snapshot TEXT NOT NULL,
  seller_label_snapshot TEXT NOT NULL CHECK(length(seller_label_snapshot) BETWEEN 1 AND 120),
  commissionable_amount_minor_snapshot INTEGER NOT NULL
    CHECK(commissionable_amount_minor_snapshot BETWEEN 1 AND 100000000),
  currency_code_snapshot TEXT NOT NULL DEFAULT 'TWD' CHECK(currency_code_snapshot='TWD'),
  attributed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,booking_id) REFERENCES travel_booking_extensions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_dealer_id) REFERENCES line_oa_dealers(id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_permission_id) REFERENCES travel_seller_permissions(id) ON DELETE RESTRICT,
  FOREIGN KEY(member_referral_attribution_id) REFERENCES member_referral_attributions(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,booking_id),
  UNIQUE(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS idx_travel_booking_seller_contexts_dealer
  ON travel_booking_seller_contexts(workspace_id,line_account_id,seller_dealer_id,attributed_at,id);

CREATE TABLE IF NOT EXISTS travel_seller_bridge_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  permission_id TEXT,
  booking_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'TRAVEL_SELLER_PERMISSION_GRANTED',
    'TRAVEL_SELLER_PERMISSION_REVOKED',
    'TRAVEL_SELLER_ATTRIBUTION_FROZEN',
    'TRAVEL_COMMISSION_ELIGIBILITY_PROJECTED'
  )),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('TENANT_USER','SYSTEM')),
  actor_user_id TEXT,
  reason_code TEXT CHECK(reason_code IS NULL OR length(reason_code) <= 80),
  dedupe_key TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,permission_id) REFERENCES travel_seller_permissions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,booking_id) REFERENCES travel_booking_extensions(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,dedupe_key),
  CHECK(
    (event_type IN ('TRAVEL_SELLER_PERMISSION_GRANTED','TRAVEL_SELLER_PERMISSION_REVOKED') AND permission_id IS NOT NULL)
    OR
    (event_type IN ('TRAVEL_SELLER_ATTRIBUTION_FROZEN','TRAVEL_COMMISSION_ELIGIBILITY_PROJECTED') AND booking_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_travel_seller_bridge_events_time
  ON travel_seller_bridge_events(workspace_id,line_account_id,occurred_at DESC,id DESC);

CREATE TRIGGER IF NOT EXISTS travel_seller_permission_scope_insert
BEFORE INSERT ON travel_seller_permissions
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_line_accounts a
  WHERE a.id=NEW.line_account_id AND a.workspace_id=NEW.workspace_id
) OR NOT EXISTS (
  SELECT 1 FROM line_oa_dealers d
  WHERE d.id=NEW.dealer_id AND d.workspace_id=NEW.workspace_id AND d.line_account_id=NEW.line_account_id
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_PERMISSION_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_seller_permission_scope_update
BEFORE UPDATE ON travel_seller_permissions
WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.line_account_id<>OLD.line_account_id OR NEW.dealer_id<>OLD.dealer_id
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_PERMISSION_SCOPE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_booking_seller_context_scope_insert
BEFORE INSERT ON travel_booking_seller_contexts
WHEN NOT EXISTS (
  SELECT 1
  FROM travel_booking_extensions b
  JOIN travel_seller_permissions p
    ON p.id=NEW.seller_permission_id AND p.workspace_id=NEW.workspace_id
   AND p.line_account_id=NEW.line_account_id AND p.dealer_id=NEW.seller_dealer_id
  JOIN member_referral_attributions r
    ON r.id=NEW.member_referral_attribution_id AND r.workspace_id=NEW.workspace_id
   AND r.line_account_id=NEW.line_account_id AND r.invitee_member_id=b.line_member_id
   AND r.status='qualified' AND datetime(r.qualified_at)<=datetime(NEW.attributed_at)
  JOIN line_oa_dealers d
    ON d.id=NEW.seller_dealer_id AND d.workspace_id=NEW.workspace_id
   AND d.line_account_id=NEW.line_account_id AND d.member_id=r.inviter_member_id
  WHERE b.id=NEW.booking_id AND b.workspace_id=NEW.workspace_id
    AND b.line_account_id=NEW.line_account_id AND b.seller_dealer_id=NEW.seller_dealer_id
    AND b.total_amount_minor_snapshot=NEW.commissionable_amount_minor_snapshot
    AND b.currency_code_snapshot=NEW.currency_code_snapshot
    AND p.status='ACTIVE' AND d.status='ACTIVE'
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_ATTRIBUTION_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_booking_seller_context_no_update
BEFORE UPDATE ON travel_booking_seller_contexts
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_ATTRIBUTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS travel_booking_seller_context_no_delete
BEFORE DELETE ON travel_booking_seller_contexts
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_ATTRIBUTION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_booking_seller_no_reassignment
BEFORE UPDATE OF seller_dealer_id ON travel_booking_extensions
WHEN NEW.seller_dealer_id IS NOT OLD.seller_dealer_id
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_ATTRIBUTION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_seller_bridge_events_no_update
BEFORE UPDATE ON travel_seller_bridge_events
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_EVENTS_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS travel_seller_bridge_events_no_delete
BEFORE DELETE ON travel_seller_bridge_events
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_EVENTS_APPEND_ONLY'); END;
