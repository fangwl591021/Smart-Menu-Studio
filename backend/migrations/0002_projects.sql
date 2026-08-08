PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  template_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',

  asset_id TEXT,
  page_count INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,

  FOREIGN KEY (template_id)
    REFERENCES templates(id)
    ON DELETE SET NULL,

  FOREIGN KEY (asset_id)
    REFERENCES assets(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace
ON projects(workspace_id);

CREATE INDEX IF NOT EXISTS idx_projects_template
ON projects(template_id);

CREATE TABLE IF NOT EXISTS project_areas (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
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

  FOREIGN KEY (project_id)
    REFERENCES projects(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_areas_project
ON project_areas(project_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_areas_order
ON project_areas(project_id, area_index);