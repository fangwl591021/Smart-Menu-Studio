PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_operation_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operation_type TEXT NOT NULL
    CHECK (operation_type IN ('SET_PROJECT_AREA_DISPLAY_TEXT')),
  target_entity_type TEXT NOT NULL
    CHECK (target_entity_type IN ('project_area')),
  target_entity_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('started', 'succeeded', 'failed')),
  before_snapshot TEXT NOT NULL,
  after_snapshot TEXT,
  actor_user_id TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_id) REFERENCES ai_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_operation_logs_workspace_proposal
ON ai_operation_logs(workspace_id, proposal_id);

CREATE INDEX IF NOT EXISTS idx_ai_operation_logs_project_created
ON ai_operation_logs(project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_operation_logs_status_created
ON ai_operation_logs(status, created_at);
