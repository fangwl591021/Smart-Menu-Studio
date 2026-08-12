-- 0055 Travel promotion source, reviewed versions, and deterministic knowledge.
-- Additive only; no backfill, seed data, formal Travel mutation, or provider execution.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS travel_promotion_documents (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','ARCHIVED')),
  display_label TEXT NOT NULL CHECK(length(display_label) BETWEEN 1 AND 160),
  source_type TEXT NOT NULL CHECK(source_type IN ('TEXT','ASSET','MIXED')),
  current_draft_version_no INTEGER NOT NULL DEFAULT 1 CHECK(current_draft_version_no > 0),
  active_version_no INTEGER CHECK(active_version_no IS NULL OR active_version_no > 0),
  expires_at TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  CHECK((status='DRAFT' AND active_version_no IS NULL AND archived_at IS NULL)
    OR (status='ACTIVE' AND active_version_no IS NOT NULL AND archived_at IS NULL)
    OR (status='ARCHIVED' AND archived_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_travel_promotion_documents_library
  ON travel_promotion_documents(workspace_id,status,expires_at,updated_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS travel_promotion_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  promotion_document_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  version_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(version_status IN ('DRAFT','APPROVED')),
  source_revision INTEGER NOT NULL DEFAULT 1 CHECK(source_revision > 0),
  source_text_snapshot TEXT NOT NULL DEFAULT '' CHECK(length(source_text_snapshot) <= 20000),
  title TEXT NOT NULL DEFAULT '' CHECK(length(title) <= 120),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 1500),
  destination TEXT NOT NULL DEFAULT '' CHECK(length(destination) <= 120),
  region TEXT NOT NULL DEFAULT '' CHECK(length(region) <= 120),
  days INTEGER CHECK(days IS NULL OR days BETWEEN 1 AND 365),
  departure_location TEXT NOT NULL DEFAULT '' CHECK(length(departure_location) <= 240),
  date_texts_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(date_texts_json)),
  pricing_texts_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pricing_texts_json)),
  promotion_terms_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(promotion_terms_json)),
  highlights_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(highlights_json)),
  keywords_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(keywords_json)),
  faq_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(faq_json)),
  reply_template TEXT NOT NULL DEFAULT '' CHECK(length(reply_template) <= 3000),
  social_copy TEXT NOT NULL DEFAULT '' CHECK(length(social_copy) <= 1000),
  extracted_source_revision INTEGER CHECK(extracted_source_revision IS NULL OR extracted_source_revision > 0),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by_user_id TEXT,
  approved_at TEXT,
  FOREIGN KEY(workspace_id,promotion_document_id)
    REFERENCES travel_promotion_documents(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,promotion_document_id,version_no),
  CHECK((version_status='DRAFT' AND approved_at IS NULL)
    OR (version_status='APPROVED' AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_travel_promotion_versions_history
  ON travel_promotion_versions(workspace_id,promotion_document_id,version_no DESC);

CREATE TABLE IF NOT EXISTS travel_promotion_source_assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  promotion_document_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  source_revision INTEGER NOT NULL CHECK(source_revision > 0),
  asset_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no BETWEEN 1 AND 10),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,promotion_document_id,version_no)
    REFERENCES travel_promotion_versions(workspace_id,promotion_document_id,version_no) ON DELETE RESTRICT,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,promotion_document_id,version_no,source_revision,sequence_no),
  UNIQUE(workspace_id,promotion_document_id,version_no,source_revision,asset_id)
);
CREATE INDEX IF NOT EXISTS idx_travel_promotion_source_assets_version
  ON travel_promotion_source_assets(workspace_id,promotion_document_id,version_no,source_revision,sequence_no);

CREATE TABLE IF NOT EXISTS travel_promotion_knowledge_entries (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  promotion_document_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('MAIN','FAQ')),
  sequence_no INTEGER NOT NULL CHECK(sequence_no BETWEEN 0 AND 12),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
  answer TEXT NOT NULL CHECK(length(answer) BETWEEN 1 AND 3000),
  reply_template TEXT NOT NULL DEFAULT '' CHECK(length(reply_template) <= 3000),
  keywords_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(keywords_json)),
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json) AND length(metadata_json) <= 12000),
  search_text TEXT NOT NULL CHECK(length(search_text) BETWEEN 1 AND 12000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,promotion_document_id,version_no)
    REFERENCES travel_promotion_versions(workspace_id,promotion_document_id,version_no) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,promotion_document_id,version_no,entry_type,sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_travel_promotion_knowledge_current
  ON travel_promotion_knowledge_entries(workspace_id,promotion_document_id,version_no,entry_type,sequence_no);

CREATE TRIGGER IF NOT EXISTS travel_promotion_version_sequence_guard
BEFORE INSERT ON travel_promotion_versions
WHEN NEW.version_no <> COALESCE((
  SELECT MAX(v.version_no)+1 FROM travel_promotion_versions v
  WHERE v.workspace_id=NEW.workspace_id AND v.promotion_document_id=NEW.promotion_document_id
),1)
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_VERSION_CONFLICT'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_source_asset_scope_insert
BEFORE INSERT ON travel_promotion_source_assets
WHEN NOT EXISTS (
  SELECT 1 FROM assets a
  WHERE a.id=NEW.asset_id AND a.workspace_id=NEW.workspace_id
    AND a.deleted_at IS NULL AND a.status='ready'
    AND a.storage_key IS NOT NULL
    AND a.content_type IN ('image/png','image/jpeg')
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_ASSET_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_source_assets_approved_no_update
BEFORE UPDATE ON travel_promotion_source_assets
WHEN EXISTS (
  SELECT 1 FROM travel_promotion_versions v
  WHERE v.workspace_id=OLD.workspace_id AND v.promotion_document_id=OLD.promotion_document_id
    AND v.version_no=OLD.version_no AND v.version_status='APPROVED'
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_SOURCE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_source_assets_approved_no_delete
BEFORE DELETE ON travel_promotion_source_assets
WHEN EXISTS (
  SELECT 1 FROM travel_promotion_versions v
  WHERE v.workspace_id=OLD.workspace_id AND v.promotion_document_id=OLD.promotion_document_id
    AND v.version_no=OLD.version_no AND v.version_status='APPROVED'
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_SOURCE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_versions_approved_no_update
BEFORE UPDATE ON travel_promotion_versions
WHEN OLD.version_status='APPROVED'
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_APPROVED_VERSION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_versions_no_delete
BEFORE DELETE ON travel_promotion_versions
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_VERSION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_knowledge_entries_no_update
BEFORE UPDATE ON travel_promotion_knowledge_entries
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_KNOWLEDGE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_knowledge_entries_no_delete
BEFORE DELETE ON travel_promotion_knowledge_entries
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_KNOWLEDGE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_documents_no_delete
BEFORE DELETE ON travel_promotion_documents
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_ARCHIVE_REQUIRED'); END;
