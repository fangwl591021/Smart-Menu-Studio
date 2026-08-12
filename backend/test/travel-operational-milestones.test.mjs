import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  completeDepartureService,
  confirmDepartureOperation,
  readMemberBookingFulfillment,
  readOperationalState,
} from '../src/travel/milestones.ts';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [migration, source, routes, memberRoutes, operations, indexSource] = await Promise.all([
  read('../migrations/0054_travel_operations_events.sql'),
  read('../src/travel/milestones.ts'),
  read('../src/travel/routes.ts'),
  read('../src/travel/member-routes.ts'),
  read('../src/travel/operations.ts'),
  read('../src/index.ts'),
]);

const contracts = [
  ['0054 is explicitly additive and contains no backfill or seed', migration, /Additive only; no backfill, seed data, fake events, or production data mutation/],
  ['0054 creates only the operation event table', migration, /CREATE TABLE IF NOT EXISTS travel_operation_events/],
  ['milestone vocabulary is closed', migration, /CHECK\(event_type IN \('OPERATION_CONFIRMED','SERVICE_COMPLETED'\)\)/],
  ['milestones are unique per workspace and departure', migration, /UNIQUE\(workspace_id,departure_id,event_type\)/],
  ['departure foreign key remains workspace scoped', migration, /FOREIGN KEY\(workspace_id,departure_id\) REFERENCES travel_departures\(workspace_id,id\) ON DELETE RESTRICT/],
  ['operation events reject cross-workspace inserts', migration, /travel_operation_event_scope_insert[^]*d\.id=NEW\.departure_id AND d\.workspace_id=NEW\.workspace_id/],
  ['operation events reject updates', migration, /travel_operation_events_no_update[^]*TRAVEL_OPERATION_EVENTS_APPEND_ONLY/],
  ['operation events reject deletes', migration, /travel_operation_events_no_delete[^]*TRAVEL_OPERATION_EVENTS_APPEND_ONLY/],
  ['migration has no seed insert', migration, /^(?![^]*INSERT INTO)/i],
  ['migration does not alter or rebuild existing Travel tables', migration, /^(?![^]*(?:ALTER TABLE|DROP TABLE|UPDATE travel_|DELETE FROM travel_))/i],
  ['Tenant confirmation requires admin', routes, /operations\/\$\{path\}[^]*requireRole\(c,'admin'\)/],
  ['owner remains above admin and can mutate', indexSource, /admin: 30,[^]*owner: 40,[^]*ROLE_LEVEL\[current\][^]*ROLE_LEVEL\[minimum\]/],
  ['viewer and editor remain below admin and cannot mutate', indexSource, /viewer: 10,[^]*editor: 20,[^]*admin: 30/],
  ['Tenant mutation accepts empty body only', routes, /Object\.keys\(body\)\.length[^]*TRAVEL_OPERATION_INPUT_INVALID/],
  ['Tenant mutations expose only operational state', routes, /return c\.json\(\{success:true,operationalState\}\)/],
  ['Member route adds fulfillment to own booking read', memberRoutes, /readMemberBookingFulfillment[^]*booking:\{\.\.\.booking,fulfillment\}/],
  ['Member has no operation mutation route', memberRoutes, /^(?![^]*app\.(?:post|put|patch|delete)\('\/api\/member\/travel\/.*operations)/],
  ['departure validity preserves existing state authority', source, /\['OPEN','CLOSED','SOLD_OUT'\][^]*TRAVEL_OPERATION_DEPARTURE_INVALID/],
  ['service completion requires prior confirmation', source, /SERVICE_COMPLETED[^]*!current\.confirmed[^]*TRAVEL_OPERATION_NOT_CONFIRMED/],
  ['insert is idempotent', source, /ON CONFLICT\(workspace_id,departure_id,event_type\) DO NOTHING/],
  ['member booking lookup is identity and workspace scoped', source, /b\.workspace_id=\? AND b\.line_account_id=\? AND b\.line_member_id=\? AND b\.public_ref=\?/],
  ['member fulfillment exposes only safe state and times', source, /return \{ state:[^]*confirmedAt: operation\.confirmedAt, completedAt: operation\.completedAt \}/],
  ['timeline merges operational milestones', operations, /UNION ALL[^]*FROM travel_operation_events/],
  ['no operation notes or high-risk traveler data', source + migration, /^(?![^]*(?:passport|national_id|health|document_image|free_text|notes? TEXT))/i],
  ['no unrelated domain mutation', source, /^(?![^]*(?:INSERT INTO|UPDATE|DELETE FROM)[^\n]*(?:commerce_|travel_booking|referral|line_oa_dealers|commission|crm_|campaign|points|rewards))/i],
  ['no provider execution or AI invocation', source, /^(?![^]*(?:TradeInfo|provider|GEMINI|OPENAI|executeMeteredAiCall|fetch\())/i],
];
for (const [name, text, pattern] of contracts) test(name, () => assert.match(text, pattern));

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, ' ').trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() {
    if (this.sql.startsWith('SELECT id,status FROM travel_departures')) {
      return this.values[0] === this.db.workspaceId && this.values[1] === this.db.departureRef ? { id: this.db.departureId, status: this.db.departureStatus } : null;
    }
    if (this.sql.startsWith('SELECT b.booking_status,d.status departure_status')) {
      const [workspaceId,lineAccountId,lineMemberId,bookingRef] = this.values;
      if (workspaceId !== this.db.workspaceId || lineAccountId !== this.db.lineAccountId || lineMemberId !== this.db.lineMemberId || bookingRef !== this.db.bookingRef) return null;
      return { booking_status: this.db.bookingStatus, departure_status: this.db.departureStatus, departure_id: this.db.departureId };
    }
    throw new Error(`Unexpected first: ${this.sql}`);
  }
  async all() {
    if (this.sql.startsWith('SELECT event_type,occurred_at FROM travel_operation_events')) {
      return { results: this.db.events.filter(row => row.workspace_id === this.values[0] && row.departure_id === this.values[1]).sort((a,b) => a.occurred_at.localeCompare(b.occurred_at)) };
    }
    throw new Error(`Unexpected all: ${this.sql}`);
  }
  async run() {
    if (!this.sql.startsWith('INSERT INTO travel_operation_events')) throw new Error(`Unexpected run: ${this.sql}`);
    const [id,workspaceId,departureId,eventType,actorUserId,occurredAt,createdAt] = this.values;
    if (!this.db.events.some(row => row.workspace_id === workspaceId && row.departure_id === departureId && row.event_type === eventType)) {
      this.db.events.push({ id, workspace_id: workspaceId, departure_id: departureId, event_type: eventType, actor_user_id: actorUserId, occurred_at: occurredAt, created_at: createdAt });
    }
    return { success: true };
  }
}
class Db {
  constructor() {
    this.workspaceId = 'workspace-a'; this.departureId = 'departure-internal'; this.departureRef = 'dep_safe'; this.departureStatus = 'OPEN';
    this.lineAccountId = 'line-account-a'; this.lineMemberId = 'member-a'; this.bookingRef = 'booking_safe'; this.bookingStatus = 'FULLY_PAID'; this.events = [];
  }
  prepare(sql) { return new Statement(this, sql); }
}

const tenantInput = { workspaceId: 'workspace-a', safeDepartureReference: 'dep_safe', actorUserId: 'admin-a' };

test('operational state starts pending without synthesizing an event', async () => {
  const db = new Db();
  assert.deepEqual(await readOperationalState(db, db.workspaceId, db.departureId), { confirmed: false, confirmedAt: null, completed: false, completedAt: null });
  assert.equal(db.events.length, 0);
});

test('confirmation is append-only and idempotent', async () => {
  const db = new Db();
  const first = await confirmDepartureOperation(db, tenantInput);
  const second = await confirmDepartureOperation(db, tenantInput);
  assert.equal(first.confirmed, true); assert.equal(first.completed, false); assert.deepEqual(second, first);
  assert.equal(db.events.filter(row => row.event_type === 'OPERATION_CONFIRMED').length, 1);
});

test('completion requires confirmation and is append-only and idempotent', async () => {
  const db = new Db();
  await assert.rejects(() => completeDepartureService(db, tenantInput), /TRAVEL_OPERATION_NOT_CONFIRMED/);
  await confirmDepartureOperation(db, tenantInput);
  const first = await completeDepartureService(db, tenantInput);
  const second = await completeDepartureService(db, tenantInput);
  assert.equal(first.confirmed, true); assert.equal(first.completed, true); assert.deepEqual(second, first);
  assert.equal(db.events.filter(row => row.event_type === 'SERVICE_COMPLETED').length, 1);
});

test('Worker retry returns the existing milestone after later departure cancellation', async () => {
  const db = new Db();
  const confirmed = await confirmDepartureOperation(db, tenantInput); db.departureStatus = 'CANCELLED';
  assert.deepEqual(await confirmDepartureOperation(db, tenantInput), confirmed);
  assert.equal(db.events.length, 1);
});

for (const status of ['DRAFT','CANCELLED','ARCHIVED']) test(`${status} departure rejects operational mutation`, async () => {
  const db = new Db(); db.departureStatus = status;
  await assert.rejects(() => confirmDepartureOperation(db, tenantInput), /TRAVEL_OPERATION_DEPARTURE_INVALID/);
  assert.equal(db.events.length, 0);
});

test('cross-workspace operational mutation fails closed', async () => {
  await assert.rejects(() => confirmDepartureOperation(new Db(), { ...tenantInput, workspaceId: 'workspace-b' }), /TRAVEL_DEPARTURE_NOT_FOUND/);
});

test('Member fulfillment progresses from pending to confirmed to completed', async () => {
  const db = new Db(); const input = { workspaceId: db.workspaceId, lineAccountId: db.lineAccountId, lineMemberId: db.lineMemberId, safeBookingReference: db.bookingRef };
  assert.equal((await readMemberBookingFulfillment(db, input)).state, 'PENDING');
  await confirmDepartureOperation(db, tenantInput); assert.equal((await readMemberBookingFulfillment(db, input)).state, 'CONFIRMED');
  await completeDepartureService(db, tenantInput); assert.equal((await readMemberBookingFulfillment(db, input)).state, 'COMPLETED');
});

test('Member fulfillment fails closed for a different verified member', async () => {
  const db = new Db();
  await assert.rejects(() => readMemberBookingFulfillment(db, { workspaceId: db.workspaceId, lineAccountId: db.lineAccountId, lineMemberId: 'member-b', safeBookingReference: db.bookingRef }), /TRAVEL_BOOKING_NOT_FOUND/);
});

test('existing booking or departure cancellation remains fulfillment authority', async () => {
  const db = new Db(); const input = { workspaceId: db.workspaceId, lineAccountId: db.lineAccountId, lineMemberId: db.lineMemberId, safeBookingReference: db.bookingRef };
  db.bookingStatus = 'CANCELLED'; assert.equal((await readMemberBookingFulfillment(db, input)).state, 'CANCELLED');
  db.bookingStatus = 'FULLY_PAID'; db.departureStatus = 'CANCELLED'; assert.equal((await readMemberBookingFulfillment(db, input)).state, 'CANCELLED');
});