-- 0051 Travel itinerary, departure, booking, traveler, payment schedule, and event foundation.
-- Additive only; no backfill, seed data, fake bookings, or production data mutation.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS travel_itineraries (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 4000),
  duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 365),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','REJECTED','ARCHIVED')),
  seller_dealer_id TEXT,
  created_by_user_id TEXT,
  reviewed_by_user_id TEXT,
  review_note TEXT NOT NULL DEFAULT '' CHECK(length(review_note) <= 1000),
  submitted_at TEXT,
  published_at TEXT,
  rejected_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(seller_dealer_id) REFERENCES line_oa_dealers(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS idx_travel_itineraries_list
  ON travel_itineraries(workspace_id,status,updated_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS travel_departures (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  itinerary_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','OPEN','CLOSED','SOLD_OUT','CANCELLED','ARCHIVED')),
  departure_date TEXT NOT NULL,
  return_date TEXT NOT NULL,
  booking_opens_at TEXT NOT NULL,
  booking_closes_at TEXT NOT NULL,
  seat_limit INTEGER NOT NULL CHECK(seat_limit BETWEEN 1 AND 10000),
  price_amount_minor INTEGER NOT NULL CHECK(price_amount_minor BETWEEN 1 AND 100000000),
  currency_code TEXT NOT NULL DEFAULT 'TWD' CHECK(currency_code='TWD'),
  payment_schedule_type TEXT NOT NULL DEFAULT 'FULL'
    CHECK(payment_schedule_type IN ('FULL','DEPOSIT_BALANCE')),
  deposit_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(deposit_amount_minor >= 0),
  deposit_due_at TEXT,
  balance_due_at TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY(workspace_id,itinerary_id) REFERENCES travel_itineraries(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  CHECK(return_date >= departure_date),
  CHECK(datetime(booking_closes_at) > datetime(booking_opens_at)),
  CHECK(
    (payment_schedule_type='FULL' AND deposit_amount_minor=0 AND deposit_due_at IS NULL AND balance_due_at IS NULL)
    OR
    (payment_schedule_type='DEPOSIT_BALANCE' AND deposit_amount_minor>0
      AND deposit_amount_minor<price_amount_minor AND deposit_due_at IS NOT NULL AND balance_due_at IS NOT NULL
      AND datetime(balance_due_at)>=datetime(deposit_due_at))
  )
);
CREATE INDEX IF NOT EXISTS idx_travel_departures_list
  ON travel_departures(workspace_id,itinerary_id,status,departure_date,id);

CREATE TABLE IF NOT EXISTS travel_booking_extensions (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  departure_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  line_member_id TEXT NOT NULL,
  customer_crm_person_id TEXT NOT NULL,
  seller_dealer_id TEXT,
  booking_status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK(booking_status IN ('PENDING_PAYMENT','DEPOSIT_PAID','CONFIRMED','BALANCE_DUE','FULLY_PAID','CANCELLED')),
  traveler_count INTEGER NOT NULL CHECK(traveler_count BETWEEN 1 AND 100),
  payment_schedule_type_snapshot TEXT NOT NULL
    CHECK(payment_schedule_type_snapshot IN ('FULL','DEPOSIT_BALANCE')),
  total_amount_minor_snapshot INTEGER NOT NULL CHECK(total_amount_minor_snapshot > 0),
  currency_code_snapshot TEXT NOT NULL DEFAULT 'TWD' CHECK(currency_code_snapshot='TWD'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT,
  FOREIGN KEY(workspace_id,order_id) REFERENCES commerce_orders(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,departure_id) REFERENCES travel_departures(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(line_member_id) REFERENCES line_oa_members(id) ON DELETE RESTRICT,
  FOREIGN KEY(customer_crm_person_id) REFERENCES crm_people(id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_dealer_id) REFERENCES line_oa_dealers(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,order_id)
);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_departure
  ON travel_booking_extensions(workspace_id,departure_id,booking_status,created_at,id);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_member
  ON travel_booking_extensions(workspace_id,line_account_id,line_member_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS travel_booking_travelers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no BETWEEN 1 AND 100),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  traveler_type TEXT NOT NULL DEFAULT 'ADULT' CHECK(traveler_type IN ('ADULT','CHILD','INFANT')),
  phone TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 40),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,booking_id) REFERENCES travel_booking_extensions(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,booking_id,sequence_no)
);

CREATE TABLE IF NOT EXISTS travel_payment_schedules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  payment_leg TEXT NOT NULL CHECK(payment_leg IN ('FULL','DEPOSIT','BALANCE')),
  amount_minor_snapshot INTEGER NOT NULL CHECK(amount_minor_snapshot > 0),
  currency_code_snapshot TEXT NOT NULL DEFAULT 'TWD' CHECK(currency_code_snapshot='TWD'),
  due_at_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,booking_id) REFERENCES travel_booking_extensions(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,booking_id,payment_leg)
);

