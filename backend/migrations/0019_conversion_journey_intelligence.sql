-- 4F-3 Conversion & Journey Intelligence (additive only)
CREATE TABLE IF NOT EXISTS workspace_conversion_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_used_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  UNIQUE(workspace_id, key_prefix),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversion_key_lookup ON workspace_conversion_api_keys(key_prefix,status);

CREATE TABLE IF NOT EXISTS line_journey_events (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, line_account_id TEXT,
  journey_session_id TEXT NOT NULL, project_id TEXT, project_area_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('rich_menu_click','message_action','postback_action','richmenu_switch','keyword_match','webhook_route','webhook_success','webhook_failure','conversion')),
  event_source TEXT NOT NULL CHECK (event_source IN ('line_insight','line_webhook','gateway','downstream','tenant_api','system')),
  route_id TEXT, target_id TEXT, event_key TEXT NOT NULL, status TEXT, latency_ms INTEGER,
  occurred_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journey_event_scope_time ON line_journey_events(workspace_id,journey_session_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_journey_event_project_time ON line_journey_events(workspace_id,project_id,project_area_id,occurred_at);

CREATE TABLE IF NOT EXISTS line_conversion_events (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, line_account_id TEXT, conversion_key_id TEXT,
  external_event_id TEXT NOT NULL, conversion_type TEXT NOT NULL,
  journey_session_id TEXT, project_id TEXT, project_area_id TEXT,
  attributed_project_id TEXT, attributed_project_area_id TEXT,
  attribution_model TEXT NOT NULL DEFAULT 'last_observed_touch', value_minor INTEGER, currency TEXT,
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('matched','unmatched')),
  occurred_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_conversion_project_time ON line_conversion_events(workspace_id,attributed_project_id,attributed_project_area_id,occurred_at);

CREATE TABLE IF NOT EXISTS line_journey_daily (
  workspace_id TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', project_area_id TEXT NOT NULL DEFAULT '', metric_date TEXT NOT NULL,
  observed_sessions INTEGER NOT NULL DEFAULT 0, message_actions INTEGER NOT NULL DEFAULT 0, postback_actions INTEGER NOT NULL DEFAULT 0, switch_actions INTEGER NOT NULL DEFAULT 0, keyword_matches INTEGER NOT NULL DEFAULT 0, webhook_routes INTEGER NOT NULL DEFAULT 0, webhook_successes INTEGER NOT NULL DEFAULT 0, webhook_failures INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0, conversion_value_minor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id,project_id,project_area_id,metric_date)
);
CREATE INDEX IF NOT EXISTS idx_journey_daily_project_date ON line_journey_daily(workspace_id,project_id,metric_date);
