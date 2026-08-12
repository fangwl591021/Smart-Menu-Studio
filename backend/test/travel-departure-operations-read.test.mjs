import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  listDepartureOperationBookings,
  listDepartureOperationEvents,
  listDepartureOperationTravelers,
  projectDepartureReadiness,
  readDepartureOperations,
  travelOperationsLimit,
  travelOperationsPage,
} from '../src/travel/operations.ts';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [source, routes] = await Promise.all([read('../src/travel/operations.ts'), read('../src/travel/routes.ts')]);

const contracts = [
  ['viewer can read operations', routes, /departures\/:safeDepartureReference\/operations'[^]*requireRole\(c,'viewer'\)/],
  ['viewer can read booking roster', routes, /departures\/:safeDepartureReference\/bookings'[^]*requireRole\(c,'viewer'\)/],
  ['viewer can read traveler roster', routes, /departures\/:safeDepartureReference\/travelers'[^]*requireRole\(c,'viewer'\)/],
  ['viewer can read timeline', routes, /departures\/:safeDepartureReference\/events'[^]*requireRole\(c,'viewer'\)/],
  ['safe departure reference is route authority', routes, /safeDepartureReference:deps\.text\(c\.req\.param\('safeDepartureReference'\),100\)/],
  ['all departure lookups are workspace scoped', source, /WHERE d\.workspace_id=\? AND d\.public_ref=\? LIMIT 1/],
  ['reserved seats exclude cancelled bookings', source, /booking_status<>'CANCELLED' THEN b\.traveler_count/],
  ['fully paid uses Commerce order and payment truth', source, /o\.status='PAID' AND o\.payment_status='PAID'/],
  ['deposit obligation is distinguished from full settlement', source, /payment_leg='DEPOSIT' AND po\.status='PAID'/],
  ['customer label reuses CRM safe projection', source, /COALESCE\(NULLIF\(trim\(pr\.display_name\),''\)[^]*'會員顧客'/],
  ['seller label reuses immutable safe snapshot', source, /seller_label_snapshot/],
  ['booking pagination is bounded', source, /ORDER BY b\.created_at ASC,b\.id ASC LIMIT \? OFFSET \?/],
  ['traveler pagination is bounded', source, /ORDER BY b\.created_at ASC,b\.id ASC,t\.sequence_no ASC LIMIT \? OFFSET \?/],
  ['timeline is safe and server tie-broken', source, /SELECT event_type,occurred_at FROM travel_events[^]*ORDER BY occurred_at ASC,id ASC LIMIT \?/],
  ['operations are read only', source, /^(?![^]*(?:INSERT INTO|UPDATE |DELETE FROM))/i],
  ['no export endpoint exists', routes, /^(?![^]*departures\/:safeDepartureReference\/(?:export|roster-export))/],
  ['no mutation endpoint is added for operations', routes, /^(?![^]*app\.(?:post|put|patch|delete)\('\/api\/travel\/departures\/:safeDepartureReference\/(?:operations|bookings|travelers|events))/],
  ['no provider payload or transaction projection', source, /^(?![^]*(?:providerPayload|provider_transaction|callback_hash|TradeInfo))/i],
  ['no high-risk traveler data', source, /^(?![^]*(?:passport|national_id|health|bank|document_image))/i],
  ['no Referral Dealer Commission CRM or AI mutation', source, /^(?![^]*(?:INSERT INTO|UPDATE|DELETE FROM)[^\n]*(?:referral|line_oa_dealers|commission|crm_|campaign|points|rewards))/i],
  ['no AI invocation', source, /^(?![^]*(?:GEMINI|OPENAI|executeMeteredAiCall))/i],
];
for (const [name, text, pattern] of contracts) test(name, () => assert.match(text, pattern));

test('limit defaults to 25 and is bounded to 1 through 100', () => {
  assert.equal(travelOperationsLimit(undefined), 25);
  assert.equal(travelOperationsLimit('0'), 1);
  assert.equal(travelOperationsLimit('101'), 100);
  assert.equal(travelOperationsLimit('nope'), 25);
  assert.equal(travelOperationsPage(undefined), 1);
  assert.equal(travelOperationsPage('0'), 1);
  assert.equal(travelOperationsPage('10001'), 10000);
});

test('readiness is deterministic and separates blocking from advisory warnings', () => {
  const base = { departureStatus: 'OPEN', reservedSeats: 12, remainingSeats: 8, minGroupSize: 10, unpaidBookings: 0,
    depositCompletedBookings: 0, bookingOpenAt: '2026-08-01T00:00:00.000Z', bookingClosesAt: '2026-08-20T00:00:00.000Z', now: new Date('2026-08-12T00:00:00.000Z') };
  assert.deepEqual(projectDepartureReadiness(base), { state: 'READY', warnings: ['BOOKING_WINDOW_OPEN'] });
  assert.equal(projectDepartureReadiness({ ...base, unpaidBookings: 1 }).state, 'ATTENTION');
  assert.deepEqual(projectDepartureReadiness({ ...base, departureStatus: 'CANCELLED' }), { state: 'BLOCKED', warnings: ['DEPARTURE_CANCELLED','BOOKING_WINDOW_OPEN'] });
});

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, ' ').trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() {
    if (this.sql.startsWith('SELECT d.id,d.public_ref')) {
      if (this.values[0] !== 'workspace-a' || this.values[1] !== 'dep_safe') return null;
      return this.db.departure;
    }
    if (this.sql.startsWith('SELECT COUNT(*) booking_count')) return this.db.summary;
    throw new Error(`Unexpected first: ${this.sql}`);
  }
  async all() {
    if (this.sql.startsWith('SELECT b.public_ref,COALESCE')) return { results: this.db.bookings.slice(this.values[3], this.values[3] + this.values[2]) };
    if (this.sql.startsWith('SELECT b.public_ref booking_ref')) return { results: this.db.travelers.slice(this.values[3], this.values[3] + this.values[2]) };
    if (this.sql.startsWith('SELECT event_type,occurred_at')) return { results: this.db.events.slice(0, this.values[2]) };
    throw new Error(`Unexpected all: ${this.sql}`);
  }
}
class Db {
  constructor() {
    this.departure = { id: 'departure-internal', public_ref: 'dep_safe', status: 'OPEN', departure_date: '2026-09-01', return_date: '2026-09-05',
      booking_opens_at: '2026-08-01T00:00:00.000Z', booking_closes_at: '2026-08-20T00:00:00.000Z', seat_limit: 20, min_group_size: 10, itinerary_title: '安全行程' };
    this.summary = { booking_count: 4, traveler_count: 12, cancelled_bookings: 1, fully_paid_bookings: 1, deposit_completed_bookings: 1, unpaid_bookings: 1 };
    this.bookings = [
      { public_ref: 'bkg_safe_1', safe_customer_label: '王小姐', booking_status: 'DEPOSIT_PAID', payment_status: 'DEPOSIT_COMPLETED', traveler_count: 2, seller_label_snapshot: 'Travel seller ABC123', created_at: '2026-08-02T00:00:00.000Z' },
      { public_ref: 'bkg_safe_2', safe_customer_label: '會員顧客', booking_status: 'PENDING_PAYMENT', payment_status: 'UNPAID', traveler_count: 1, seller_label_snapshot: null, created_at: '2026-08-03T00:00:00.000Z' },
    ];
    this.travelers = [{ booking_ref: 'bkg_safe_1', sequence_no: 1, display_name: '旅客甲', traveler_type: 'ADULT', phone: '0900000000', note: '低風險備註' }];
    this.events = [{ event_type: 'BOOKING_CREATED', occurred_at: '2026-08-02T00:00:00.000Z' }];
  }
  prepare(sql) { return new Statement(this, sql); }
}

test('operations summary derives seats, counts, payment partitions and readiness without IDs', async () => {
  const result = await readDepartureOperations(new Db(), { workspaceId: 'workspace-a', safeDepartureReference: 'dep_safe', now: new Date('2026-08-12T00:00:00.000Z') });
  assert.equal(result.reservedSeats, 12); assert.equal(result.remainingSeats, 8); assert.equal(result.bookingCount, 4); assert.equal(result.travelerCount, 12);
  assert.equal(result.unpaidBookings, 1); assert.equal(result.depositCompletedBookings, 1); assert.equal(result.fullyPaidBookings, 1); assert.equal(result.cancelledBookings, 1);
  assert.equal(result.readiness.state, 'ATTENTION');
  assert.deepEqual(Object.keys(result).some(key => /(^id$|internal|workspace|member|dealer|crm|commission)/i.test(key)), false);
});

test('cross-workspace departure access fails closed', async () => {
  await assert.rejects(() => readDepartureOperations(new Db(), { workspaceId: 'workspace-b', safeDepartureReference: 'dep_safe' }), /TRAVEL_DEPARTURE_NOT_FOUND/);
});

test('booking roster exposes safe customer and seller labels and supports no seller', async () => {
  const result = await listDepartureOperationBookings(new Db(), { workspaceId: 'workspace-a', safeDepartureReference: 'dep_safe', limit: 1000 });
  assert.equal(result.limit, 100); assert.equal(result.page, 1); assert.equal(result.bookings[0].safeCustomerLabel, '王小姐'); assert.equal(result.bookings[0].safeSellerLabel, 'Travel seller ABC123');
  assert.equal(result.bookings[1].safeSellerLabel, null); assert.deepEqual(Object.keys(result.bookings[0]).sort(), ['bookingStatus','createdAt','paymentStatus','safeBookingReference','safeCustomerLabel','safeSellerLabel','travelerCount'].sort());
});

test('traveler roster is bounded and returns only approved low-risk snapshots', async () => {
  const result = await listDepartureOperationTravelers(new Db(), { workspaceId: 'workspace-a', safeDepartureReference: 'dep_safe' });
  assert.equal(result.limit, 25); assert.equal(result.page, 1); assert.deepEqual(Object.keys(result.travelers[0]).sort(), ['displayName','note','phone','safeBookingReference','sequence','travelerType'].sort());
  assert.equal(JSON.stringify(result).includes('departure-internal'), false);
});

test('departure timeline is bounded, safe, and contains no internal event id', async () => {
  const result = await listDepartureOperationEvents(new Db(), { workspaceId: 'workspace-a', safeDepartureReference: 'dep_safe', limit: 1 });
  assert.deepEqual(result, { limit: 1, events: [{ eventType: 'BOOKING_CREATED', safeEventLabel: '報名訂單已建立', occurredAt: '2026-08-02T00:00:00.000Z' }] });
});
