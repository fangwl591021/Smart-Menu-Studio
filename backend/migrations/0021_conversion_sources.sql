-- 4F-4B conversion source expansion (additive only)
ALTER TABLE line_conversion_events ADD COLUMN conversion_source TEXT;
CREATE INDEX IF NOT EXISTS idx_conversion_source_health ON line_conversion_events(workspace_id, conversion_source, occurred_at);
