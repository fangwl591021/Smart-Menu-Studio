-- 0039 CRM tags, versioned insights, and deterministic traits. Additive only.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS crm_tags (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tag_workspace_name ON crm_tags(workspace_id,name);
CREATE INDEX IF NOT EXISTS idx_crm_tag_workspace_status ON crm_tags(workspace_id,status,name);

CREATE TABLE IF NOT EXISTS crm_person_tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  crm_tag_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('CRM_MANUAL','SYSTEM_RULE','AI_SUGGESTED')),
  assigned_by_user_id TEXT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_tag_id) REFERENCES crm_tags(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_person_tag_active ON crm_person_tags(workspace_id,crm_person_id,crm_tag_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_person_tag_history ON crm_person_tags(workspace_id,crm_person_id,assigned_at DESC);

CREATE TABLE IF NOT EXISTS crm_person_insights (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  insight_type TEXT NOT NULL,
  dimension TEXT NOT NULL,
  label TEXT NOT NULL,
  summary TEXT NOT NULL,
  score INTEGER,
  source_type TEXT NOT NULL CHECK(source_type IN ('SYSTEM_RULE','AI_SUGGESTED','MANUAL_REVIEW')),
  model_or_rule_version TEXT NOT NULL,
  evidence_summary TEXT,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','GENERATED','REVIEWED','SUPERSEDED','REJECTED')),
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crm_person_insights_read ON crm_person_insights(workspace_id,crm_person_id,dimension,generated_at DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS crm_person_insights_no_update BEFORE UPDATE ON crm_person_insights BEGIN SELECT RAISE(ABORT,'CRM_PERSON_INSIGHT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS crm_person_insights_no_delete BEFORE DELETE ON crm_person_insights BEGIN SELECT RAISE(ABORT,'CRM_PERSON_INSIGHT_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS crm_person_traits (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  trait_type TEXT NOT NULL CHECK(trait_type IN ('ZODIAC','CHINESE_ZODIAC','LIFE_PATH_NUMBER')),
  trait_value TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('DETERMINISTIC_RULE','MANUAL_REVIEW')),
  derivation_version TEXT NOT NULL,
  input_snapshot_hash TEXT,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_person_trait_active ON crm_person_traits(workspace_id,crm_person_id,trait_type) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_person_trait_history ON crm_person_traits(workspace_id,crm_person_id,trait_type,generated_at DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS crm_person_traits_no_delete BEFORE DELETE ON crm_person_traits BEGIN SELECT RAISE(ABORT,'CRM_PERSON_TRAIT_IMMUTABLE'); END;
