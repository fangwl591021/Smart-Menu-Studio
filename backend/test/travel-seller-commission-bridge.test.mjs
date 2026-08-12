import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  listTravelSellers,
  projectTravelCommissionEligibility,
  resolveTrustedTravelSellerAttribution,
  travelSellerReference,
} from '../src/travel/seller-commission.ts';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [migration, sellerBridge, travel, routes, memberRoutes, paymentProjection, commerce, commission, entitlements] = await Promise.all([
  read('../migrations/0053_travel_seller_commission_bridge.sql'),
  read('../src/travel/seller-commission.ts'),
  read('../src/travel/travel.ts'),
  read('../src/travel/routes.ts'),
  read('../src/travel/member-routes.ts'),
  read('../src/travel/payment-projection.ts'),
  read('../src/commerce/commerce.ts'),
  read('../src/commission/attribution.ts'),
  read('../src/modules/entitlements.ts'),
]);
const publicSellerSource = sellerBridge.slice(sellerBridge.indexOf('function publicSeller'), sellerBridge.indexOf('async function scopedDealerRows'));

const contracts = [
  ['0053 is additive and creates no production data', migration, /Additive only; no backfill, seed data, fake sellers, bookings, or commissions/],
  ['existing Dealer is referenced instead of duplicated', migration, /FOREIGN KEY\(dealer_id\) REFERENCES line_oa_dealers/],
  ['Travel seller permission exists', migration, /CREATE TABLE IF NOT EXISTS travel_seller_permissions/],
  ['permission status is constrained', migration, /CHECK\(status IN \('ACTIVE','REVOKED'\)\)/],
  ['permission is workspace and LINE-account scoped', migration, /UNIQUE\(workspace_id,line_account_id,dealer_id\)/],
  ['cross-workspace permission is database blocked', migration, /travel_seller_permission_scope_insert[^]*d\.workspace_id=NEW\.workspace_id[^]*d\.line_account_id=NEW\.line_account_id/],
  ['booking seller context is a narrow extension', migration, /CREATE TABLE IF NOT EXISTS travel_booking_seller_contexts/],
  ['booking seller snapshot is immutable', migration, /travel_booking_seller_context_no_update[^]*TRAVEL_SELLER_ATTRIBUTION_IMMUTABLE/],
  ['booking seller cannot be reassigned', migration, /travel_booking_seller_no_reassignment[^]*TRAVEL_SELLER_ATTRIBUTION_IMMUTABLE/],
  ['trusted attribution requires qualified Referral', migration, /member_referral_attributions[^]*r\.status='qualified'/],
  ['trusted attribution requires active Dealer and permission', migration, /p\.status='ACTIVE' AND d\.status='ACTIVE'/],
  ['snapshot freezes amount and TWD currency', migration, /commissionable_amount_minor_snapshot[^]*currency_code_snapshot TEXT NOT NULL DEFAULT 'TWD'/],
  ['bridge events are append-only', migration, /travel_seller_bridge_events_no_update[^]*TRAVEL_SELLER_EVENTS_APPEND_ONLY/],
  ['required audit vocabulary exists', migration, /TRAVEL_SELLER_PERMISSION_GRANTED[^]*TRAVEL_SELLER_PERMISSION_REVOKED[^]*TRAVEL_SELLER_ATTRIBUTION_FROZEN[^]*TRAVEL_COMMISSION_ELIGIBILITY_PROJECTED/],
  ['viewer seller list exists', routes, /get\('\/api\/travel\/sellers'[^]*requireRole\(c,'viewer'\)/],
  ['only admin grants seller permission', routes, /sellers\/:safeDealerReference\/permission'[^]*requireRole\(c,'admin'\)/],
  ['only admin revokes seller permission', routes, /sellers\/:safeDealerReference\/revoke'[^]*requireRole\(c,'admin'\)/],
  ['seller APIs expose safe references', `${routes}\n${sellerBridge}`, /safeSellerReference/],
  ['member booking accepts no browser seller field', travel, /exact\(input\.body,\['safeDepartureReference','travelers'\]/],
  ['seller is resolved from server Member context', travel, /resolveTrustedTravelSellerAttribution[^]*inviteeMemberId:input\.lineMemberId/],
  ['member route supplies server HMAC authority', memberRoutes, /sellerReferenceSecret:deps\.text\(c\.env\.MEMBER_IDENTITY_HMAC_SECRET\)/],
  ['booking with no seller remains valid', travel, /seller\?\.sellerDealerId\|\|null/],
  ['snapshot is added only for trusted seller', travel, /seller\?travelSellerSnapshotStatements/],
  ['booking projection returns only safe seller data', travel, /seller=.+safeSellerReference.+sellerLabel[^]*seller,travelers/],
  ['DEPOSIT does not invoke commission projection', paymentProjection, /const commission = fullyPaid \? await projectTravelCommissionEligibility/],
  ['verified callback supplies server secret', commerce, /projectTravelPaymentMilestone[^]*MEMBER_IDENTITY_HMAC_SECRET/],
  ['Travel produces existing server Referral evidence', sellerBridge, /establishConversionReferralEvidence/],
  ['Travel calls existing Commission authority', sellerBridge, /establishCommissionAttribution/],
  ['Travel source metadata is safe and explicit', sellerBridge, /conversion_source[^]*'TRAVEL'/],
  ['fully settled Commerce is required', sellerBridge, /order_status !== 'PAID' \|\| context\.payment_status !== 'PAID'/],
  ['conversion projection is deterministic', sellerBridge, /travel-booking-fully-settled:\$\{context\.booking_id\}/],
  ['duplicate conversion is ignored', sellerBridge, /ON CONFLICT\(workspace_id,external_event_id\) DO NOTHING/],
  ['duplicate bridge event is ignored', sellerBridge, /ON CONFLICT\(workspace_id,dedupe_key\) DO NOTHING[^]*travel-commission-eligibility:\$\{context\.booking_id\}/],
  ['existing calculation is retried without duplicate ledger', commission, /ALREADY_ATTRIBUTED[^]*calculateCommissionForAttribution/],
  ['TRAVEL requires COMMERCE', entitlements, /TRAVEL: \['COMMERCE'\]/],
  ['TRAVEL does not hard require CRM', entitlements, /TRAVEL: \[(?![^\]]*'CRM')'COMMERCE'\]/],
  ['no duplicate Travel Dealer table', migration, /^(?![^]*CREATE TABLE(?: IF NOT EXISTS)? travel_(?:dealers|distributors)\b)/i],
  ['no duplicate Travel Commission table', migration, /^(?![^]*CREATE TABLE(?: IF NOT EXISTS)? travel_commissions?\b)/i],
  ['no duplicate settlement or payout table', migration, /^(?![^]*CREATE TABLE(?: IF NOT EXISTS)? travel_(?:settlements|payouts?)\b)/i],
  ['0053 contains no destructive SQL', migration, /^(?![^]*\b(?:DROP|DELETE FROM|ALTER TABLE)\b)/i],
  ['Travel bridge mutates no Referral records', sellerBridge, /^(?![^]*(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:member_)?referral)/i],
  ['Travel bridge mutates no Dealer records', sellerBridge, /^(?![^]*(?:INSERT INTO|UPDATE|DELETE FROM)\s+line_oa_dealers)/i],
  ['Travel bridge mutates no Points Rewards CRM Campaign or AI', sellerBridge, /^(?![^]*(?:points|rewards|crm_profiles|campaigns|GEMINI|OPENAI|executeMeteredAiCall))/i],
  ['public seller projection contains no raw internal identifiers', publicSellerSource, /^(?![^]*(?:dealerId|memberId|crmPersonId|commerceOrderId|travelBookingId|commissionId)\s*:)/i],
];
for (const [name, source, pattern] of contracts) test(name, () => assert.match(source, pattern));

test('safe seller reference is stable and scoped', async () => {
  const input = { workspaceId: 'workspace-a', lineAccountId: 'account-a', dealerId: 'dealer-internal' };
  const first = await travelSellerReference('test-secret', input);
  assert.equal(first, await travelSellerReference('test-secret', input));
  assert.notEqual(first, await travelSellerReference('test-secret', { ...input, workspaceId: 'workspace-b' }));
  assert.match(first, /^tsr_[a-f0-9]{64}$/);
  assert.equal(first.includes(input.dealerId), false);
});

class ReferenceStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, ' ').trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() {
    if (this.sql.startsWith('SELECT id FROM workspace_line_accounts')) return this.db.account;
    if (this.sql.startsWith('SELECT r.id member_referral_attribution_id')) return this.db.attribution;
    throw new Error(`Unexpected first: ${this.sql}`);
  }
  async all() {
    if (this.sql.startsWith('SELECT d.id,d.status dealer_status')) return { results: this.db.dealers };
    throw new Error(`Unexpected all: ${this.sql}`);
  }
}
class ReferenceDb {
  constructor({ account = { id: 'account-a' }, dealers = [], attribution = null } = {}) { this.account = account; this.dealers = dealers; this.attribution = attribution; }
  prepare(sql) { return new ReferenceStatement(this, sql); }
}

test('seller listing exposes only scoped safe projections', async () => {
  const sellers = await listTravelSellers(new ReferenceDb({ dealers: [{ id: 'dealer-internal', dealer_status: 'ACTIVE', permission_status: 'ACTIVE', permission_created_at: '2026-08-12T00:00:00.000Z' }] }), {
    secret: 'test-secret', workspaceId: 'workspace-a', lineAccountId: 'account-a',
  });
  assert.equal(sellers.length, 1);
  assert.deepEqual(Object.keys(sellers[0]).sort(), ['createdAt','permissionStatus','revokedAt','safeSellerReference','sellerEligible','sellerLabel'].sort());
  assert.equal(JSON.stringify(sellers).includes('dealer-internal'), false);
});

test('active Dealer plus active permission freezes trusted Referral seller', async () => {
  const seller = await resolveTrustedTravelSellerAttribution(new ReferenceDb({ attribution: {
    member_referral_attribution_id: 'referral-internal', seller_dealer_id: 'dealer-internal', seller_permission_id: 'permission-internal',
  } }), { secret: 'test-secret', workspaceId: 'workspace-a', lineAccountId: 'account-a', inviteeMemberId: 'member-internal', occurredAt: '2026-08-12T00:00:00.000Z' });
  assert.equal(seller.sellerDealerId, 'dealer-internal');
  assert.match(seller.safeSellerReference, /^tsr_/);
});

test('revoked or absent trusted permission resolves to no seller', async () => {
  const seller = await resolveTrustedTravelSellerAttribution(new ReferenceDb(), {
    secret: 'test-secret', workspaceId: 'workspace-a', lineAccountId: 'account-a', inviteeMemberId: 'member-internal', occurredAt: '2026-08-12T00:00:00.000Z',
  });
  assert.equal(seller, null);
});

class ProjectionStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, ' ').trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() {
    if (this.sql.startsWith('SELECT s.booking_id')) return this.db.context;
    if (this.sql.startsWith('SELECT id,line_account_id,conversion_type')) return this.db.conversion;
    if (this.sql.startsWith('SELECT id FROM conversion_referral_evidence')) return { id: 'evidence' };
    if (this.sql.startsWith('SELECT id FROM commission_attributions')) return { id: 'attribution' };
    if (this.sql.startsWith('SELECT id FROM commission_calculations')) return { id: 'calculation' };
    throw new Error(`Unexpected first: ${this.sql}`);
  }
  async run() {
    if (this.sql.startsWith('INSERT INTO line_conversion_events')) { this.db.conversion ||= { id: 'conversion', line_account_id: 'account', conversion_type: 'TRAVEL_BOOKING_FULLY_SETTLED', conversion_source: 'TRAVEL', value_minor: 12000, currency: 'TWD' }; return { meta: { changes: 1 } }; }
    if (this.sql.startsWith('INSERT INTO travel_seller_bridge_events')) { this.db.events.add(this.values[5]); return { meta: { changes: 1 } }; }
    throw new Error(`Unexpected run: ${this.sql}`);
  }
}
class ProjectionDb {
  constructor(context) { this.context = context; this.conversion = null; this.events = new Set(); }
  prepare(sql) { return new ProjectionStatement(this, sql); }
}

