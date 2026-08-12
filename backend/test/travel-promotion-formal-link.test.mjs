import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPromotionLiveTravel, setPromotionFormalLink } from '../src/travel/promotion-formal-link.ts';
import { buildDeterministicPromotionReply } from '../src/travel/promotion-retrieval.ts';

const file = relative => new URL(relative, import.meta.url);
const migration = await readFile(file('../migrations/0056_travel_promotion_formal_links.sql'), 'utf8');
const service = await readFile(file('../src/travel/promotion-formal-link.ts'), 'utf8');
const routes = await readFile(file('../src/travel/promotion-routes.ts'), 'utf8');
const promotion = await readFile(file('../src/travel/promotion.ts'), 'utf8');

const itinerary = overrides => ({
  safeItineraryReference: 'iti_11111111-1111-1111-8111-111111111111', title: '北海道五日', summary: '',
  durationDays: 5, region: '日本', notes: '', coverAssetReference: null, coverUrl: null, status: 'PUBLISHED',
  sellerContext: 'TENANT', reviewNote: '', submittedAt: null, publishedAt: null, rejectedAt: null,
  archivedAt: null, createdAt: '2026-08-01', updatedAt: '2026-08-01', ...overrides,
});
const departure = overrides => ({
  safeDepartureReference: 'dep_22222222-2222-2222-8222-222222222222',
  safeItineraryReference: 'iti_11111111-1111-1111-8111-111111111111', itineraryTitle: '北海道五日',
  status: 'OPEN', departureDate: '2026-10-10', returnDate: '2026-10-14',
  bookingOpensAt: '2026-08-01T00:00:00.000Z', bookingClosesAt: '2026-09-30T23:59:59.000Z',
  seatLimit: 20, minGroupSize: 10, reservedTravelerCount: 8, remainingSeats: 12,
  priceAmountMinor: 32000, currencyCode: 'TWD', paymentScheduleType: 'FULL', depositAmountMinor: 0,
  depositDueAt: null, balanceDueAt: null, createdAt: '2026-08-01', updatedAt: '2026-08-01', ...overrides,
});

test('0056 is additive, empty, workspace-scoped, and permits one active link per promotion', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS travel_promotion_formal_links/);
  assert.match(migration, /FOREIGN KEY\(workspace_id,promotion_document_id,promotion_version_no\)/);
  assert.match(migration, /FOREIGN KEY\(workspace_id,itinerary_id\)/);
  assert.match(migration, /FOREIGN KEY\(workspace_id,departure_id\)/);
  assert.match(migration, /CREATE UNIQUE INDEX[^]*WHERE status='ACTIVE'/);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN)|ALTER\s+TABLE|INSERT\s+INTO|UPDATE\s+travel_(?:itineraries|departures|booking)/i);
});

test('0056 accepts only the current approved promotion version and a consistent departure parent', () => {
  assert.match(migration, /v\.version_no=d\.active_version_no/);
  assert.match(migration, /v\.version_status='APPROVED'/);
  assert.match(migration, /d\.status='ACTIVE'/);
  assert.match(migration, /dep\.itinerary_id=NEW\.itinerary_id/);
  assert.match(migration, /TRAVEL_PROMOTION_FORMAL_LINK_INVALID/);
});

test('0056 retains auditable link history and prevents retargeting or deletion', () => {
  assert.match(migration, /OLD\.status<>'ACTIVE'/);
  assert.match(migration, /NEW\.status<>'REMOVED'/);
  assert.match(migration, /NEW\.itinerary_id IS NOT OLD\.itinerary_id/);
  assert.match(migration, /NEW\.departure_id IS NOT OLD\.departure_id/);
  assert.match(migration, /BEFORE DELETE ON travel_promotion_formal_links/);
  assert.match(migration, /TRAVEL_PROMOTION_FORMAL_LINK_IMMUTABLE/);
});

test('formal-link API is admin controlled and derives workspace and actor server-side', () => {
  const start = routes.indexOf("app.put('/api/travel/promotions/:safePromotionReference/formal-link'");
  const route = routes.slice(start, routes.indexOf("app.get('/api/travel/promotions/:safePromotionReference'"));
  assert.ok(start >= 0);
  assert.match(route, /requireRole\(c,'admin'\)/);
  assert.match(route, /workspaceId:deps\.workspaceIdOf\(c\)/);
  assert.match(route, /userId:deps\.text\(c\.get\('userId'\)\)\|\|null/);
  assert.doesNotMatch(route, /workspaceId:body|userId:body/);
});

