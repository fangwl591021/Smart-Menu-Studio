import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDealerSettlementHandle, dealerSettlementHandleReference, publicDealerSettlementRow, verifyDealerSettlementHandle } from '../src/commission/dealer-settlement-read.ts';
const sourceUrl = new URL('../src/index.ts', import.meta.url);
const helperUrl = new URL('../src/commission/dealer-settlement-read.ts', import.meta.url);
const secret = 'test-only-dealer-settlement-handle-secret';
const own = { workspaceId: 'workspace_internal_a', lineAccountId: 'line_internal_a', dealerId: 'dealer_internal_a', settlementId: 'settlement_internal_a' };
const decoded = token => atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(token.split('.')[0].length / 4) * 4, '='));
test('opaque dealer settlement handle is signed, expiring, scoped, and contains no raw IDs', async () => {
  const token = await createDealerSettlementHandle(secret, own, 120); const payload = decoded(token);
  for (const value of Object.values(own)) assert.equal(payload.includes(value), false);
  const verified = await verifyDealerSettlementHandle(secret, token);
  assert.equal(verified.reference, await dealerSettlementHandleReference(secret, own)); assert.match(verified.reference, /^[a-f0-9]{64}$/);
  await assert.rejects(() => verifyDealerSettlementHandle(secret, `${token}x`), /DEALER_SETTLEMENT_HANDLE_INVALID/);
  const expired = await createDealerSettlementHandle(secret, own, -1); await assert.rejects(() => verifyDealerSettlementHandle(secret, expired), /DEALER_SETTLEMENT_HANDLE_EXPIRED/);
  for (const mismatch of [{ dealerId: 'dealer_internal_b' }, { workspaceId: 'workspace_internal_b' }, { lineAccountId: 'line_internal_b' }]) assert.notEqual(verified.reference, await dealerSettlementHandleReference(secret, { ...own, ...mismatch }));
});
test('public dealer settlement response only contains safe aggregates and opaque handle', async () => {
  const handle = await createDealerSettlementHandle(secret, own); const row = publicDealerSettlementRow({ periodStart: '2026-08-01', periodEnd: '2026-08-08', finalizedAt: '2026-08-09T00:00:00.000Z', snapshotAt: '2026-08-09T00:00:00.000Z', amountMinor: 1200, currencyCode: 'TWD', entryCount: 3, settlementHandle: handle });
  assert.equal(row.amountMinor, 1200); assert.equal(row.currencyCode, 'TWD'); assert.equal(row.entryCount, 3); assert.equal(row.settlementHandle, handle); for (const hidden of Object.values(own)) assert.equal(JSON.stringify(row).includes(hidden), false);
});
test('Dealer Self settlement route is verified-context-only, finalized-only, scoped, and read-only', async () => {
  const [source, helper] = await Promise.all([readFile(sourceUrl, 'utf8'), readFile(helperUrl, 'utf8')]); const slice = source.slice(source.indexOf("app.get('/api/member/dealer/settlements'"), source.indexOf("app.get('/api/member/dealer/payment-status'"));
  for (const required of ["app.get('/api/member/dealer/settlements'", 'resolvedDealerPayoutContext(c)', "commissionLedgerPeriod(c.req.query('period'))", "s.status='FINALIZED'", 'commission_settlement_items', 'commission_settlements', 'commission_settlement_periods', 'createDealerSettlementHandle', 'publicDealerSettlementRow', "status:'NOT_ENROLLED'", 'settlementCount', 'earnedByCurrency', 'itemCount']) assert.equal((slice + source + helper).includes(required), true, `expected ${required}`);
  for (const forbidden of ['body.dealerId', 'body.memberId', 'lineUserId', 'line_identity_hash', 'UPDATE ', 'INSERT INTO ', 'DELETE FROM ', 'commission_payout_requests SET', 'commission_payment_attempts SET', 'commission_ledger_entries SET', 'commission_calculations SET', 'commission_attributions SET', 'member_referral_attributions SET']) assert.equal(slice.includes(forbidden), false, `must not contain ${forbidden}`);
});
test('dealer payout creation accepts only opaque handle and resolves it against current verified scope', async () => {
  const [source, helper] = await Promise.all([readFile(sourceUrl, 'utf8'), readFile(helperUrl, 'utf8')]); const slice = source.slice(source.indexOf("app.post('/api/member/dealer/payout-requests'"), source.indexOf("app.post('/api/member/dealer/payout-requests/:requestId/cancel'"));
  for (const required of ['settlementHandle', 'SETTLEMENT_HANDLE_REQUIRED', 'verifyDealerSettlementHandle', 'dealerFinalizedSettlementRows', 'dealerSettlementHandleReference', 'SETTLEMENT_HANDLE_INVALID', "dealer.status!=='ACTIVE'", "settlement.status!=='FINALIZED'", 'FROM commission_settlement_items WHERE settlement_id=? AND dealer_id=?']) assert.equal(slice.includes(required), true, `expected ${required}`);
  for (const forbidden of ['body.settlementId', 'body.dealerId', 'body.memberId', 'body.amount', 'body.currency', 'lineUserId', 'line_identity_hash', 'payment', 'bank_', 'paid_at']) assert.equal(slice.includes(forbidden), false, `must not contain ${forbidden}`);
});