CREATE TABLE IF NOT EXISTS travel_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  itinerary_id TEXT,
  departure_id TEXT,
  booking_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'ITINERARY_CREATED','ITINERARY_SUBMITTED','ITINERARY_PUBLISHED','ITINERARY_REJECTED','ITINERARY_ARCHIVED',
    'DEPARTURE_CREATED','DEPARTURE_OPENED','DEPARTURE_CLOSED','DEPARTURE_CANCELLED','DEPARTURE_ARCHIVED',
    'BOOKING_CREATED','DEPOSIT_PAID','BALANCE_PAID','FULL_PAYMENT_PAID','BOOKING_CONFIRMED','BOOKING_CANCELLED'
  )),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('TENANT_USER','MEMBER','SYSTEM')),
  actor_user_id TEXT,
  dedupe_key TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id,itinerary_id) REFERENCES travel_itineraries(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,departure_id) REFERENCES travel_departures(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,booking_id) REFERENCES travel_booking_extensions(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,dedupe_key),
  CHECK(itinerary_id IS NOT NULL OR departure_id IS NOT NULL OR booking_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_travel_events_time
  ON travel_events(workspace_id,occurred_at DESC,id DESC);

CREATE TRIGGER IF NOT EXISTS travel_itinerary_seller_scope_insert
BEFORE INSERT ON travel_itineraries
WHEN NEW.seller_dealer_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM line_oa_dealers d
  WHERE d.id=NEW.seller_dealer_id AND d.workspace_id=NEW.workspace_id AND d.status='ACTIVE'
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_SELLER_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_booking_identity_scope_insert
BEFORE INSERT ON travel_booking_extensions
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_line_accounts a
  WHERE a.id=NEW.line_account_id AND a.workspace_id=NEW.workspace_id
) OR NOT EXISTS (
  SELECT 1 FROM line_oa_members m
  WHERE m.id=NEW.line_member_id AND m.workspace_id=NEW.workspace_id AND m.line_account_id=NEW.line_account_id
) OR NOT EXISTS (
  SELECT 1 FROM crm_person_identity_links l
  WHERE l.workspace_id=NEW.workspace_id AND l.crm_person_id=NEW.customer_crm_person_id
    AND l.line_account_id=NEW.line_account_id AND l.line_member_id=NEW.line_member_id
    AND l.identity_type='LINE_MEMBER' AND l.verification_status='VERIFIED'
) OR (NEW.seller_dealer_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM line_oa_dealers d
  WHERE d.id=NEW.seller_dealer_id AND d.workspace_id=NEW.workspace_id AND d.status='ACTIVE'
))
BEGIN SELECT RAISE(ABORT,'TRAVEL_BOOKING_IDENTITY_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS travel_booking_capacity_guard
BEFORE INSERT ON travel_booking_extensions
WHEN NEW.booking_status<>'CANCELLED' AND (
  SELECT COALESCE(SUM(traveler_count),0)
  FROM travel_booking_extensions
  WHERE workspace_id=NEW.workspace_id AND departure_id=NEW.departure_id AND booking_status<>'CANCELLED'
) + NEW.traveler_count > (
  SELECT seat_limit FROM travel_departures
  WHERE workspace_id=NEW.workspace_id AND id=NEW.departure_id
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_DEPARTURE_CAPACITY_EXCEEDED'); END;

CREATE TRIGGER IF NOT EXISTS travel_booking_availability_guard
BEFORE INSERT ON travel_booking_extensions
WHEN NOT EXISTS (
  SELECT 1
  FROM travel_departures d
  JOIN travel_itineraries i ON i.workspace_id=d.workspace_id AND i.id=d.itinerary_id
  WHERE d.workspace_id=NEW.workspace_id AND d.id=NEW.departure_id
    AND d.status='OPEN' AND i.status='PUBLISHED'
    AND datetime('now')>=datetime(d.booking_opens_at)
    AND datetime('now')<=datetime(d.booking_closes_at)
)
BEGIN SELECT RAISE(ABORT,'TRAVEL_BOOKING_NOT_AVAILABLE'); END;

CREATE TRIGGER IF NOT EXISTS travel_travelers_no_update BEFORE UPDATE ON travel_booking_travelers
BEGIN SELECT RAISE(ABORT,'TRAVEL_TRAVELER_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS travel_travelers_no_delete BEFORE DELETE ON travel_booking_travelers
BEGIN SELECT RAISE(ABORT,'TRAVEL_TRAVELER_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS travel_payment_schedules_no_update BEFORE UPDATE ON travel_payment_schedules
BEGIN SELECT RAISE(ABORT,'TRAVEL_PAYMENT_SCHEDULE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS travel_payment_schedules_no_delete BEFORE DELETE ON travel_payment_schedules
BEGIN SELECT RAISE(ABORT,'TRAVEL_PAYMENT_SCHEDULE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS travel_events_no_update BEFORE UPDATE ON travel_events
BEGIN SELECT RAISE(ABORT,'TRAVEL_EVENTS_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS travel_events_no_delete BEFORE DELETE ON travel_events
BEGIN SELECT RAISE(ABORT,'TRAVEL_EVENTS_APPEND_ONLY'); END;
