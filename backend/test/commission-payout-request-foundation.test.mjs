import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PAYOUT_REJECTION_REASON_CODES, PAYOUT_REQUEST_STATUSES, canTransitionPayoutRequestStatus, isPayoutRejectionReasonCode, isPayoutRequestStatus, publicDealerPayoutRequestRow, publicPayoutRequestRow } from '../src/commission/payout-foundation.ts';

const migrationUrl = new URL('../migrations/0030_commission_payout_request_foundation.sql', import.meta.url);
const sourceUrl = new URL('../src/index.ts', import.meta.url);

test('payout request state machine contains no paid state and has deterministic terminal transitions', () => {
  assert.deepEqual(PAYOUT_REQUEST_STATUSES, ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED']);
  for (const [from, to] of [['REQUESTED', 'APPROVED'], ['REQUESTED', 'REJECTED'], ['REQUESTED', 'CANCELLED']]) assert.equal(canTransitionPayoutRequestStatus(from, to), true);
  for (const [from, to] of [['APPROVED', 'REJECTED'], ['APPROVED', 'CANCELLED'], ['REJECTED', 'APPROVED'], ['CANCELLED', 'REQUESTED'], ['REJECTED', 'CANCELLED']]) assert.equal(canTransitionPayoutRequestStatus(from, to), false);
  assert.equal(isPayoutRequestStatus('PAID'), false);
  assert.deepEqual(PAYOUT_REJECTION_REASON_CODES, ['INVALID_REQUEST', 'SETTLEMENT_MISMATCH', 'DEALER_NOT_ELIGIBLE', 'DUPLICATE_REQUEST', 'OTHER_POLICY']);
  assert.equal(isPayoutRejectionReasonCode('OTHER_POLICY'), true);
  assert.equal(isPayoutRejectionReasonCode('free_text'), false);
});

test('public tenant and dealer request projections preserve integer financial truth without identity exposure', () => {
  const tenant = publicPayoutRequestRow({ id: 'request_internal', settlement_id: 'settlement_internal', dealer_id: 'dealer_private', member_id: 'member_private', line_identity_hash: 'hash_private', status: 'REQUESTED', amount_minor: 1200, currency_code: 'TWD', requested_at: 'now' }, 2);
  const dealer = publicDealerPayoutRequestRow({ id: 'request_internal', settlement_id: 'settlement_internal', status: 'REQUESTED', amount_minor: 1200, currency_code: 'TWD', requested_at: 'now', line_identity_hash: 'hash_private' });
  assert.equal(tenant.publicSafeLabel, 'Dealer #3');
  assert.equal(Number.isInteger(tenant.amountMinor), true);
  for (const forbidden of ['dealer_private', 'member_private', 'hash_private']) assert.equal(JSON.stringify({ tenant, dealer }).includes(forbidden), false);
});

test('0030 is additive, request-only, and has database active-request authority', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  for (const required of ['CREATE TABLE IF NOT EXISTS commission_payout_requests', 'CREATE TABLE IF NOT EXISTS commission_payout_request_status_events', "status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')", "currency_code IN ('TWD')", 'commission_payout_requests_one_active_per_settlement_dealer', "RAISE(ABORT,'ACTIVE_PAYOUT_REQUEST_EXISTS')", "actor_type IN ('DEALER','TENANT_ADMIN')", 'idx_commission_payout_request_status_events_request_time']) assert.equal(migration.includes(required), true);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\b/im);
  for (const forbidden of ['paid_at', 'provider_payment', 'payment_reference', 'payment_attempt', 'bank_', 'withdraw', 'percentage', 'points', 'reward', 'line_identity_hash', 'access_token', 'referral_code', 'flow_token']) assert.equal(migration.toLowerCase().includes(forbidden), false);
});

test('dealer payout request APIs derive dealer ownership server-side from finalized immutable settlement items', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const slice = source.slice(source.indexOf("app.get('/api/member/dealer/payout-requests'"), source.indexOf("app.get('/api/commission-payout-requests'"));
  for (const route of ["app.get('/api/member/dealer/payout-requests'", "app.post('/api/member/dealer/payout-requests'", "app.post('/api/member/dealer/payout-requests/:requestId/cancel'"]) assert.equal(slice.includes(route), true);
  assert.match(source, /async function resolvedDealerPayoutContext[\s\S]*verifiedDealerLedgerMember/);
  assert.match(slice, /dealer\.status!=='ACTIVE'/);
  assert.match(slice, /SETTLEMENT_NOT_FINALIZED/);
  assert.match(slice, /FROM commission_settlement_items WHERE settlement_id=\? AND dealer_id=\?/);
  assert.match(slice, /COALESCE\(SUM\(amount_minor\),0\)/);
  assert.match(slice, /ACTIVE_PAYOUT_REQUEST_EXISTS/);
  assert.match(slice, /status='CANCELLED'/);
  for (const forbidden of ["body.dealerId", "body.memberId", "body.amount", "body.currency", 'lineUserId', 'line_identity_hash', 'liffAccessToken', 'referralFlowToken', 'commission_ledger_entries', 'commission_calculations', 'commission_attributions', 'member_referral_attributions', 'conversion_referral_evidence', 'payment', 'bank_', 'paid_at']) assert.equal(slice.includes(forbidden), false);
});

test('tenant payout request APIs are viewer-readable, admin-mutable, scoped, and only support approval or rejection', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const slice = source.slice(source.indexOf("app.get('/api/commission-payout-requests'"), source.indexOf("app.get('/api/commission-settlements'"));
  for (const route of ["app.get('/api/commission-payout-requests'", "app.get('/api/commission-payout-requests/:requestId'", "app.post('/api/commission-payout-requests/:requestId/status'"]) assert.equal(slice.includes(route), true);
  assert.match(slice, /requireRole\(c,'viewer'\)/);
  assert.match(slice, /requireRole\(c,'admin'\)/);
  assert.match(slice, /workspace_id=\? AND line_account_id=\?/);
  assert.match(slice, /next!==\'APPROVED\'&&next!==\'REJECTED\'/);
  assert.match(slice, /INVALID_REJECTION_REASON/);
  assert.match(slice, /commission_payout_request_status_events/);
  for (const forbidden of ['PAID', 'payment', 'bank_', 'withdraw', 'commission_settlements SET', 'UPDATE commission_settlement_items', 'UPDATE commission_ledger_entries', 'UPDATE commission_calculations', 'UPDATE commission_attributions', 'member_referral_attributions', 'conversion_referral_evidence', 'points', 'reward']) assert.equal(slice.includes(forbidden), false);
});

test('payout request history is append-only and rejected or cancelled requests can be replaced by a new request', async () => {
  const [migration, source] = await Promise.all([readFile(migrationUrl, 'utf8'), readFile(sourceUrl, 'utf8')]);
  assert.match(migration, /existing_request\.status IN \('REQUESTED','APPROVED'\)/);
  assert.match(source, /INSERT INTO commission_payout_request_status_events/);
  const payoutSlice = source.slice(source.indexOf('async function resolvedDealerPayoutContext'), source.indexOf("app.get('/api/commission-settlements'"));
  assert.doesNotMatch(payoutSlice, /DELETE FROM commission_payout_requests|DELETE FROM commission_payout_request_status_events/);
});
