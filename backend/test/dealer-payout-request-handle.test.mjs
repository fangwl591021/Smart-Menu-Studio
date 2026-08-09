import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDealerPayoutRequestHandle, dealerPayoutRequestHandleReference, verifyDealerPayoutRequestHandle } from '../src/commission/dealer-payout-request-handle.ts';
import { publicDealerPayoutRequestRow } from '../src/commission/payout-foundation.ts';
import { publicDealerPaymentStatusRow } from '../src/commission/payment-execution.ts';

const sourceUrl = new URL('../src/index.ts', import.meta.url);
const secret = 'test-only-dealer-payout-request-handle-secret';
const own = { workspaceId: 'workspace_private_a', lineAccountId: 'line_private_a', dealerId: 'dealer_private_a', payoutRequestId: 'request_private_a' };
const decode = token => atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(token.split('.')[0].length / 4) * 4, '='));

test('opaque payout request handle is signed, expiring, scoped, and has no raw internal ID', async () => {
  const token = await createDealerPayoutRequestHandle(secret, own, 120);
  for (const value of Object.values(own)) assert.equal(decode(token).includes(value), false);
  const verified = await verifyDealerPayoutRequestHandle(secret, token);
  assert.equal(verified.reference, await dealerPayoutRequestHandleReference(secret, own));
  await assert.rejects(() => verifyDealerPayoutRequestHandle(secret, `${token}x`), /DEALER_PAYOUT_REQUEST_HANDLE_INVALID/);
  const expired = await createDealerPayoutRequestHandle(secret, own, -1);
  await assert.rejects(() => verifyDealerPayoutRequestHandle(secret, expired), /DEALER_PAYOUT_REQUEST_HANDLE_EXPIRED/);
  for (const mismatch of [{ dealerId: 'dealer_private_b' }, { workspaceId: 'workspace_private_b' }, { lineAccountId: 'line_private_b' }, { payoutRequestId: 'request_private_b' }]) assert.notEqual(verified.reference, await dealerPayoutRequestHandleReference(secret, { ...own, ...mismatch }));
});

test('Dealer public payout and payment projections hide raw financial identifiers', () => {
  const payout = publicDealerPayoutRequestRow({ id: own.payoutRequestId, settlement_id: 'settlement_private_a', status: 'REQUESTED', amount_minor: 1200, currency_code: 'TWD', requested_at: 'now' });
  const payment = publicDealerPaymentStatusRow({ payout_request_id: own.payoutRequestId, payout_request_status: 'APPROVED', payment_status: 'SUCCEEDED', amount_minor: 1200, currency_code: 'TWD' });
  for (const hidden of [own.payoutRequestId, 'settlement_private_a']) assert.equal(JSON.stringify({ payout, payment }).includes(hidden), false);
  assert.equal(payout.status, 'REQUESTED'); assert.equal(payout.amountMinor, 1200); assert.equal(payment.executionMode, 'SIMULATED');
});

test('Dealer payout handle routes use verified scope, opaque cancel input, and preserve business status authority', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const start = source.indexOf("app.get('/api/member/dealer/payout-requests'");
  const end = source.indexOf("app.get('/api/commission-payout-requests'", start);
  const slice = source.slice(start, end);
  for (const required of ["app.get('/api/member/dealer/payout-requests'", "app.post('/api/member/dealer/payout-requests/cancel'", 'payoutRequestHandle', 'createDealerPayoutRequestHandle', 'verifyDealerPayoutRequestHandle', 'dealerPayoutRequestHandleReference', 'resolvedDealerPayoutContext(c)', "row.status!=='REQUESTED'", "status='CANCELLED'", 'workspace_id=? AND line_account_id=? AND dealer_id=?']) assert.equal((slice + source).includes(required), true, `missing ${required}`);
  for (const forbidden of ["app.post('/api/member/dealer/payout-requests/:requestId/cancel'", 'c.req.param(\'requestId\')', 'body.requestId', 'body.settlementId', 'body.dealerId', 'body.memberId', 'body.amount', 'body.currency', 'lineUserId', 'line_identity_hash', 'bank_', 'provider_secret', 'payment attempts SET', 'commission_settlements SET', 'commission_ledger_entries SET', 'commission_calculations SET', 'commission_attributions SET']) assert.equal(slice.includes(forbidden), false, `must not contain ${forbidden}`);
  for (const terminal of ['APPROVED', 'REJECTED', 'CANCELLED']) assert.equal("row.status!=='REQUESTED'".includes(terminal), false);
});
