PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_https_probe_results (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_area_id TEXT NOT NULL,
  original_url_fingerprint TEXT NOT NULL,
  candidate_url_sanitized TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SAFE', 'UNSAFE', 'UNKNOWN')),
  reason_code TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  http_status INTEGER,
  final_host TEXT,
  redirect_count INTEGER NOT NULL DEFAULT 0 CHECK (redirect_count >= 0),
  probed_by_user_id TEXT NOT NULL,
  probed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_id) REFERENCES ai_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (probed_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_https_probes_workspace_proposal_created
ON ai_https_probe_results(workspace_id, proposal_id, probed_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_https_probes_target_fingerprint
ON ai_https_probe_results(workspace_id, project_id, project_area_id, original_url_fingerprint);

-- SQLite cannot widen a CHECK constraint in place. Rebuild only the audit table,
-- preserving every existing row and all 4D-2 rollback linkage.
ALTER TABLE ai_operation_logs RENAME TO ai_operation_logs_0014;

CREATE TABLE ai_operation_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operation_type TEXT NOT NULL
    CHECK (operation_type IN (
      'SET_PROJECT_AREA_DISPLAY_TEXT',
      'UPGRADE_PROJECT_AREA_URI_TO_HTTPS'
    )),
  target_entity_type TEXT NOT NULL CHECK (target_entity_type IN ('project_area')),
  target_entity_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  before_snapshot TEXT NOT NULL,
  after_snapshot TEXT,
  actor_user_id TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  reverts_operation_id TEXT,
  root_operation_id TEXT,
  probe_id TEXT,
  before_value_fingerprint TEXT,
  after_value_fingerprint TEXT,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_id) REFERENCES ai_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  FOREIGN KEY (probe_id) REFERENCES ai_https_probe_results(id)
);

INSERT INTO ai_operation_logs (
  id, workspace_id, proposal_id, project_id, operation_type,
  target_entity_type, target_entity_id, status, before_snapshot,
  after_snapshot, actor_user_id, error_code, error_message, created_at,
  completed_at, reverts_operation_id, root_operation_id
)
SELECT
  id, workspace_id, proposal_id, project_id, operation_type,
  target_entity_type, target_entity_id, status, before_snapshot,
  after_snapshot, actor_user_id, error_code, error_message, created_at,
  completed_at, reverts_operation_id, root_operation_id
FROM ai_operation_logs_0014;

DROP TABLE ai_operation_logs_0014;

CREATE INDEX idx_ai_operation_logs_workspace_proposal
ON ai_operation_logs(workspace_id, proposal_id);

CREATE INDEX idx_ai_operation_logs_project_created
ON ai_operation_logs(project_id, created_at);

CREATE INDEX idx_ai_operation_logs_status_created
ON ai_operation_logs(status, created_at);

CREATE INDEX idx_ai_operation_logs_reverts_operation
ON ai_operation_logs(reverts_operation_id);

CREATE INDEX idx_ai_operation_logs_root_created
ON ai_operation_logs(root_operation_id, created_at);

CREATE INDEX idx_ai_operation_logs_probe
ON ai_operation_logs(probe_id);

CREATE UNIQUE INDEX idx_ai_operation_logs_one_successful_rollback
ON ai_operation_logs(reverts_operation_id)
WHERE reverts_operation_id IS NOT NULL AND status = 'succeeded';
