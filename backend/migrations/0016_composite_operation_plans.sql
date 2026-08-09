PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_operation_plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed', 'approved', 'stale', 'cancelled')),
  risk_level TEXT NOT NULL
    CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  policy_version TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  preflight_json TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  approved_by_user_id TEXT,
  cancelled_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  approved_at TEXT,
  cancelled_at TEXT,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
  FOREIGN KEY (approved_by_user_id) REFERENCES users(id),
  FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_operation_plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  proposal_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL
    CHECK (proposal_type IN ('postback-display-text', 'https-upgrade-candidate')),
  operation_type TEXT NOT NULL
    CHECK (operation_type IN ('SET_PROJECT_AREA_DISPLAY_TEXT', 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM')),
  target_entity_type TEXT NOT NULL CHECK (target_entity_type = 'project_area'),
  target_entity_id TEXT NOT NULL,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  executable INTEGER NOT NULL DEFAULT 1 CHECK (executable IN (0, 1)),
  rollback_supported INTEGER NOT NULL DEFAULT 1 CHECK (rollback_supported IN (0, 1)),
  requirements_json TEXT NOT NULL,
  step_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (plan_id) REFERENCES ai_operation_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_id) REFERENCES ai_proposals(id) ON DELETE RESTRICT,
  UNIQUE (plan_id, proposal_id),
  UNIQUE (plan_id, sequence)
);

CREATE TABLE IF NOT EXISTS ai_operation_plan_events (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('PLAN_CREATED', 'PLAN_REVIEWED', 'PLAN_APPROVED', 'PLAN_STALE', 'PLAN_CANCELLED')),
  actor_user_id TEXT,
  from_status TEXT,
  to_status TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (plan_id) REFERENCES ai_operation_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_operation_plans_workspace_project_status
ON ai_operation_plans(workspace_id, project_id, status);

CREATE INDEX IF NOT EXISTS idx_ai_operation_plan_steps_plan_sequence
ON ai_operation_plan_steps(plan_id, sequence);

CREATE INDEX IF NOT EXISTS idx_ai_operation_plan_steps_proposal
ON ai_operation_plan_steps(proposal_id);

CREATE INDEX IF NOT EXISTS idx_ai_operation_plan_events_plan_created
ON ai_operation_plan_events(plan_id, created_at);
