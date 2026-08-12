-- 0057 Immutable structured content attached to an existing Campaign TEXT version.
-- Additive only; no backfill, seed data, Campaign execution, or provider call.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaign_structured_content_extensions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  content_version_no INTEGER NOT NULL CHECK(content_version_no > 0),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
  message_type TEXT NOT NULL CHECK(message_type = 'TRAVEL_PROMOTION'),
  presentation_format TEXT NOT NULL CHECK(presentation_format IN ('SINGLE','CAROUSEL','LIST','TRAVEL_4_GRID','TRAVEL_6_GRID')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json) BETWEEN 2 AND 50000),
  fallback_text TEXT NOT NULL CHECK(length(fallback_text) BETWEEN 1 AND 5000),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,campaign_id,content_version_no)
    REFERENCES campaign_content_versions(workspace_id,campaign_id,version_no) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,campaign_id,content_version_no)
);
CREATE INDEX IF NOT EXISTS idx_campaign_structured_content_version
  ON campaign_structured_content_extensions(workspace_id,campaign_id,content_version_no);

CREATE TRIGGER IF NOT EXISTS campaign_structured_content_parent_guard
BEFORE INSERT ON campaign_structured_content_extensions
WHEN NOT EXISTS (
  SELECT 1 FROM campaign_content_versions v
  WHERE v.workspace_id=NEW.workspace_id AND v.campaign_id=NEW.campaign_id
    AND v.version_no=NEW.content_version_no AND v.content_type='TEXT'
    AND json_extract(v.payload_json,'$.text')=NEW.fallback_text
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_STRUCTURED_CONTENT_PARENT_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS campaign_structured_content_payload_guard
BEFORE INSERT ON campaign_structured_content_extensions
WHEN json_extract(NEW.payload_json,'$.schemaVersion') IS NOT 1
  OR json_extract(NEW.payload_json,'$.messageType') IS NOT 'TRAVEL_PROMOTION'
  OR json_extract(NEW.payload_json,'$.format') IS NOT NEW.presentation_format
  OR json_type(NEW.payload_json,'$.messages') IS NOT 'array'
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_STRUCTURED_CONTENT_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS campaign_structured_content_no_update
BEFORE UPDATE ON campaign_structured_content_extensions
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_STRUCTURED_CONTENT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_structured_content_no_delete
BEFORE DELETE ON campaign_structured_content_extensions
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_STRUCTURED_CONTENT_IMMUTABLE'); END;
