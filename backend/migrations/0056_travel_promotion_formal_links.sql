-- 0056 Operator-controlled links from approved promotion versions to formal Travel authority.
-- Additive only; no backfill, seed data, Travel/Commerce mutation, or AI execution.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS travel_promotion_formal_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  promotion_document_id TEXT NOT NULL,
  promotion_version_no INTEGER NOT NULL CHECK(promotion_version_no > 0),
  itinerary_id TEXT NOT NULL,
  departure_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REMOVED')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_by_user_id TEXT,
  removed_at TEXT,
  FOREIGN KEY(workspace_id,promotion_document_id,promotion_version_no)
    REFERENCES travel_promotion_versions(workspace_id,promotion_document_id,version_no) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,itinerary_id)
    REFERENCES travel_itineraries(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,departure_id)
    REFERENCES travel_departures(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  CHECK((status='ACTIVE' AND removed_by_user_id IS NULL AND removed_at IS NULL)
    OR (status='REMOVED' AND removed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_travel_promotion_formal_links_active
  ON travel_promotion_formal_links(workspace_id,promotion_document_id)
  WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS idx_travel_promotion_formal_links_target
  ON travel_promotion_formal_links(workspace_id,itinerary_id,departure_id,status);

CREATE TRIGGER IF NOT EXISTS travel_promotion_formal_links_scope_insert
BEFORE INSERT ON travel_promotion_formal_links
WHEN NEW.status<>'ACTIVE'
  OR NOT EXISTS (
    SELECT 1
    FROM travel_promotion_documents d
    JOIN travel_promotion_versions v
      ON v.workspace_id=d.workspace_id
      AND v.promotion_document_id=d.id
      AND v.version_no=d.active_version_no
      AND v.version_status='APPROVED'
    WHERE d.workspace_id=NEW.workspace_id
      AND d.id=NEW.promotion_document_id
      AND d.status='ACTIVE'
      AND d.active_version_no=NEW.promotion_version_no
  )
  OR NOT EXISTS (
    SELECT 1 FROM travel_itineraries i
    WHERE i.workspace_id=NEW.workspace_id AND i.id=NEW.itinerary_id
  )
  OR (NEW.departure_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM travel_departures dep
    WHERE dep.workspace_id=NEW.workspace_id
      AND dep.id=NEW.departure_id
      AND dep.itinerary_id=NEW.itinerary_id
  ))
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_FORMAL_LINK_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_formal_links_update_guard
BEFORE UPDATE ON travel_promotion_formal_links
WHEN OLD.status<>'ACTIVE'
  OR NEW.status<>'REMOVED'
  OR NEW.id IS NOT OLD.id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.promotion_document_id IS NOT OLD.promotion_document_id
  OR NEW.promotion_version_no IS NOT OLD.promotion_version_no
  OR NEW.itinerary_id IS NOT OLD.itinerary_id
  OR NEW.departure_id IS NOT OLD.departure_id
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.removed_at IS NULL
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_FORMAL_LINK_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_promotion_formal_links_no_delete
BEFORE DELETE ON travel_promotion_formal_links
BEGIN SELECT RAISE(ABORT,'TRAVEL_PROMOTION_FORMAL_LINK_IMMUTABLE'); END;
