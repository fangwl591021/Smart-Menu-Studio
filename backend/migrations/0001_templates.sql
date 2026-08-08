PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  content_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace
ON assets(workspace_id);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT '待分類',
  status TEXT NOT NULL DEFAULT 'draft',
  asset_id TEXT,
  area_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 1,
  ai_provider TEXT,
  ai_model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,

  FOREIGN KEY (asset_id)
    REFERENCES assets(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_workspace
ON templates(workspace_id);

CREATE INDEX IF NOT EXISTS idx_templates_status
ON templates(status);

CREATE TABLE IF NOT EXISTS template_areas (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  area_index INTEGER NOT NULL,
  label TEXT NOT NULL,

  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,

  action_type TEXT NOT NULL DEFAULT 'none',
  action_uri TEXT,
  action_text TEXT,
  action_data TEXT,
  action_display_text TEXT,
  target_page_id TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (template_id)
    REFERENCES templates(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_template_areas_template
ON template_areas(template_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_template_areas_order
ON template_areas(template_id, area_index);