test('empty, unknown, and raw-id link bodies fail before any database access', async () => {
  const db = { prepare: () => { throw new Error('DATABASE_MUST_NOT_BE_CALLED'); } };
  const base = { workspaceId: 'workspace-private', promotionReference: 'promotion_33333333-3333-3333-8333-333333333333', userId: 'user-private' };
  await assert.rejects(() => setPromotionFormalLink(db, { ...base, body: {} }), /TRAVEL_PROMOTION_FORMAL_LINK_INPUT_INVALID/);
  await assert.rejects(() => setPromotionFormalLink(db, { ...base, body: { itineraryId: 'tri_internal' } }), /TRAVEL_PROMOTION_FORMAL_LINK_INPUT_INVALID/);
  await assert.rejects(() => setPromotionFormalLink(db, { ...base, body: { safeItineraryReference: 'tri_internal' } }), /TRAVEL_PROMOTION_FORMAL_LINK_INPUT_INVALID/);
});

test('promotion detail exposes only safe formal Travel references and labels', () => {
  assert.match(promotion, /formalTravelLink = await formalTravelLinkForDocument/);
  assert.match(promotion, /return readPromotionFormalLink/);
  const projection = service.slice(service.indexOf('const safeLink'), service.indexOf('export async function readPromotionFormalLink'));
  assert.match(projection, /safeItineraryReference/);
  assert.match(projection, /safeDepartureReference/);
  assert.doesNotMatch(projection, /workspaceId|documentId|itineraryId|departureId|promotionVersionNo/);
});

test('itinerary-only enrichment does not invent departure, capacity, price, or bookability', () => {
  const live = buildPromotionLiveTravel(itinerary(), null, new Date('2026-08-12T00:00:00Z'));
  assert.equal(live.itinerary.current, true);
  assert.equal(live.departure, null);
  assert.equal(live.currentBookability, null);
  assert.equal(live.soldOut, null);
  assert.equal(live.remainingSeats, null);
  assert.equal(live.authoritativePrice, null);
});

test('linked open departure uses formal current capacity, window, and price authority', () => {
  const live = buildPromotionLiveTravel(itinerary(), departure(), new Date('2026-08-12T00:00:00Z'));
  assert.equal(live.currentBookability, true);
  assert.equal(live.soldOut, false);
  assert.equal(live.remainingSeats, 12);
  assert.deepEqual(live.authoritativePrice, { amountMinor: 32000, currencyCode: 'TWD' });
});

test('sold-out, cancelled, closed-window, and non-current itinerary states are not bookable', () => {
  assert.equal(buildPromotionLiveTravel(itinerary(), departure({ remainingSeats: 0 }), new Date('2026-08-12')).soldOut, true);
  assert.equal(buildPromotionLiveTravel(itinerary(), departure({ status: 'CANCELLED' }), new Date('2026-08-12')).currentBookability, false);
  assert.equal(buildPromotionLiveTravel(itinerary(), departure(), new Date('2026-10-01')).currentBookability, false);
  assert.equal(buildPromotionLiveTravel(itinerary({ status: 'ARCHIVED' }), departure(), new Date('2026-08-12')).currentBookability, false);
});

test('reply keeps reviewed DM snapshot separate from current formal Travel facts', () => {
  const liveTravel = buildPromotionLiveTravel(itinerary(), departure({ remainingSeats: 0 }), new Date('2026-08-12'));
  const reply = buildDeterministicPromotionReply('北海道', [{
    safePromotionReference: 'promotion_33333333-3333-3333-8333-333333333333', score: 50,
    matchedFields: ['destination'], matchedKeywords: [], liveTravel,
    promotionSnapshot: { title: '北海道 DM', summary: '審核快照', destination: '北海道', region: '日本', days: 5,
      departureLocation: '', dateTexts: ['DM 10月'], pricingTexts: ['DM 30,000'], promotionTerms: [],
      highlights: [], keywords: [], faq: [], replyTemplate: '' },
  }]);
  assert.match(reply, /DM 日期：DM 10月/);
  assert.match(reply, /DM 宣傳價格：DM 30,000/);
  assert.match(reply, /正式出發日：2026-10-10/);
  assert.match(reply, /目前狀態：已售罄/);
  assert.match(reply, /目前價格：NT\$32,000/);
  assert.doesNotMatch(reply, /目前可報名/);
});

test('B1 read path reuses Travel services and adds no inferred or mutating domain authority', () => {
  assert.match(service, /readItinerary\(db,/);
  assert.match(service, /readDeparture\(db,/);
  assert.doesNotMatch(service, /(?:INSERT|UPDATE|DELETE)[^`]*(?:travel_itineraries|travel_departures|travel_booking|commerce_|campaign|referral|commission)/i);
  assert.doesNotMatch(service, /executeMeteredAiCall|requestGemini|\/v2\/bot|fetch\(/);
  assert.doesNotMatch(service, /lineUserId|line_uid|uidHash|passport|nationalId|paymentObligationId/);
});
