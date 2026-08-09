import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { commissionLedgerPeriod, commissionLedgerSnapshot } from '../src/commission/ledger-read-api.ts';

function ledgerReadDb() {
  return { prepare(sql) { return { bind(...args) { return {
    async all() {
      if (sql.includes('substr(l.effective_at')) return { results: [{ day: '2026-08-10', currency_code: 'TWD', amount_minor: 1200, attribution_count: 2 }, { day: '2026-08-10', currency_code: 'USD', amount_minor: 30, attribution_count: 1 }] };
      if (sql.includes('SELECT l.program_id')) return { results: [{ program_id: 'program_a', program_name: 'Pilot', currency_code: 'TWD', amount_minor: 1200, attribution_count: 2 }] };
      if (sql.includes('SELECT l.dealer_id')) return { results: [{ dealer_id: 'dealer_internal', currency_code: 'TWD', amount_minor: 1200, attribution_count: 2 }] };
      if (sql.includes('SELECT l.currency_code')) return { results: [{ currency_code: 'TWD', amount_minor: 1200, attribution_count: 2 }, { currency_code: 'USD', amount_minor: 30, attribution_count: 1 }] };
      return { results: [], args };
    },
  }; } }; } };
}

test('ledger period supports 7d and defaults safely to 30d', () => {
  assert.equal(commissionLedgerPeriod('7d'), 7);
  assert.equal(commissionLedgerPeriod('30d'), 30);
  assert.equal(commissionLedgerPeriod('anything'), 30);
});

test('tenant ledger reads ledger truth with separate currency aggregates and effective-at trend', async () => {
  const snapshot = await commissionLedgerSnapshot(ledgerReadDb(), { workspaceId: 'workspace_a', lineAccountId: 'account_a', days: 7, now: new Date('2026-08-12T00:00:00.000Z') });
  assert.deepEqual(snapshot.earnedByCurrency, [{ currencyCode: 'TWD', amountMinor: 1200, attributionCount: 2 }, { currencyCode: 'USD', amountMinor: 30, attributionCount: 1 }]);
  assert.deepEqual(snapshot.trend, [{ date: '2026-08-10', currencyCode: 'TWD', amountMinor: 1200, attributionCount: 2 }, { date: '2026-08-10', currencyCode: 'USD', amountMinor: 30, attributionCount: 1 }]);
  assert.deepEqual(snapshot.programBreakdown, [{ programId: 'program_a', programName: 'Pilot', currencyCode: 'TWD', earnedAmountMinor: 1200, attributionCount: 2 }]);
  assert.deepEqual(snapshot.dealerBreakdown, [{ publicSafeLabel: 'Dealer #1', currencyCode: 'TWD', earnedAmountMinor: 1200, attributionCount: 2 }]);
  assert.equal(JSON.stringify(snapshot).includes('dealer_internal'), false);
  assert.equal(JSON.stringify(snapshot).includes('totalEarned'), false);
});

test('dealer scope preserves historical earned entries but never exposes internal identifiers', async () => {
  const snapshot = await commissionLedgerSnapshot(ledgerReadDb(), { workspaceId: 'workspace_a', lineAccountId: 'account_a', dealerId: 'dealer_internal', days: 30, now: new Date('2026-08-12T00:00:00.000Z') });
  assert.deepEqual(snapshot.dealerBreakdown, []);
  assert.deepEqual(snapshot.earnedByCurrency, [{ currencyCode: 'TWD', amountMinor: 1200, attributionCount: 2 }, { currencyCode: 'USD', amountMinor: 30, attributionCount: 1 }]);
  assert.equal(JSON.stringify(snapshot).includes('dealer_internal'), false);
});

test('read-only routes use ledger source truth, server identity, tenant scope, and never expose payout semantics', async () => {
  const [source, readModel] = await Promise.all([
    readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/commission/ledger-read-api.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(readModel, /FROM commission_ledger_entries l/);
  assert.match(readModel, /l\.entry_type='COMMISSION_EARNED'/);
  assert.match(readModel, /l\.effective_at>=\? AND l\.effective_at<=\?/);
  assert.match(readModel, /GROUP BY l\.currency_code/);
  assert.match(readModel, /GROUP BY substr\(l\.effective_at,1,10\),l\.currency_code/);
  const tenant = source.slice(source.indexOf("app.get('/api/commission-ledger'"), source.indexOf("app.get('/api/commission-attributions'"));
  assert.match(tenant, /requireRole\(c,'viewer'\)/);
  assert.match(tenant, /commissionProgramAccount/);
  assert.match(tenant, /scopedCommissionProgram/);
  const self = source.slice(source.indexOf("app.get('/api/member/dealer/commission-ledger'"), source.indexOf("app.post('/api/member/conversion-referral-context'"));
  assert.match(source, /async function verifiedDealerLedgerMember/);
  assert.match(self, /verifiedDealerLedgerMember/);
  assert.match(self, /member_id=\? LIMIT 1/);
  assert.match(self, /NOT_ENROLLED/);
  assert.doesNotMatch(self, /req\.query\('dealerId'\)/);
  for (const restricted of ['lineUserId', 'line_identity_hash', 'attributionId', 'calculationId', 'ledgerEntryId', 'availableBalance', 'payable', 'withdrawable', 'paid', 'settled', 'payout', 'INSERT ', 'UPDATE ', 'DELETE ']) assert.equal(self.includes(restricted), false);
  for (const restricted of ['INSERT ', 'UPDATE ', 'DELETE ', 'calculateCommissionForAttribution', 'establishCommissionAttribution', 'establishConversionReferralEvidence', 'member_referral_attributions', 'conversion_referral_evidence', 'payout', 'settlement', 'points', 'reward']) assert.equal(tenant.includes(restricted), false);
});
