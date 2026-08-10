-- 0042 Campaign audience foundation.
-- Additive only. Audiences materialize immutable, tenant-scoped CRM segment snapshots.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaign_audiences (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  source_segment_id TEXT NOT NULL,
  current_snapshot_no INTEGER NOT NULL DEFAULT 0 CHECK(current_snapshot_no >= 0),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(source_segment_id) REFERENCES crm_segments(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,name)
);
CREATE INDEX IF NOT EXISTS idx_campaign_audiences_workspace_status
  ON campaign_audiences(workspace_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_audience_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  snapshot_no INTEGER NOT NULL CHECK(snapshot_no > 0),
  source_segment_id TEXT NOT NULL,
  source_segment_version_no INTEGER NOT NULL CHECK(source_segment_version_no > 0),
  rule_version INTEGER NOT NULL CHECK(rule_version = 1),
  rule_json TEXT NOT NULL,
  matched_count INTEGER NOT NULL CHECK(matched_count >= 0),
  eligible_count INTEGER NOT NULL CHECK(eligible_count >= 0),
  excluded_count INTEGER NOT NULL CHECK(excluded_count >= 0),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,audience_id) REFERENCES campaign_audiences(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(source_segment_id) REFERENCES crm_segments(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,audience_id,snapshot_no),
  CHECK(matched_count = eligible_count + excluded_count)
);
CREATE INDEX IF NOT EXISTS idx_campaign_audience_snapshots_history
  ON campaign_audience_snapshots(workspace_id,audience_id,snapshot_no DESC);

CREATE TABLE IF NOT EXISTS campaign_audience_snapshot_members (
  workspace_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  eligibility_status TEXT NOT NULL CHECK(eligibility_status IN ('ELIGIBLE','EXCLUDED')),
  exclusion_reason TEXT CHECK(exclusion_reason IS NULL OR exclusion_reason IN ('PERSON_ARCHIVED','DO_NOT_CONTACT','NOT_CONTACTABLE','MARKETING_CONSENT_MISSING','NO_VERIFIED_LINE_IDENTITY')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(snapshot_id,crm_person_id),
  FOREIGN KEY(workspace_id,audience_id) REFERENCES campaign_audiences(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,snapshot_id) REFERENCES campaign_audience_snapshots(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE RESTRICT,
  CHECK((eligibility_status = 'ELIGIBLE' AND exclusion_reason IS NULL) OR (eligibility_status = 'EXCLUDED' AND exclusion_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_campaign_audience_members_read
  ON campaign_audience_snapshot_members(workspace_id,audience_id,snapshot_id,eligibility_status,crm_person_id);

CREATE TRIGGER IF NOT EXISTS campaign_audience_snapshot_sequence_guard
BEFORE INSERT ON campaign_audience_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM campaign_audiences a
  WHERE a.workspace_id=NEW.workspace_id
    AND a.id=NEW.audience_id
    AND a.status='ACTIVE'
    AND a.current_snapshot_no=NEW.snapshot_no-1
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_AUDIENCE_SNAPSHOT_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS campaign_audience_snapshots_no_update
BEFORE UPDATE ON campaign_audience_snapshots
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_AUDIENCE_SNAPSHOT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_audience_snapshots_no_delete
BEFORE DELETE ON campaign_audience_snapshots
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_AUDIENCE_SNAPSHOT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_audience_members_no_update
BEFORE UPDATE ON campaign_audience_snapshot_members
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_AUDIENCE_MEMBER_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_audience_members_no_delete
BEFORE DELETE ON campaign_audience_snapshot_members
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_AUDIENCE_MEMBER_IMMUTABLE'); END;
