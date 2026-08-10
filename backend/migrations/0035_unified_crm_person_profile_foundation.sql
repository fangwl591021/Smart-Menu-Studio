-- 0035 Unified CRM Person / Identity / Profile Foundation
-- Additive only. No backfill and no existing business-table mutation.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS crm_people (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crm_people_workspace_status ON crm_people(workspace_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_person_identity_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  identity_type TEXT NOT NULL CHECK (identity_type='LINE_MEMBER'),
  line_account_id TEXT NOT NULL,
  line_member_id TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'VERIFIED' CHECK (verification_status='VERIFIED'),
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (line_member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,line_member_id),
  UNIQUE(crm_person_id,identity_type,line_account_id,line_member_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_person_identity_links_person ON crm_person_identity_links(workspace_id,crm_person_id);

CREATE TABLE IF NOT EXISTS crm_profiles (
  crm_person_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  english_name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  normalized_mobile TEXT NOT NULL DEFAULT '',
  company_phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  normalized_email TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  line_url TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  birthday TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '' CHECK (gender IN ('','FEMALE','MALE','OTHER','PREFER_NOT_TO_SAY')),
  region TEXT NOT NULL DEFAULT '',
  preferred_language TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  preferred_contact_channel TEXT NOT NULL DEFAULT '',
  contactable INTEGER NOT NULL DEFAULT 1 CHECK (contactable IN (0,1)),
  do_not_contact INTEGER NOT NULL DEFAULT 0 CHECK (do_not_contact IN (0,1)),
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crm_profiles_normalized_mobile ON crm_profiles(normalized_mobile) WHERE normalized_mobile<>'';
CREATE INDEX IF NOT EXISTS idx_crm_profiles_normalized_email ON crm_profiles(normalized_email) WHERE normalized_email<>'';

CREATE TABLE IF NOT EXISTS crm_profile_field_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('LINE_VERIFIED','MEMBER_SELF_INPUT','CRM_MANUAL','OCR','CSV_IMPORT','API_IMPORT','SYSTEM_DERIVED','AI_DERIVED','REFERRAL_ATTRIBUTION')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('MEMBER','TENANT_USER','SYSTEM')),
  actor_user_id TEXT,
  previous_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crm_profile_field_events_person ON crm_profile_field_events(workspace_id,crm_person_id,changed_at DESC);

CREATE TRIGGER IF NOT EXISTS crm_profile_field_events_no_update
BEFORE UPDATE ON crm_profile_field_events
BEGIN
  SELECT RAISE(ABORT, 'CRM_PROFILE_FIELD_EVENTS_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS crm_profile_field_events_no_delete
BEFORE DELETE ON crm_profile_field_events
BEGIN
  SELECT RAISE(ABORT, 'CRM_PROFILE_FIELD_EVENTS_APPEND_ONLY');
END;
