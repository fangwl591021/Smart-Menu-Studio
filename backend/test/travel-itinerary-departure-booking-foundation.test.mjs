import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { projectTravelPaymentMilestone } from '../src/travel/payment-projection.ts';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [migration, travel, routes, memberRoutes, commerce, commerceRoutes, entitlements] = await Promise.all([
  read('../migrations/0051_travel_foundation.sql'),
  read('../src/travel/travel.ts'),
  read('../src/travel/routes.ts'),
  read('../src/travel/member-routes.ts'),
  read('../src/commerce/commerce.ts'),
  read('../src/commerce/routes.ts'),
  read('../src/modules/entitlements.ts'),
]);

const contracts = [
  ['0051 is additive and creates no data', migration, /Additive only; no backfill, seed data/],
  ['itinerary table exists', migration, /CREATE TABLE IF NOT EXISTS travel_itineraries/],
  ['departure table exists', migration, /CREATE TABLE IF NOT EXISTS travel_departures/],
  ['booking extension table exists', migration, /CREATE TABLE IF NOT EXISTS travel_booking_extensions/],
  ['traveler snapshot table exists', migration, /CREATE TABLE IF NOT EXISTS travel_booking_travelers/],
  ['payment schedule snapshot table exists', migration, /CREATE TABLE IF NOT EXISTS travel_payment_schedules/],
  ['operational event table exists', migration, /CREATE TABLE IF NOT EXISTS travel_events/],
  ['review lifecycle is constrained', migration, /'DRAFT','PENDING_REVIEW','PUBLISHED','REJECTED','ARCHIVED'/],
  ['departure lifecycle is constrained', migration, /'DRAFT','OPEN','CLOSED','SOLD_OUT','CANCELLED','ARCHIVED'/],
  ['booking lifecycle is constrained', migration, /'PENDING_PAYMENT','DEPOSIT_PAID','CONFIRMED','BALANCE_DUE','FULLY_PAID','CANCELLED'/],
  ['only TWD is accepted', migration, /currency_code TEXT NOT NULL DEFAULT 'TWD' CHECK\(currency_code='TWD'\)/],
  ['FULL and DEPOSIT_BALANCE are snapshotted', migration, /payment_schedule_type_snapshot[^]*'FULL','DEPOSIT_BALANCE'/],
  ['seat capacity is enforced in the database', migration, /travel_booking_capacity_guard[^]*TRAVEL_DEPARTURE_CAPACITY_EXCEEDED/],
  ['booking identity is workspace and verified-member scoped', migration, /travel_booking_identity_scope_insert[^]*TRAVEL_BOOKING_IDENTITY_SCOPE_INVALID/],
  ['booking window is enforced in the database', migration, /travel_booking_availability_guard[^]*datetime\('now'\)/],
  ['only published itinerary and open departure can book', migration, /d\.status='OPEN' AND i\.status='PUBLISHED'/],
  ['traveler snapshots are immutable', migration, /travel_travelers_no_update[^]*TRAVEL_TRAVELER_SNAPSHOT_IMMUTABLE/],
  ['payment schedules are immutable', migration, /travel_payment_schedules_no_update[^]*TRAVEL_PAYMENT_SCHEDULE_IMMUTABLE/],
  ['events are append-only', migration, /travel_events_no_update[^]*TRAVEL_EVENTS_APPEND_ONLY/],
  ['payment event projection is idempotent', migration, /UNIQUE\(workspace_id,dedupe_key\)/],
  ['Travel uses the Commerce offer bridge', travel, /ensureCommerceOfferForTravelDeparture/],
  ['Travel uses Commerce order authority', travel, /createOrder\(db/],
  ['Travel uses Commerce payment-leg authority', travel, /initiatePaymentForLeg\(db/],
  ['booking and Commerce order share one batch boundary', `${travel}\n${commerce}`, /trustedAppendStatements/],
  ['server computes total from frozen departure price', travel, /price_amount_minor\)\*travelers\.length/],
  ['server computes deposit and balance amounts', travel, /paymentLeg:'DEPOSIT'[^]*paymentLeg:'BALANCE'/],
  ['member itinerary read requires published status', memberRoutes, /itinerary\.status!=='PUBLISHED'/],
  ['member departure read uses purchasable filtering', memberRoutes, /readDeparture\([^]*true/],
  ['member purchasable departures exclude exhausted capacity', travel, /d\.seat_limit>\(SELECT COALESCE\(SUM\(mb\.traveler_count\),0\)/],
  ['member booking binds verified CRM person', memberRoutes, /ensureCrmPersonForVerifiedMember/],
  ['member Travel is entitlement guarded', memberRoutes, /},'TRAVEL'\)/],
  ['TRAVEL requires COMMERCE', entitlements, /TRAVEL: \['COMMERCE'\]/],
  ['TRAVEL does not hard-require CRM', entitlements, /TRAVEL: \[(?![^\]]*'CRM')'COMMERCE'\]/],
  ['tenant Travel routes map to TRAVEL entitlement', entitlements, /path === '\/api\/travel'[^]*return 'TRAVEL'/],
  ['provider callback invokes Travel projection after verified settlement', commerce, /applyVerifiedPaymentLeg[^]*await projectTravel\(\)/],
  ['duplicate successful callback repairs projection', commerce, /duplicate\.status==='SUCCEEDED'[^]*projectTravel/],
  ['callback route injects projection', commerceRoutes, /projectTravelPaymentMilestone:deps\.projectTravelPaymentMilestone/],
  ['tenant review action exists', routes, /submit-review/],
  ['tenant publish approval action exists', routes, /\['approve','approve','owner'\]/],
  ['tenant booking reads exist', routes, /\/api\/travel\/bookings/],
  ['member booking creation exists', memberRoutes, /post\('\/api\/member\/travel\/bookings'/],
  ['member permitted-leg payment route exists', memberRoutes, /payment-intents/],
  ['no travel customer duplicate exists', migration, /^(?![\s\S]*CREATE TABLE(?: IF NOT EXISTS)? travel_customers)/i],
  ['no generic travel order duplicate exists', migration, /^(?![\s\S]*CREATE TABLE(?: IF NOT EXISTS)? travel_orders)/i],
  ['no travel payment transaction duplicate exists', migration, /^(?![\s\S]*CREATE TABLE(?: IF NOT EXISTS)? travel_payment_transactions)/i],
  ['no travel commission ledger exists', migration, /^(?![\s\S]*CREATE TABLE(?: IF NOT EXISTS)? travel_commission)/i],
  ['V1 has no passport national ID or health fields', migration, /^(?![\s\S]*(passport|national_id|health|dietary))/i],
  ['public Travel views expose no LINE identity', travel, /^(?![\s\S]*(lineUserId|line_user_id|identityHash|identity_hash)\s*:)/],
  ['public Travel views expose no internal IDs', travel, /^(?![\s\S]*return \{[^}]*?(crmPersonId|commerceOrderId|paymentObligationId)\s*:)/],
  ['Travel performs no Referral mutation', travel, /^(?![\s\S]*(UPDATE|INSERT INTO) referral\w*\b)/i],
  ['Travel performs no Points or Rewards mutation', travel, /^(?![\s\S]*(UPDATE|INSERT INTO) (points|rewards)\w*\b)/i],
  ['Travel performs no Commission or Payout mutation', travel, /^(?![\s\S]*(UPDATE|INSERT INTO) (commission|payout)\w*\b)/i],
  ['Travel performs no CRM profile mutation', travel, /^(?![\s\S]*(UPDATE|INSERT INTO) crm_(profiles|stages|follow|tags)\w*\b)/i],
  ['Travel performs no Campaign mutation', travel, /^(?![\s\S]*(UPDATE|INSERT INTO) campaign\w*\b)/i],
  ['Travel invokes no AI', travel, /^(?![\s\S]*(GEMINI|OPENAI|executeMeteredAiCall))/i],
  ['Travel imports no TravelKeeper data', `${migration}\n${travel}`, /^(?![\s\S]*TravelKeeper)/i],
  ['0051 contains no DROP', migration, /^(?![\s\S]*\bDROP\b)/i],
  ['0051 contains no backfill DML', migration, /^(?![\s\S]^\s*(UPDATE|DELETE FROM)\s)/im],
];
for (const [name, source, pattern] of contracts) test(name, () => assert.match(source, pattern));

class Statement {
  constructor(db, sql) { this.db=db; this.sql=sql.replace(/\s+/g,' ').trim(); this.values=[]; }
  bind(...values){this.values=values;return this;}
  async first(){if(this.sql.startsWith('SELECT id,departure_id,booking_status'))return this.db.booking;throw new Error(`Unexpected first: ${this.sql}`);}
  async all(){if(this.sql.startsWith('SELECT payment_leg,status'))return {results:this.db.obligations};throw new Error(`Unexpected all: ${this.sql}`);}
  async run(){if(this.sql.startsWith('UPDATE travel_booking_extensions')){this.db.booking.booking_status=this.values[0];return;}if(this.sql.startsWith('INSERT INTO travel_events')){const key=this.values[5];if(!this.db.events.has(key))this.db.events.add(key);return;}throw new Error(`Unexpected run: ${this.sql}`);}
}
class ProjectionDb {
  constructor(obligations){this.booking={id:'booking',departure_id:'departure',booking_status:'PENDING_PAYMENT'};this.obligations=obligations;this.events=new Set();this.batchCount=0;}
  prepare(sql){return new Statement(this,sql);}
  async batch(statements){this.batchCount+=1;for(const statement of statements)await statement.run();}
}
const project=(db,leg)=>projectTravelPaymentMilestone(db,{workspaceId:'workspace',orderId:'order',paymentLeg:leg,occurredAt:'2026-08-11T00:00:00.000Z'});

test('DEPOSIT payment projects DEPOSIT_PAID without whole booking confirmation',async()=>{const db=new ProjectionDb([{payment_leg:'DEPOSIT',status:'PAID'},{payment_leg:'BALANCE',status:'PENDING'}]);await project(db,'DEPOSIT');assert.equal(db.booking.booking_status,'DEPOSIT_PAID');assert.equal(db.events.has('payment:booking:DEPOSIT_PAID'),true);assert.equal(db.events.has('payment:booking:BOOKING_CONFIRMED'),false);});
test('BALANCE after DEPOSIT projects fully paid and confirmation',async()=>{const db=new ProjectionDb([{payment_leg:'DEPOSIT',status:'PAID'},{payment_leg:'BALANCE',status:'PAID'}]);await project(db,'BALANCE');assert.equal(db.booking.booking_status,'FULLY_PAID');assert.equal(db.events.has('payment:booking:BALANCE_PAID'),true);assert.equal(db.events.has('payment:booking:BOOKING_CONFIRMED'),true);});
test('FULL projects fully paid and confirmation',async()=>{const db=new ProjectionDb([{payment_leg:'FULL',status:'PAID'}]);await project(db,'FULL');assert.equal(db.booking.booking_status,'FULLY_PAID');assert.equal(db.events.has('payment:booking:FULL_PAYMENT_PAID'),true);});
test('duplicate projection is idempotent at the event key',async()=>{const db=new ProjectionDb([{payment_leg:'FULL',status:'PAID'}]);await project(db,'FULL');await project(db,'FULL');assert.equal(db.events.size,2);});
test('cancelled booking is never revived by payment projection',async()=>{const db=new ProjectionDb([{payment_leg:'FULL',status:'PAID'}]);db.booking.booking_status='CANCELLED';assert.deepEqual(await project(db,'FULL'),{projected:false});assert.equal(db.batchCount,0);});
