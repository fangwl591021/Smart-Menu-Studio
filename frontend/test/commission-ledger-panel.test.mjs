import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ledger = () => readFile(new URL('../src/components/CommissionLedgerPanel.jsx', import.meta.url), 'utf8');
const attribution = () => readFile(new URL('../src/components/CommissionAttributionPanel.jsx', import.meta.url), 'utf8');

test('tenant ledger panel uses scoped read API, periods and backend aggregates', async () => {
  const source = await ledger();
  for (const value of ['/api/line/account', '/api/commission-ledger?', "['7d', '30d']", 'earnedByCurrency', 'amountMinor', 'currencyCode', 'attributionCount', 'trend', 'programBreakdown', 'dealerBreakdown', 'publicSafeLabel', '目前尚無已賺佣金紀錄。']) assert.ok(source.includes(value), `expected ${value}`);
  assert.match(source, /lineAccountId: accountBody\.account\.id/);
  assert.match(source, /MINOR_UNIT_DIGITS = \{ TWD: 0 \}/);
  assert.equal(source.includes('reduce('), false, 'currencies must not be consolidated into one total');
});

test('tenant ledger remains privacy-safe and read-only', async () => {
  const source = await ledger();
  for (const forbidden of ['memberId', 'lineUserId', 'line_identity_hash', 'inviter', 'invitee', 'customerIdentity', 'referralAttributionId', 'evidenceId', 'contextId', 'calculationId', 'ledgerId', 'rawToken', 'conversionPayload', 'manual credit', 'manual debit', 'recalculate', 'delete ledger', 'adjustment', 'reversal']) assert.equal(source.includes(forbidden), false, `must not include ${forbidden}`);
});

test('tenant settings attribution experience mounts the ledger panel', async () => {
  const source = await attribution();
  assert.match(source, /import CommissionLedgerPanel from '\.\/CommissionLedgerPanel'/);
  assert.match(source, /<CommissionLedgerPanel request=\{request\} \/>/);
});
