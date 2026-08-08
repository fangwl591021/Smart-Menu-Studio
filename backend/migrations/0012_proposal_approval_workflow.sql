PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  recommendation_id TEXT NOT NULL,
  rule_code TEXT NOT NULL,
  proposal_type TEXT NOT NULL
    CHECK (proposal_type IN (
      'postback-display-text',
      'https-upgrade-candidate',
      'duplicate-message-review',
      'duplicate-postback-review',
      'multi-page-structure-draft'
    )),
  source_entity_id TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed', 'approved', 'rejected', 'executed', 'stale')),

  title TEXT NOT NULL,
  summary TEXT,
  generated_by TEXT NOT NULL
    CHECK (generated_by IN ('rule', 'rule+ai')),
  proposal_snapshot TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,

  created_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  approved_by_user_id TEXT,
  rejected_by_user_id TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  executed_at TEXT,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
  FOREIGN KEY (approved_by_user_id) REFERENCES users(id),
  FOREIGN KEY (rejected_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_proposal_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('CREATED', 'REVIEWED', 'APPROVED', 'REJECTED', 'STALE_DETECTED', 'REGENERATED')),
  actor_user_id TEXT,
  from_status TEXT,
  to_status TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_id) REFERENCES ai_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_proposals_workspace_project_status
ON ai_proposals(workspace_id, project_id, status);

CREATE INDEX IF NOT EXISTS idx_ai_proposals_recommendation
ON ai_proposals(recommendation_id);

CREATE INDEX IF NOT EXISTS idx_ai_proposal_events_proposal_created
ON ai_proposal_events(proposal_id, created_at);
