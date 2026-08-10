-- 0036 CRM Import / OCR / Dedup Foundation. Additive only; no backfill.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS crm_import_jobs (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  import_type TEXT NOT NULL CHECK (import_type IN ('BUSINESS_CARD_OCR','CSV','XLSX','API')),
  status TEXT NOT NULL CHECK (status IN ('RECEIVED','PROCESSING','REVIEW_READY','COMPLETED','FAILED','CANCELLED')),
  source_filename TEXT NOT NULL DEFAULT '',
  source_content_type TEXT NOT NULL DEFAULT '',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  match_candidate_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crm_import_jobs_workspace ON crm_import_jobs(workspace_id,created_at DESC);

CREATE TABLE IF NOT EXISTS crm_import_rows (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  import_job_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PARSED','INVALID','MATCH_CANDIDATE','READY_CREATE','READY_LINK','RESOLVED','REJECTED','MERGE_REVIEW_REQUIRED')),
  raw_data_json TEXT NOT NULL DEFAULT '{}',
  parsed_data_json TEXT NOT NULL DEFAULT '{}',
  normalized_mobile TEXT NOT NULL DEFAULT '',
  normalized_email TEXT NOT NULL DEFAULT '',
  candidate_person_id TEXT,
  match_confidence TEXT NOT NULL DEFAULT 'NO_MATCH' CHECK (match_confidence IN ('TRUSTED_EXACT','POSSIBLE_MATCH','NO_MATCH','CONFLICT')),
  match_reason TEXT NOT NULL DEFAULT '',
  resolution TEXT,
  resolved_person_id TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (import_job_id) REFERENCES crm_import_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_person_id) REFERENCES crm_people(id) ON DELETE SET NULL,
  UNIQUE(import_job_id,row_number)
);
CREATE INDEX IF NOT EXISTS idx_crm_import_rows_review ON crm_import_rows(workspace_id,import_job_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_crm_import_rows_mobile ON crm_import_rows(workspace_id,normalized_mobile) WHERE normalized_mobile<>'';
CREATE INDEX IF NOT EXISTS idx_crm_import_rows_email ON crm_import_rows(workspace_id,normalized_email) WHERE normalized_email<>'';

CREATE TABLE IF NOT EXISTS crm_person_merge_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  surviving_person_id TEXT NOT NULL,
  merged_person_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (surviving_person_id) REFERENCES crm_people(id) ON DELETE RESTRICT,
  FOREIGN KEY (merged_person_id) REFERENCES crm_people(id) ON DELETE RESTRICT,
  CHECK (surviving_person_id<>merged_person_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_person_merge_events_workspace ON crm_person_merge_events(workspace_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS crm_person_merge_events_no_update BEFORE UPDATE ON crm_person_merge_events BEGIN SELECT RAISE(ABORT,'CRM_PERSON_MERGE_EVENTS_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS crm_person_merge_events_no_delete BEFORE DELETE ON crm_person_merge_events BEGIN SELECT RAISE(ABORT,'CRM_PERSON_MERGE_EVENTS_APPEND_ONLY'); END;