test('fully settled projection reuses existing Commission calculation and stays idempotent', async () => {
  const db = new ProjectionDb({ booking_id: 'booking', line_account_id: 'account', seller_dealer_id: 'dealer', member_referral_attribution_id: 'referral', commissionable_amount_minor_snapshot: 12000, currency_code_snapshot: 'TWD', booking_status: 'FULLY_PAID', order_status: 'PAID', payment_status: 'PAID' });
  const input = { secret: 'test-secret', workspaceId: 'workspace', orderId: 'order', occurredAt: '2026-08-12T00:00:00.000Z' };
  assert.equal((await projectTravelCommissionEligibility(db, input)).reason, 'ALREADY_ATTRIBUTED');
  assert.equal((await projectTravelCommissionEligibility(db, input)).reason, 'ALREADY_ATTRIBUTED');
  assert.equal(db.events.size, 1);
});

test('unsettled order produces no Travel commission eligibility', async () => {
  const db = new ProjectionDb({ booking_id: 'booking', line_account_id: 'account', commissionable_amount_minor_snapshot: 12000, currency_code_snapshot: 'TWD', booking_status: 'DEPOSIT_PAID', order_status: 'PENDING_PAYMENT', payment_status: 'PENDING' });
  assert.deepEqual(await projectTravelCommissionEligibility(db, { secret: 'test-secret', workspaceId: 'workspace', orderId: 'order', occurredAt: '2026-08-12T00:00:00.000Z' }), { projected: false, reason: 'ORDER_NOT_FULLY_SETTLED' });
  assert.equal(db.conversion, null);
});
