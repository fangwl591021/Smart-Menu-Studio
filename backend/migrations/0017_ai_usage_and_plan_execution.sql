PRAGMA foreign_keys = ON;

-- AI_USAGE ---------------------------------------------------------------
-- Prices and costs are integer USD micros. No production prices are seeded.
CREATE TABLE IF NOT EXISTS ai_pricing_versions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  version TEXT NOT NULL,
  input_price_micros_per_million INTEGER NOT NULL DEFAULT 0 CHECK (input_price_micros_per_million >= 0),
  output_price_micros_per_million INTEGER NOT NULL DEFAULT 0 CHECK (output_price_micros_per_million >= 0),
  cached_input_price_micros_per_million INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_price_micros_per_million >= 0),
  billable_input_price_micros_per_million INTEGER NOT NULL DEFAULT 0 CHECK (billable_input_price_micros_per_million >= 0),
  billable_output_price_micros_per_million INTEGER NOT NULL DEFAULT 0 CHECK (billable_output_price_micros_per_million >= 0),
  billable_cached_input_price_micros_per_million INTEGER NOT NULL DEFAULT 0 CHECK (billable_cached_input_price_micros_per_million >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, model, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_pricing_active
ON ai_pricing_versions(provider, model, enabled, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  feature_code TEXT NOT NULL CHECK (feature_code IN (
    'recommendation_explanation', 'proposal_explanation', 'rich_menu_image_analysis',
    'guide_explanation', 'operation_plan_assist', 'line_oa_intelligence',
    'content_generation', 'unknown_ai_feature'
  )),
  operation_code TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'fallback', 'cached')),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  provider_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (provider_cost_micros >= 0),
  billable_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (billable_cost_micros >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  input_unit_price_snapshot TEXT,
  output_unit_price_snapshot TEXT,
  cached_unit_price_snapshot TEXT,
  billable_input_unit_price_snapshot TEXT,
  billable_output_unit_price_snapshot TEXT,
  billable_cached_unit_price_snapshot TEXT,
  pricing_version TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_created
ON ai_usage_ledger(workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_user_created
ON ai_usage_ledger(workspace_id, user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_created
ON ai_usage_ledger(feature_code, created_at);

-- PLAN_EXECUTION ---------------------------------------------------------
-- Widen Plan lifecycle while preserving every existing Plan row.
CREATE TABLE ai_operation_plan_steps_0016_data AS
SELECT * FROM ai_operation_plan_steps;

CREATE TABLE ai_operation_plan_events_0016_data AS
SELECT * FROM ai_operation_plan_events;

DROP TABLE ai_operation_plan_events;
DROP TABLE ai_operation_plan_steps;

ALTER TABLE ai_operation_plans RENAME TO ai_operation_plans_0016;

CREATE TABLE ai_operation_plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'reviewed', 'approved', 'executing', 'executed', 'failed',
    'rolled_back', 'partially_compensated', 'stale', 'cancelled'
  )),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
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

INSERT INTO ai_operation_plans (
  id, workspace_id, project_id, title, status, risk_level, policy_version,
  source_fingerprint, preflight_json, created_by_user_id, reviewed_by_user_id,
  approved_by_user_id, cancelled_by_user_id, created_at, updated_at,
  reviewed_at, approved_at, cancelled_at
)
SELECT
  id, workspace_id, project_id, title, status, risk_level, policy_version,
  source_fingerprint, preflight_json, created_by_user_id, reviewed_by_user_id,
  approved_by_user_id, cancelled_by_user_id, created_at, updated_at,
  reviewed_at, approved_at, cancelled_at
FROM ai_operation_plans_0016;

DROP TABLE ai_operation_plans_0016;

CREATE INDEX idx_ai_operation_plans_workspace_project_status
ON ai_operation_plans(workspace_id, project_id, status);

CREATE TABLE ai_operation_plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  proposal_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL CHECK (proposal_type IN ('postback-display-text', 'https-upgrade-candidate')),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('SET_PROJECT_AREA_DISPLAY_TEXT', 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS')),
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

INSERT INTO ai_operation_plan_steps
SELECT * FROM ai_operation_plan_steps_0016_data;

DROP TABLE ai_operation_plan_steps_0016_data;

CREATE INDEX idx_ai_operation_plan_steps_plan_sequence
ON ai_operation_plan_steps(plan_id, sequence);

CREATE INDEX idx_ai_operation_plan_steps_proposal
ON ai_operation_plan_steps(proposal_id);

-- Widen Plan event types while preserving every existing event row.


CREATE TABLE ai_operation_plan_events (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'PLAN_CREATED', 'PLAN_REVIEWED', 'PLAN_APPROVED', 'PLAN_STALE', 'PLAN_CANCELLED',
    'PLAN_EXECUTION_STARTED', 'PLAN_STEP_STARTED', 'PLAN_STEP_SUCCEEDED',
    'PLAN_STEP_FAILED', 'PLAN_COMPENSATION_STARTED',
    'PLAN_STEP_ROLLBACK_SUCCEEDED', 'PLAN_STEP_ROLLBACK_FAILED',
    'PLAN_EXECUTED', 'PLAN_FAILED', 'PLAN_ROLLED_BACK', 'PLAN_PARTIALLY_COMPENSATED'
  )),
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

INSERT INTO ai_operation_plan_events (
  id, plan_id, workspace_id, project_id, event_type, actor_user_id,
  from_status, to_status, metadata_json, created_at
)
SELECT
  id, plan_id, workspace_id, project_id, event_type, actor_user_id,
  from_status, to_status, metadata_json, created_at
FROM ai_operation_plan_events_0016_data;

DROP TABLE ai_operation_plan_events_0016_data;

CREATE INDEX idx_ai_operation_plan_events_plan_created
ON ai_operation_plan_events(plan_id, created_at);

CREATE TABLE IF NOT EXISTS ai_operation_plan_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'executing', 'executed', 'failed', 'rolled_back', 'partially_compensated'
  )),
  actor_user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failure_step_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES ai_operation_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  FOREIGN KEY (failure_step_id) REFERENCES ai_operation_plan_steps(id)
);

CREATE TABLE IF NOT EXISTS ai_operation_plan_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  plan_step_id TEXT NOT NULL,
  operation_log_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'executing', 'succeeded', 'failed', 'rollback_succeeded', 'rollback_failed'
  )),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  started_at TEXT,
  completed_at TEXT,
  rollback_operation_log_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (run_id) REFERENCES ai_operation_plan_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_step_id) REFERENCES ai_operation_plan_steps(id) ON DELETE CASCADE,
  FOREIGN KEY (operation_log_id) REFERENCES ai_operation_logs(id),
  FOREIGN KEY (rollback_operation_log_id) REFERENCES ai_operation_logs(id),
  UNIQUE (run_id, plan_step_id),
  UNIQUE (run_id, sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_operation_plan_one_active_run
ON ai_operation_plan_runs(plan_id)
WHERE status = 'executing';

CREATE INDEX IF NOT EXISTS idx_ai_operation_plan_runs_plan_created
ON ai_operation_plan_runs(plan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_operation_plan_run_steps_run_sequence
ON ai_operation_plan_run_steps(run_id, sequence);
