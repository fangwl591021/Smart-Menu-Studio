-- 0052 Travel UI contract completion.
-- Additive only; no backfill, seed data, fake bookings, or production data mutation.
PRAGMA foreign_keys = ON;

ALTER TABLE travel_itineraries
  ADD COLUMN region TEXT NOT NULL DEFAULT '' CHECK(length(region) <= 120);

ALTER TABLE travel_itineraries
  ADD COLUMN notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 4000);

ALTER TABLE travel_itineraries
  ADD COLUMN cover_asset_reference TEXT
    CHECK(cover_asset_reference IS NULL OR length(cover_asset_reference) BETWEEN 1 AND 120);

ALTER TABLE travel_departures
  ADD COLUMN min_group_size INTEGER NOT NULL DEFAULT 1
    CHECK(min_group_size BETWEEN 1 AND 10000);

CREATE TRIGGER IF NOT EXISTS travel_itinerary_cover_scope_insert
BEFORE INSERT ON travel_itineraries
WHEN NEW.cover_asset_reference IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM assets a
  WHERE a.id=NEW.cover_asset_reference
    AND a.workspace_id=NEW.workspace_id
    AND a.deleted_at IS NULL
    AND a.status='ready'
    AND a.content_type LIKE 'image/%'
    AND length(a.storage_key)>0
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_COVER_ASSET_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_itinerary_cover_scope_update
BEFORE UPDATE OF cover_asset_reference,workspace_id ON travel_itineraries
WHEN NEW.cover_asset_reference IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM assets a
  WHERE a.id=NEW.cover_asset_reference
    AND a.workspace_id=NEW.workspace_id
    AND a.deleted_at IS NULL
    AND a.status='ready'
    AND a.content_type LIKE 'image/%'
    AND length(a.storage_key)>0
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_COVER_ASSET_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_departure_group_size_insert
BEFORE INSERT ON travel_departures
WHEN NEW.min_group_size<1 OR NEW.min_group_size>NEW.seat_limit
BEGIN SELECT RAISE(ABORT,'TRAVEL_MIN_GROUP_SIZE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_departure_group_size_update
BEFORE UPDATE OF min_group_size,seat_limit ON travel_departures
WHEN NEW.min_group_size<1 OR NEW.min_group_size>NEW.seat_limit
BEGIN SELECT RAISE(ABORT,'TRAVEL_MIN_GROUP_SIZE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_departure_reserved_seat_guard
BEFORE UPDATE OF seat_limit ON travel_departures
WHEN NEW.seat_limit < (
  SELECT COALESCE(SUM(b.traveler_count),0)
  FROM travel_booking_extensions b
  WHERE b.workspace_id=OLD.workspace_id
    AND b.departure_id=OLD.id
    AND b.booking_status<>'CANCELLED'
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_SEAT_LIMIT_BELOW_RESERVED'); END;
