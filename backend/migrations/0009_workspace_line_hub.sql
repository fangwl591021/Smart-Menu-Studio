PRAGMA foreign_keys = ON;

-- =====================================================
-- LINE OA / Gateway 擴充
-- =====================================================

ALTER TABLE workspace_line_accounts ADD COLUMN line_login_channel_id TEXT;
ALTER TABLE workspace_line_accounts ADD COLUMN line_login_channel_secret TEXT;
ALTER TABLE workspace_line_accounts ADD COLUMN line_bot_channel_access_token TEXT;
ALTER TABLE workspace_line_accounts ADD COLUMN line_bot_channel_secret TEXT;
ALTER TABLE workspace_line_accounts ADD COLUMN webhook_token TEXT;
ALTER TABLE workspace_line_accounts ADD COLUMN webhook_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspace_line_accounts ADD COLUMN default_target_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_line_accounts_webhook_token
ON workspace_line_accounts(webhook_token)
WHERE webhook_token IS NOT NULL;

-- =====================================================
-- Webhook Targets
-- =====================================================

CREATE TABLE IF NOT EXISTS workspace_webhook_targets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'secondary',
  endpoint_url TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 0,
  can_reply INTEGER NOT NULL DEFAULT 0,
  forward_signature INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER NOT NULL DEFAULT 8000,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webhook_targets_workspace
ON workspace_webhook_targets(workspace_id, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_targets_position
ON workspace_webhook_targets(workspace_id, position);

-- =====================================================
-- Keyword Registry
-- =====================================================

CREATE TABLE IF NOT EXISTS workspace_keyword_routes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exact',
  target_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id)
    ON DELETE CASCADE,

  FOREIGN KEY (target_id)
    REFERENCES workspace_webhook_targets(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_keyword_routes_workspace
ON workspace_keyword_routes(workspace_id, enabled, priority);

CREATE INDEX IF NOT EXISTS idx_keyword_routes_target
ON workspace_keyword_routes(target_id);

-- 同 Workspace 完全相同的 normalized keyword 不允許重複啟用。
CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_unique_active
ON workspace_keyword_routes(workspace_id, keyword_normalized)
WHERE enabled = 1;