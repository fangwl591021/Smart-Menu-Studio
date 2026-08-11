-- 0045 Campaign tracked-link and append-only click engagement authority.
-- Additive only. No backfill, seed data, acquisition, referral, or economy mutation.
PRAGMA foreign_keys = ON;

ALTER TABLE campaign_executions ADD COLUMN tracking_base_url TEXT;
CREATE TRIGGER campaign_executions_tracking_base_immutable
BEFORE UPDATE OF tracking_base_url ON campaign_executions
WHEN NEW.tracking_base_url IS NOT OLD.tracking_base_url
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_EXECUTION_TRACKING_BASE_IMMUTABLE'); END;

CREATE TABLE campaign_tracked_links (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE CHECK(length(public_ref)=64),
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  content_version_no INTEGER NOT NULL CHECK(content_version_no > 0),
  token_name TEXT NOT NULL CHECK(length(token_name) BETWEEN 1 AND 40),
  destination_url TEXT NOT NULL CHECK(destination_url LIKE 'https://%'),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,campaign_id,content_version_no)
    REFERENCES campaign_content_versions(workspace_id,campaign_id,version_no) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,campaign_id,content_version_no,token_name)
);
CREATE INDEX idx_campaign_tracked_links_content
  ON campaign_tracked_links(workspace_id,campaign_id,content_version_no,token_name);

CREATE TRIGGER campaign_tracked_links_no_update BEFORE UPDATE ON campaign_tracked_links
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_TRACKED_LINK_IMMUTABLE'); END;
CREATE TRIGGER campaign_tracked_links_no_delete BEFORE DELETE ON campaign_tracked_links
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_TRACKED_LINK_IMMUTABLE'); END;

-- Durable opaque recipient binding. No identity or internal ID is placed in the URL.
CREATE TABLE campaign_click_contexts (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE CHECK(length(public_ref)=64),
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  tracked_link_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,execution_id) REFERENCES campaign_executions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,delivery_id) REFERENCES campaign_deliveries(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,tracked_link_id) REFERENCES campaign_tracked_links(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,delivery_id,tracked_link_id)
);
CREATE TRIGGER campaign_click_contexts_scope_guard BEFORE INSERT ON campaign_click_contexts
WHEN NOT EXISTS (
  SELECT 1 FROM campaign_deliveries d
  JOIN campaign_executions e ON e.workspace_id=d.workspace_id AND e.id=d.execution_id
  JOIN campaign_tracked_links l ON l.workspace_id=d.workspace_id AND l.id=NEW.tracked_link_id
  WHERE d.workspace_id=NEW.workspace_id AND d.id=NEW.delivery_id
    AND d.execution_id=NEW.execution_id AND d.campaign_id=NEW.campaign_id
    AND e.campaign_id=NEW.campaign_id AND e.content_version_no=l.content_version_no
    AND l.campaign_id=NEW.campaign_id
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CLICK_CONTEXT_SCOPE_INVALID'); END;
CREATE TRIGGER campaign_click_contexts_no_update BEFORE UPDATE ON campaign_click_contexts
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CLICK_CONTEXT_IMMUTABLE'); END;
CREATE TRIGGER campaign_click_contexts_no_delete BEFORE DELETE ON campaign_click_contexts
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CLICK_CONTEXT_IMMUTABLE'); END;

CREATE TABLE campaign_click_events (
  id TEXT PRIMARY KEY,
  cursor_ref TEXT NOT NULL UNIQUE CHECK(length(cursor_ref)=64),
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  tracked_link_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  visitor_kind TEXT NOT NULL CHECK(visitor_kind IN ('ANONYMOUS','KNOWN_CRM_PERSON')),
  crm_person_id TEXT,
  execution_id TEXT,
  delivery_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,tracked_link_id) REFERENCES campaign_tracked_links(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,execution_id) REFERENCES campaign_executions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,delivery_id) REFERENCES campaign_deliveries(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE RESTRICT,
  CHECK(
    (visitor_kind='ANONYMOUS' AND crm_person_id IS NULL AND execution_id IS NULL AND delivery_id IS NULL)
    OR
    (visitor_kind='KNOWN_CRM_PERSON' AND crm_person_id IS NOT NULL AND execution_id IS NOT NULL AND delivery_id IS NOT NULL)
  )
);
CREATE INDEX idx_campaign_click_events_history
  ON campaign_click_events(workspace_id,campaign_id,occurred_at DESC,cursor_ref DESC);
CREATE INDEX idx_campaign_click_events_link
  ON campaign_click_events(workspace_id,campaign_id,tracked_link_id,occurred_at DESC);
CREATE TRIGGER campaign_click_events_scope_guard BEFORE INSERT ON campaign_click_events
WHEN NOT EXISTS (
  SELECT 1 FROM campaign_tracked_links l
  WHERE l.workspace_id=NEW.workspace_id AND l.campaign_id=NEW.campaign_id AND l.id=NEW.tracked_link_id
) OR (
  NEW.visitor_kind='KNOWN_CRM_PERSON' AND NOT EXISTS (
    SELECT 1 FROM campaign_deliveries d
    JOIN campaign_executions e ON e.workspace_id=d.workspace_id AND e.id=d.execution_id
    WHERE d.workspace_id=NEW.workspace_id AND d.id=NEW.delivery_id
      AND d.execution_id=NEW.execution_id AND d.campaign_id=NEW.campaign_id
      AND d.crm_person_id=NEW.crm_person_id AND e.campaign_id=NEW.campaign_id
  )
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CLICK_EVENT_SCOPE_INVALID'); END;
CREATE TRIGGER campaign_click_events_no_update BEFORE UPDATE ON campaign_click_events
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CLICK_EVENT_APPEND_ONLY'); END;
CREATE TRIGGER campaign_click_events_no_delete BEFORE DELETE ON campaign_click_events
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_CLICK_EVENT_APPEND_ONLY'); END;
