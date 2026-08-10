-- 0037 CRM personal cards, collection and safe share evidence. Additive only.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS crm_personal_cards (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, crm_person_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
 current_version_no INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_personal_cards_one_active ON crm_personal_cards(workspace_id,crm_person_id) WHERE status='ACTIVE';
CREATE TABLE IF NOT EXISTS crm_personal_card_versions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, personal_card_id TEXT NOT NULL, version_no INTEGER NOT NULL,
 display_name TEXT NOT NULL DEFAULT '',english_name TEXT NOT NULL DEFAULT '',company_name TEXT NOT NULL DEFAULT '',department TEXT NOT NULL DEFAULT '',job_title TEXT NOT NULL DEFAULT '',
 mobile TEXT NOT NULL DEFAULT '',company_phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',website_url TEXT NOT NULL DEFAULT '',line_url TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',service_description TEXT NOT NULL DEFAULT '',
 avatar_asset_reference TEXT,share_alt_text TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,FOREIGN KEY(personal_card_id) REFERENCES crm_personal_cards(id) ON DELETE CASCADE,UNIQUE(personal_card_id,version_no)
);
CREATE TRIGGER IF NOT EXISTS crm_personal_card_versions_no_update BEFORE UPDATE ON crm_personal_card_versions BEGIN SELECT RAISE(ABORT,'CRM_PERSONAL_CARD_VERSION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS crm_personal_card_versions_no_delete BEFORE DELETE ON crm_personal_card_versions BEGIN SELECT RAISE(ABORT,'CRM_PERSONAL_CARD_VERSION_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS crm_business_cards (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,crm_person_id TEXT,source_type TEXT NOT NULL CHECK(source_type IN ('OCR_IMPORT','MANUAL','PUBLIC_PERSONAL_CARD')),import_row_id TEXT,
 display_name TEXT NOT NULL DEFAULT '',english_name TEXT NOT NULL DEFAULT '',company_name TEXT NOT NULL DEFAULT '',department TEXT NOT NULL DEFAULT '',job_title TEXT NOT NULL DEFAULT '',mobile TEXT NOT NULL DEFAULT '',company_phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',website_url TEXT NOT NULL DEFAULT '',line_url TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',service_description TEXT NOT NULL DEFAULT '',front_asset_reference TEXT,back_asset_reference TEXT,captured_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,archived_at TEXT,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE SET NULL,FOREIGN KEY(import_row_id) REFERENCES crm_import_rows(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS crm_card_collections (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collector_person_id TEXT NOT NULL,collected_person_id TEXT NOT NULL,business_card_id TEXT,personal_card_id TEXT,collection_source TEXT NOT NULL,private_note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'ACTIVE',collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,FOREIGN KEY(collector_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,FOREIGN KEY(collected_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,FOREIGN KEY(business_card_id) REFERENCES crm_business_cards(id) ON DELETE SET NULL,FOREIGN KEY(personal_card_id) REFERENCES crm_personal_cards(id) ON DELETE SET NULL,
 UNIQUE(workspace_id,collector_person_id,collected_person_id,personal_card_id)
);
CREATE TABLE IF NOT EXISTS crm_card_shares (
 id TEXT PRIMARY KEY,public_ref TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,personal_card_id TEXT NOT NULL,card_version_id TEXT NOT NULL,owner_person_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),expires_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,revoked_at TEXT,last_accessed_at TEXT,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,FOREIGN KEY(personal_card_id) REFERENCES crm_personal_cards(id) ON DELETE CASCADE,FOREIGN KEY(card_version_id) REFERENCES crm_personal_card_versions(id) ON DELETE RESTRICT,FOREIGN KEY(owner_person_id) REFERENCES crm_people(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS crm_card_share_events (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,card_share_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(event_type='OPENED'),occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,FOREIGN KEY(card_share_id) REFERENCES crm_card_shares(id) ON DELETE CASCADE
);
CREATE TRIGGER IF NOT EXISTS crm_card_share_events_no_update BEFORE UPDATE ON crm_card_share_events BEGIN SELECT RAISE(ABORT,'CRM_CARD_SHARE_EVENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS crm_card_share_events_no_delete BEFORE DELETE ON crm_card_share_events BEGIN SELECT RAISE(ABORT,'CRM_CARD_SHARE_EVENT_APPEND_ONLY'); END;