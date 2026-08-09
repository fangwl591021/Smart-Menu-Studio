import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { INTERNAL_TEST_PROVIDER, PAYMENT_ATTEMPT_STATUSES, PAYMENT_FAILURE_REASON_CODES, canTransitionPaymentAttemptStatus, internalTestPaymentProvider, isPaymentAttemptStatus, paymentIdempotencyKeyHash, publicDealerPaymentStatusRow, publicPaymentAttemptRow } from '../src/commission/payment-execution.ts';

const migrationUrl = new URL('../migrations/0031_commission_payment_execution_foundation.sql', import.meta.url);
const sourceUrl = new URL('../src/index.ts', import.meta.url);

test('payment attempt state machine is deterministic and execution is explicitly simulated', async () => {
  assert.equal(INTERNAL_TEST_PROVIDER, 'INTERNAL_TEST');
  assert.deepEqual(PAYMENT_ATTEMPT_STATUSES, ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
  for (const [from, to] of [['PENDING', 'PROCESSING'], ['PENDING', 'CANCELLED'], ['PROCESSING', 'SUCCEEDED'], ['PROCESSING', 'FAILED']]) assert.equal(canTransitionPaymentAttemptStatus(from, to), true);
  for (const [from, to] of [['SUCCEEDED', 'PROCESSING'], ['FAILED', 'PROCESSING'], ['CANCELLED', 'PROCESSING'], ['PENDING', 'SUCCEEDED'], ['PROCESSING', 'PENDING']]) assert.equal(canTransitionPaymentAttemptStatus(from, to), false);
  assert.equal(isPaymentAttemptStatus('PAID'), false);
  assert.deepEqual(await internalTestPaymentProvider.executePayment({ amountMinor: 100, currencyCode: 'TWD' }), { status: 'SUCCEEDED', providerTransactionRef: 'simulated_100_TWD' });
  assert.deepEqual(await internalTestPaymentProvider.executePayment({ amountMinor: 100, currencyCode: 'TWD', outcome: 'FAILED' }), { status: 'FAILED', failureReasonCode: 'TECHNICAL_FAILURE' });
  assert.equal(PAYMENT_FAILURE_REASON_CODES.includes('TECHNICAL_FAILURE'), true);
});

test('idempotency hashes are deterministic, scope-bound, and do not retain the raw key', async () => {
  const input = { workspaceId: 'ws_a', lineAccountId: 'line_a', payoutRequestId: 'request_a', key: 'opaque-client-key' };
  const hash = await paymentIdempotencyKeyHash(input);
  assert.equal(hash, await paymentIdempotencyKeyHash(input));
  assert.notEqual(hash, await paymentIdempotencyKeyHash({ ...input, workspaceId: 'ws_b' }));
  assert.equal(hash.includes(input.key), false);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('public payment projections retain integer amount and do not expose identity, raw hash, or provider references', () => {
  const attempt = publicPaymentAttemptRow({ id: 'attempt_internal', payout_request_id: 'payout_internal', attempt_no: 1, status: 'SUCCEEDED', amount_minor: 1200, idempotency_key_hash: 'hash_hidden', provider_transaction_ref: 'ref_hidden' });
  const dealer = publicDealerPaymentStatusRow({ payout_request_id: 'payout_internal', payout_request_status: 'APPROVED', payment_status: 'SUCCEEDED', amount_minor: 1200, line_identity_hash: 'identity_hidden' });
  assert.equal(Number.isInteger(attempt.amountMinor), true);
  assert.equal(attempt.executionMode, 'SIMULATED');
  for (const hidden of ['hash_hidden', 'ref_hidden', 'identity_hidden']) assert.equal(JSON.stringify({ attempt, dealer }).includes(hidden), false);
});

test('0031 is additive, simulated-only, append-only, and one success per payout request is database-enforced', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  for (const required of ['CREATE TABLE IF NOT EXISTS commission_payment_attempts', 'CREATE TABLE IF NOT EXISTS commission_payment_attempt_status_events', 'CREATE TABLE IF NOT EXISTS commission_payment_transactions', "provider_code IN ('INTERNAL_TEST')", "status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED')", 'UNIQUE(payout_request_id,attempt_no)', 'UNIQUE(payout_request_id,idempotency_key_hash)', 'payout_request_id TEXT NOT NULL UNIQUE', 'idx_commission_payment_attempt_status_events_attempt_time']) assert.equal(migration.includes(required), true);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\b/im);
  for (const forbidden of ['paid_at', 'bank_', 'stripe', 'line pay', 'ecpay', 'newebpay', 'payment_secret', 'access_token', 'provider_payload', 'webhook', 'percentage', 'points', 'reward', 'line_identity_hash']) assert.equal(migration.toLowerCase().includes(forbidden), false);
});

test('tenant execution is approved-only, admin-only, idempotent, and cannot mutate settlement or financial truth', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const slice = source.slice(source.indexOf("app.get('/api/member/dealer/payment-status'"), source.indexOf("app.get('/api/member/dealer/payout-requests'"));
  for (const route of ["app.get('/api/commission-payment-attempts'", "app.get('/api/commission-payment-attempts/:attemptId'", "app.post('/api/commission-payout-requests/:requestId/execute'", "app.get('/api/member/dealer/payment-status'"]) assert.equal(slice.includes(route), true);
  assert.match(slice, /requireRole\(c,'admin'\)/);
  assert.match(slice, /payout\.status!==\'APPROVED\'/);
  assert.match(slice, /paymentIdempotencyKeyHash/);
  assert.match(slice, /PAYMENT_ALREADY_SUCCEEDED/);
  assert.match(slice, /attemptNo=Number\(previous\?\.attempt_no\|\|0\)\+1/);
  assert.match(slice, /internalTestPaymentProvider\.executePayment/);
  assert.match(slice, /executionMode:'SIMULATED'/);
  for (const forbidden of ['fetch(', 'provider_secret', 'bank_', 'stripe', 'line pay', 'webhook', 'UPDATE commission_payout_requests SET amount', 'UPDATE commission_settlements', 'UPDATE commission_settlement_items', 'UPDATE commission_ledger_entries', 'UPDATE commission_calculations', 'UPDATE commission_attributions', 'member_referral_attributions', 'conversion_referral_evidence', 'rawProvider', 'points', 'reward']) assert.equal(slice.toLowerCase().includes(forbidden.toLowerCase()), false);
});

test('dealer payment status is read-only and derived from verified dealer context', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const slice = source.slice(source.indexOf("app.get('/api/member/dealer/payment-status'"), source.indexOf("app.get('/api/commission-payment-attempts'"));
  assert.match(slice, /resolvedDealerPayoutContext/);
  assert.match(slice, /status:'NOT_ENROLLED'/);
  assert.doesNotMatch(slice, /app\.post\('\/api\/member\/dealer\/payment-status|executePayment\(/);
});
