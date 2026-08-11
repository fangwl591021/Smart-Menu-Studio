PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_module_entitlements (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  module_key TEXT NOT NULL CHECK (module_key IN (
    'CORE_MENU',
    'CRM',
    'CAMPAIGN',
    'COMMERCE',
    'TRAVEL',
    'DEALER_COMMISSION',
    'POINTS_REWARDS',
    'AI'
  )),
  status TEXT NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
  granted_by_user_id TEXT,
  enabled_at TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_module_entitlements_workspace_status
ON workspace_module_entitlements(workspace_id, status);

CREATE TABLE IF NOT EXISTS workspace_module_entitlement_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  module_key TEXT NOT NULL CHECK (module_key IN (
    'CORE_MENU',
    'CRM',
    'CAMPAIGN',
    'COMMERCE',
    'TRAVEL',
    'DEALER_COMMISSION',
    'POINTS_REWARDS',
    'AI'
  )),
  event_type TEXT NOT NULL CHECK (event_type IN ('MODULE_ENABLED', 'MODULE_DISABLED')),
  from_status TEXT NOT NULL CHECK (from_status IN ('LEGACY_ENABLED', 'ENABLED', 'DISABLED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('ENABLED', 'DISABLED')),
  actor_user_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_workspace_module_entitlement_events_workspace_time
ON workspace_module_entitlement_events(workspace_id, occurred_at DESC);
