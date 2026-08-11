-- 0047 Member Self Commerce order ownership. Additive only; no backfill or seed data.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commerce_order_member_owners (
  order_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  line_member_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,order_id) REFERENCES commerce_orders(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(line_member_id) REFERENCES line_oa_members(id) ON DELETE RESTRICT,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,order_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_member_orders
  ON commerce_order_member_owners(workspace_id,line_account_id,line_member_id,created_at DESC,order_id);

CREATE TRIGGER IF NOT EXISTS commerce_order_member_owner_scope_insert
BEFORE INSERT ON commerce_order_member_owners
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_line_accounts a
  WHERE a.id=NEW.line_account_id AND a.workspace_id=NEW.workspace_id
) OR NOT EXISTS (
  SELECT 1 FROM line_oa_members m
  WHERE m.id=NEW.line_member_id
    AND m.workspace_id=NEW.workspace_id
    AND m.line_account_id=NEW.line_account_id
) OR NOT EXISTS (
  SELECT 1 FROM crm_person_identity_links l
  JOIN crm_people p ON p.id=l.crm_person_id AND p.workspace_id=l.workspace_id
  WHERE l.workspace_id=NEW.workspace_id
    AND l.line_account_id=NEW.line_account_id
    AND l.line_member_id=NEW.line_member_id
    AND l.crm_person_id=NEW.crm_person_id
    AND l.identity_type='LINE_MEMBER'
    AND l.verification_status='VERIFIED'
)
BEGIN SELECT RAISE(ABORT,'COMMERCE_MEMBER_OWNER_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS commerce_order_member_owner_no_update
BEFORE UPDATE ON commerce_order_member_owners
BEGIN SELECT RAISE(ABORT,'COMMERCE_MEMBER_OWNER_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS commerce_order_member_owner_no_delete
BEFORE DELETE ON commerce_order_member_owners
BEGIN SELECT RAISE(ABORT,'COMMERCE_MEMBER_OWNER_IMMUTABLE'); END;
