-- 0043 Campaign, immutable TEXT content versions, and idempotent prepare contract.
-- Additive only. No backfill, seed data, delivery state, or provider execution.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PREPARED','ARCHIVED')),
  current_content_version_no INTEGER NOT NULL DEFAULT 0 CHECK(current_content_version_no >= 0),
  current_audience_id TEXT,
  current_audience_snapshot_no INTEGER CHECK(current_audience_snapshot_no IS NULL OR current_audience_snapshot_no > 0),
  prepared_content_version_no INTEGER CHECK(prepared_content_version_no IS NULL OR prepared_content_version_no > 0),
  prepared_segment_id TEXT,
  prepared_segment_version_no INTEGER CHECK(prepared_segment_version_no IS NULL OR prepared_segment_version_no > 0),
  matched_count INTEGER CHECK(matched_count IS NULL OR matched_count >= 0),
  eligible_count INTEGER CHECK(eligible_count IS NULL OR eligible_count >= 0),
  excluded_count INTEGER CHECK(excluded_count IS NULL OR excluded_count >= 0),
  exclusion_breakdown_json TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  prepared_at TEXT,
  archived_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,current_audience_id) REFERENCES campaign_audiences(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,current_audience_id,current_audience_snapshot_no) REFERENCES campaign_audience_snapshots(workspace_id,audience_id,snapshot_no) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,id,prepared_content_version_no) REFERENCES campaign_content_versions(workspace_id,campaign_id,version_no) ON DELETE RESTRICT,
  FOREIGN KEY(prepared_segment_id) REFERENCES crm_segments(id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,prepared_segment_id,prepared_segment_version_no) REFERENCES crm_segment_versions(workspace_id,segment_id,version_no) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,name),
  CHECK(matched_count IS NULL OR matched_count = eligible_count + excluded_count),
  CHECK(
    (status='DRAFT' AND current_audience_id IS NULL AND current_audience_snapshot_no IS NULL
      AND prepared_content_version_no IS NULL AND prepared_segment_id IS NULL
      AND prepared_segment_version_no IS NULL AND matched_count IS NULL
      AND eligible_count IS NULL AND excluded_count IS NULL
      AND exclusion_breakdown_json IS NULL AND prepared_at IS NULL)
    OR
    (status IN ('PREPARED','ARCHIVED') AND current_audience_id IS NOT NULL
      AND current_audience_snapshot_no IS NOT NULL AND prepared_content_version_no IS NOT NULL
      AND prepared_segment_id IS NOT NULL AND prepared_segment_version_no IS NOT NULL
      AND matched_count IS NOT NULL AND eligible_count IS NOT NULL AND excluded_count IS NOT NULL
      AND exclusion_breakdown_json IS NOT NULL AND prepared_at IS NOT NULL)
    OR
    (status='ARCHIVED' AND current_audience_id IS NULL AND current_audience_snapshot_no IS NULL
      AND prepared_content_version_no IS NULL AND prepared_segment_id IS NULL
      AND prepared_segment_version_no IS NULL AND matched_count IS NULL
      AND eligible_count IS NULL AND excluded_count IS NULL
      AND exclusion_breakdown_json IS NULL AND prepared_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_status
  ON campaigns(workspace_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_content_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  content_type TEXT NOT NULL CHECK(content_type='TEXT'),
  payload_json TEXT NOT NULL,
  text_length INTEGER NOT NULL CHECK(text_length > 0 AND text_length <= 5000),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,campaign_id,version_no)
);
CREATE INDEX IF NOT EXISTS idx_campaign_content_versions_history
  ON campaign_content_versions(workspace_id,campaign_id,version_no DESC);

CREATE TABLE IF NOT EXISTS campaign_prepare_actions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  action_reference_hash TEXT NOT NULL CHECK(length(action_reference_hash)=64),
  audience_id TEXT NOT NULL,
  audience_snapshot_no INTEGER NOT NULL CHECK(audience_snapshot_no > 0),
  content_version_no INTEGER NOT NULL CHECK(content_version_no > 0),
  segment_id TEXT NOT NULL,
  segment_version_no INTEGER NOT NULL CHECK(segment_version_no > 0),
  matched_count INTEGER NOT NULL CHECK(matched_count >= 0),
  eligible_count INTEGER NOT NULL CHECK(eligible_count >= 0),
  excluded_count INTEGER NOT NULL CHECK(excluded_count >= 0),
  exclusion_breakdown_json TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,campaign_id,content_version_no) REFERENCES campaign_content_versions(workspace_id,campaign_id,version_no) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,audience_id) REFERENCES campaign_audiences(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,audience_id,audience_snapshot_no) REFERENCES campaign_audience_snapshots(workspace_id,audience_id,snapshot_no) ON DELETE RESTRICT,
  FOREIGN KEY(segment_id) REFERENCES crm_segments(id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,segment_id,segment_version_no) REFERENCES crm_segment_versions(workspace_id,segment_id,version_no) ON DELETE RESTRICT,
  UNIQUE(workspace_id,campaign_id,action_reference_hash),
  CHECK(matched_count = eligible_count + excluded_count)
);
CREATE INDEX IF NOT EXISTS idx_campaign_prepare_actions_history
  ON campaign_prepare_actions(workspace_id,campaign_id,prepared_at DESC);

