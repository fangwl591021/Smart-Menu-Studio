-- LINE_OA_INTELLIGENCE ---------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_rich_menu_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_page_id TEXT,
  line_rich_menu_id TEXT NOT NULL,
  line_rich_menu_alias_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('smart_menu_publish', 'manual_link', 'imported')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unavailable', 'deleted')),
  last_synced_at TEXT,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, line_rich_menu_id)
);
CREATE INDEX IF NOT EXISTS idx_rich_menu_bindings_project ON workspace_rich_menu_bindings(workspace_id, project_id, status);

CREATE TABLE IF NOT EXISTS line_rich_menu_insight_daily (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  project_id TEXT,
  project_area_id TEXT,
  line_rich_menu_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  impression_count INTEGER,
  impression_unique_users INTEGER,
  click_count INTEGER,
  click_unique_users INTEGER,
  bounds_x INTEGER NOT NULL DEFAULT -1,
  bounds_y INTEGER NOT NULL DEFAULT -1,
  bounds_width INTEGER NOT NULL DEFAULT -1,
  bounds_height INTEGER NOT NULL DEFAULT -1,
  data_status TEXT NOT NULL CHECK (data_status IN ('available', 'privacy_suppressed', 'unavailable', 'mapping_unmatched')),
  source TEXT NOT NULL DEFAULT 'line_api' CHECK (source = 'line_api'),
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, line_rich_menu_id, metric_date, bounds_x, bounds_y, bounds_width, bounds_height)
);
CREATE INDEX IF NOT EXISTS idx_insight_project_date ON line_rich_menu_insight_daily(workspace_id, project_id, metric_date);

CREATE TABLE IF NOT EXISTS line_action_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  project_id TEXT,
  project_area_id TEXT,
  line_rich_menu_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('message', 'postback', 'richmenu_switch')),
  action_type TEXT NOT NULL CHECK (action_type IN ('message', 'postback', 'richmenuswitch')),
  action_fingerprint TEXT NOT NULL,
  source_user_hash TEXT,
  event_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_action_events_project_date ON line_action_events(workspace_id, project_id, event_at);

CREATE TABLE IF NOT EXISTS line_intelligence_daily (
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_area_id TEXT NOT NULL DEFAULT '',
  metric_date TEXT NOT NULL,
  impressions INTEGER,
  impression_unique_users INTEGER,
  clicks INTEGER,
  click_unique_users INTEGER,
  message_actions INTEGER NOT NULL DEFAULT 0,
  postback_actions INTEGER NOT NULL DEFAULT 0,
  switch_actions INTEGER NOT NULL DEFAULT 0,
  click_through_rate REAL,
  data_status TEXT NOT NULL DEFAULT 'unavailable' CHECK (data_status IN ('available', 'privacy_suppressed', 'unavailable', 'mapping_unmatched')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, project_id, project_area_id, metric_date),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_intelligence_daily_project_date ON line_intelligence_daily(workspace_id, project_id, metric_date);
