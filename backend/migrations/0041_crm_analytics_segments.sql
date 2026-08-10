-- 0041 CRM analytics saved segmentation. Additive only; memberships are evaluated live.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS crm_segments (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  current_version_no INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,name)
);
CREATE INDEX IF NOT EXISTS idx_crm_segments_workspace_status ON crm_segments(workspace_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_segment_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  rule_version INTEGER NOT NULL CHECK(rule_version=1),
  rule_json TEXT NOT NULL,
  description TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(segment_id) REFERENCES crm_segments(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,segment_id,version_no)
);
CREATE INDEX IF NOT EXISTS idx_crm_segment_versions_history ON crm_segment_versions(workspace_id,segment_id,version_no DESC);
CREATE TRIGGER IF NOT EXISTS crm_segment_versions_no_update BEFORE UPDATE ON crm_segment_versions BEGIN SELECT RAISE(ABORT,'CRM_SEGMENT_VERSION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS crm_segment_versions_no_delete BEFORE DELETE ON crm_segment_versions BEGIN SELECT RAISE(ABORT,'CRM_SEGMENT_VERSION_IMMUTABLE'); END;