CREATE TRIGGER IF NOT EXISTS campaign_content_version_sequence_guard
BEFORE INSERT ON campaign_content_versions
WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c
  WHERE c.workspace_id=NEW.workspace_id
    AND c.id=NEW.campaign_id
    AND c.status='DRAFT'
    AND NEW.version_no=c.current_content_version_no+1
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CONTENT_VERSION_CONFLICT'); END;

CREATE TRIGGER IF NOT EXISTS campaign_content_versions_no_update
BEFORE UPDATE ON campaign_content_versions
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CONTENT_VERSION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_content_versions_no_delete
BEFORE DELETE ON campaign_content_versions
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CONTENT_VERSION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_prepare_action_state_guard
BEFORE INSERT ON campaign_prepare_actions
WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c
  WHERE c.workspace_id=NEW.workspace_id
    AND c.id=NEW.campaign_id
    AND c.status='PREPARED'
    AND c.current_audience_id=NEW.audience_id
    AND c.current_audience_snapshot_no=NEW.audience_snapshot_no
    AND c.prepared_content_version_no=NEW.content_version_no
    AND c.prepared_segment_id=NEW.segment_id
    AND c.prepared_segment_version_no=NEW.segment_version_no
    AND c.matched_count=NEW.matched_count
    AND c.eligible_count=NEW.eligible_count
    AND c.excluded_count=NEW.excluded_count
    AND c.exclusion_breakdown_json=NEW.exclusion_breakdown_json
    AND c.prepared_at=NEW.prepared_at
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_PREPARE_CONFLICT'); END;

CREATE TRIGGER IF NOT EXISTS campaign_prepare_actions_no_update
BEFORE UPDATE ON campaign_prepare_actions
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_PREPARE_ACTION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_prepare_actions_no_delete
BEFORE DELETE ON campaign_prepare_actions
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_PREPARE_ACTION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaigns_prepared_fields_frozen
BEFORE UPDATE ON campaigns
WHEN OLD.current_audience_id IS NOT NULL AND (
  NEW.current_content_version_no<>OLD.current_content_version_no
  OR NEW.current_audience_id IS NOT OLD.current_audience_id
  OR NEW.current_audience_snapshot_no IS NOT OLD.current_audience_snapshot_no
  OR NEW.prepared_content_version_no IS NOT OLD.prepared_content_version_no
  OR NEW.prepared_segment_id IS NOT OLD.prepared_segment_id
  OR NEW.prepared_segment_version_no IS NOT OLD.prepared_segment_version_no
  OR NEW.matched_count IS NOT OLD.matched_count
  OR NEW.eligible_count IS NOT OLD.eligible_count
  OR NEW.excluded_count IS NOT OLD.excluded_count
  OR NEW.exclusion_breakdown_json IS NOT OLD.exclusion_breakdown_json
  OR NEW.prepared_at IS NOT OLD.prepared_at
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_PREPARED_VERSION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaigns_no_delete
BEFORE DELETE ON campaigns
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_ARCHIVE_REQUIRED'); END;
