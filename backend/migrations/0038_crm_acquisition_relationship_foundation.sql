-- 0038 CRM acquisition evidence and relationship projections. Additive only.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS crm_acquisition_events (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,crm_person_id TEXT,source_type TEXT NOT NULL CHECK(source_type IN ('LINE_ORGANIC','KEYWORD','RICH_MENU','QR','LINE_SHARE','REFERRAL_SHARE','PERSONAL_CARD_SHARE','CONTACT_CARD_SHARE','EVENT','CSV_IMPORT','XLSX_IMPORT','OCR_IMPORT','API_IMPORT','MANUAL')),source_ref TEXT NOT NULL DEFAULT '',channel TEXT NOT NULL DEFAULT '',campaign_key TEXT,occurred_at TEXT NOT NULL,confidence TEXT NOT NULL CHECK(confidence IN ('SYSTEM_VERIFIED','TRUSTED_EVIDENCE','IMPORTED','MANUAL')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_crm_acquisition_person_time ON crm_acquisition_events(workspace_id,crm_person_id,occurred_at,id);
CREATE TRIGGER IF NOT EXISTS crm_acquisition_events_no_update BEFORE UPDATE ON crm_acquisition_events BEGIN SELECT RAISE(ABORT,'CRM_ACQUISITION_EVENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS crm_acquisition_events_no_delete BEFORE DELETE ON crm_acquisition_events BEGIN SELECT RAISE(ABORT,'CRM_ACQUISITION_EVENT_APPEND_ONLY'); END;
CREATE TABLE IF NOT EXISTS crm_person_relationships (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,crm_person_id TEXT NOT NULL,relationship_type TEXT NOT NULL CHECK(relationship_type IN ('REFERRED_BY','ASSIGNED_TO')),related_user_id TEXT,source_attribution_id TEXT,reason TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('ACTIVE','ENDED')),assigned_by_user_id TEXT,assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,unassigned_at TEXT,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_person_assignment_active ON crm_person_relationships(workspace_id,crm_person_id) WHERE relationship_type='ASSIGNED_TO' AND status='ACTIVE';
CREATE INDEX IF NOT EXISTS idx_crm_person_relationship_history ON crm_person_relationships(workspace_id,crm_person_id,relationship_type,assigned_at DESC);
CREATE TRIGGER IF NOT EXISTS crm_referred_by_no_update BEFORE UPDATE ON crm_person_relationships WHEN OLD.relationship_type='REFERRED_BY' BEGIN SELECT RAISE(ABORT,'CRM_REFERRED_BY_READ_ONLY'); END;