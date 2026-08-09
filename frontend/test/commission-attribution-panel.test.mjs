import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = () => readFile(new URL('../src/components/CommissionAttributionPanel.jsx', import.meta.url), 'utf8');
const app = () => readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('tenant attribution panel uses the scoped read API, periods and backend aggregates', async () => {
  const source = await panel();
  for (const value of ['/api/line/account', '/api/commission-attributions?', "['7d', '30d']", 'attributedConversions', 'trend', 'programs', 'dealers', 'publicSafeLabel', '目前尚無已歸因轉換', '推薦證據']) assert.ok(source.includes(value));
  assert.match(source, /lineAccountId: accountBody\.account\.id/);
  assert.match(source, /programId\) query\.set\('programId', programId\)/);
});

test('tenant attribution panel remains privacy-safe, read-only and non-monetary', async () => {
  const source = await panel();
  const attributionOnly = source.slice(source.indexOf('export default function'), source.indexOf('<TenantSettlementPayoutPanel'));
  for (const forbidden of ['memberId', 'lineUserId', 'line_identity_hash', 'inviter', 'invitee', 'referralFlowToken', 'dedupeKey', 'contextFingerprint', 'conversionPayload', 'Force Assign', 'Override', 'Retry Attribution', 'Delete Attribution', 'payout', 'settlement', 'balance', 'currency', 'Points', 'Rewards']) assert.equal(attributionOnly.includes(forbidden), false, `must not include ${forbidden}`);
  assert.equal(source.includes('recent'), false, 'API has no per-row safe Dealer label, so no recent list may be inferred');
});

test('tenant settings contains the attribution panel without adding it to member or admin views', async () => {
  const source = await app();
  assert.match(source, /CommissionAttributionPanel request=\{authFetch\} userRole=\{activeRole\}/);
  const health = source.slice(source.indexOf("{currentView === 'intelligence-health'"), source.indexOf("{currentView === 'templates'"));
  assert.equal(health.includes('CommissionAttributionPanel'), false);
});
