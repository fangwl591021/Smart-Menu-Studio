import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = () => readFile(new URL('../src/components/TenantSettlementPayoutPanel.jsx', import.meta.url), 'utf8');
const attribution = () => readFile(new URL('../src/components/CommissionAttributionPanel.jsx', import.meta.url), 'utf8');
const app = () => readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('tenant settlement panel consumes only scoped safe settlement APIs and renders all state actions', async () => {
  const source = await panel();
  for (const value of ['/api/line/account', '/api/commission-settlements?', '/api/commission-settlements/${encodeURIComponent(settlement.settlementId)}?', '/status?lineAccountId=', 'DRAFT', 'LOCKED', 'FINALIZED', 'CANCELLED', "status === 'DRAFT'", "status === 'LOCKED'", "'NO_ELIGIBLE_LEDGER_ENTRIES'", 'totalAmountMinor', 'currencyCode', 'entryCount', 'snapshotAt']) assert.ok(source.includes(value), `expected ${value}`);
  assert.ok(source.includes('formatCommissionMoney(row.totalAmountMinor, row.currencyCode)'));
  assert.match(source, /publicSafeLabel/);
  assert.equal(source.includes('reduce((sum'), false, 'UI must not aggregate monetary amounts across currencies');
});

test('tenant payout review permits only owner/admin requested transitions and safe rejection reasons', async () => {
  const source = await panel();
  for (const value of ['/api/commission-payout-requests?', '/api/commission-payout-requests/${encodeURIComponent(payout.requestId)}/status?', 'REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', "row.status === 'REQUESTED'", "updatePayout(row, 'APPROVED')", "updatePayout(row, 'REJECTED')", 'INVALID_REQUEST', 'SETTLEMENT_MISMATCH', 'DEALER_NOT_ELIGIBLE', 'DUPLICATE_REQUEST', 'OTHER_POLICY', 'publicSafeLabel']) assert.ok(source.includes(value), `expected ${value}`);
  assert.match(source, /const isManager = role => role === 'owner' \|\| role === 'admin'/);
  for (const forbidden of ['PAID', 'amountOverride', 'manual amount', 'settlementOverride', 'dealerOverride', 'payable', 'withdrawal']) assert.equal(source.includes(forbidden), false, `must not offer ${forbidden}`);
});

test('simulated payment UI exposes approved-only execution, safe attempt history, and no real payment controls', async () => {
  const source = await panel();
  for (const value of ['/api/commission-payment-attempts?', '/api/commission-payout-requests/${encodeURIComponent(payout.requestId)}/execute?', "row.status === 'APPROVED'", 'SIMULATED', 'INTERNAL_TEST', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_REJECTED', 'INVALID_PAYMENT_STATE', 'IDEMPOTENCY_CONFLICT', 'TECHNICAL_FAILURE', 'globalThis.crypto?.randomUUID?.()']) assert.ok(source.includes(value), `expected ${value}`);
  assert.ok(source.includes("SUCCEEDED: '"));
  assert.ok(source.includes("FAILED: '"));
  for (const forbidden of ['bankAccount', 'beneficiary', 'payoutDestination', 'providerSecret', 'rawProvider', 'paymentCredential', 'transferNow', 'realProvider', 'webhook', 'localStorage', 'sessionStorage']) assert.equal(source.includes(forbidden), false, `must not expose ${forbidden}`);
});

test('tenant panel is mounted only in Tenant Settings commission experience and leaves dealer self UI untouched', async () => {
  const [panelSource, attributionSource, appSource] = await Promise.all([panel(), attribution(), app()]);
  assert.match(attributionSource, /import TenantSettlementPayoutPanel from '\.\/TenantSettlementPayoutPanel'/);
  assert.match(attributionSource, /<TenantSettlementPayoutPanel request=\{request\} userRole=\{userRole\} \/>/);
  assert.match(appSource, /CommissionAttributionPanel request=\{authFetch\} userRole=\{activeRole\}/);
  for (const forbidden of ['lineUserId', 'line_identity_hash', 'memberId', 'customerIdentity', 'referral', 'evidenceId', 'calculationId', 'ledgerId', 'providerTransactionRef', 'idempotencyKeyHash', 'rawToken', 'bank', 'Points', 'Rewards']) assert.equal(panelSource.includes(forbidden), false, `must not render ${forbidden}`);
});
