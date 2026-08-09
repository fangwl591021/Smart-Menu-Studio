-- 4F-4A tracked URI attribution (additive only)
CREATE TABLE IF NOT EXISTS tracked_uri_attributions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_area_id TEXT NOT NULL,
  attribution_token_hash TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  occurred_at TEXT,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','clicked')),
  conversion_event_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, attribution_token_hash)
);
CREATE INDEX IF NOT EXISTS idx_tracked_uri_workspace_time ON tracked_uri_attributions(workspace_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tracked_uri_area_time ON tracked_uri_attributions(project_area_id, occurred_at);
