-- 0054 Travel operational milestones.
-- Additive only; no backfill, seed data, fake events, or production data mutation.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS travel_operation_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  departure_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('OPERATION_CONFIRMED','SERVICE_COMPLETED')),
  actor_user_id TEXT,
  reason_code TEXT CHECK(reason_code IS NULL OR length(reason_code) <= 80),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,departure_id) REFERENCES travel_departures(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,departure_id,event_type),
  UNIQUE(workspace_id,id)
);

CREATE INDEX IF NOT EXISTS idx_travel_operation_events_departure_time
  ON travel_operation_events(workspace_id,departure_id,occurred_at,id);

CREATE TRIGGER IF NOT EXISTS travel_operation_event_scope_insert
BEFORE INSERT ON travel_operation_events
WHEN NOT EXISTS (
  SELECT 1 FROM travel_departures d
  WHERE d.id=NEW.departure_id AND d.workspace_id=NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_OPERATION_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_operation_events_no_update
BEFORE UPDATE ON travel_operation_events
BEGIN SELECT RAISE(ABORT,'TRAVEL_OPERATION_EVENTS_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS travel_operation_events_no_delete
BEFORE DELETE ON travel_operation_events
BEGIN SELECT RAISE(ABORT,'TRAVEL_OPERATION_EVENTS_APPEND_ONLY'); END;
