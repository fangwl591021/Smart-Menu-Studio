import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { commissionAttributionPeriod, commissionAttributionSnapshot } from '../src/commission/read-api.ts';

function readDb() {
  return { prepare(sql) { return { bind(...args) { return {
    async first() { return sql.includes('SELECT COUNT(*)') ? { count: 3 } : null; },
    async all() {
      if (sql.includes('substr(c.occurred_at')) return { results: [{ day: '2026-08-10', count: 2 }, { day: '2026-08-11', count: 1 }] };
      if (sql.includes('SELECT a.program_id')) return { results: [{ program_id: 'program_1', program_name: 'Pilot', count: 3 }] };
      if (sql.includes('SELECT a.dealer_id')) return { results: [{ dealer_id: 'dealer_internal', count: 3 }] };
      if (sql.includes('SELECT a.attribution_source')) return { results: [
        { source: 'REFERRAL_EVIDENCE', source_domain: null, count: 1 },
        { source: 'REFERRAL_EVIDENCE', source_domain: 'TRAVEL', count: 2 },
      ] };
      if (sql.includes('SELECT a.id attribution_id')) return { results: [
        { attribution_id: 'attribution_1', program_id: 'program_1', program_name: 'Pilot', attribution_source: 'REFERRAL_EVIDENCE', source_domain: 'TRAVEL', occurred_at: '2026-08-11T10:00:00.000Z', attributed_at: '2026-08-11T10:00:01.000Z' },
        { attribution_id: 'attribution_2', program_id: 'program_1', program_name: 'Pilot', attribution_source: 'REFERRAL_EVIDENCE', source_domain: 'CAMPAIGN_RAW_VALUE', occurred_at: '2026-08-10T10:00:00.000Z', attributed_at: '2026-08-10T10:00:01.000Z' },
      ] };
      return { results: [], args };
    },
  }; } }; } };
}

test('period contract supports 7d and defaults safely to 30d', () => {
  assert.equal(commissionAttributionPeriod('7d'), 7);
  assert.equal(commissionAttributionPeriod('30d'), 30);
  assert.equal(commissionAttributionPeriod('arbitrary'), 30);
});

test('tenant snapshot uses conversion occurrence time and returns only safe aggregate/read fields', async () => {
  const snapshot = await commissionAttributionSnapshot(readDb(), { workspaceId: 'workspace_a', lineAccountId: 'account_a', days: 7, now: new Date('2026-08-12T00:00:00.000Z') });
  assert.deepEqual(snapshot.summary, { attributedConversions: 3 });
  assert.deepEqual(snapshot.trend, [{ day: '2026-08-10', attributedConversions: 2 }, { day: '2026-08-11', attributedConversions: 1 }]);
  assert.deepEqual(snapshot.programs, [{ programId: 'program_1', programName: 'Pilot', attributedConversions: 3 }]);
  assert.deepEqual(snapshot.dealers, [{ publicSafeLabel: 'Dealer #1', attributedConversions: 3 }]);
  assert.deepEqual(snapshot.sources, [
    { attributionSource: 'REFERRAL_EVIDENCE', sourceDomain: null, attributedConversions: 1 },
    { attributionSource: 'REFERRAL_EVIDENCE', sourceDomain: 'TRAVEL', attributedConversions: 2 },
  ]);
  assert.equal(snapshot.recent[0].conversionCategory, 'CONVERSION');
  assert.equal(snapshot.recent[0].attributionSource, 'REFERRAL_EVIDENCE');
  assert.equal(snapshot.recent[0].sourceDomain, 'TRAVEL');
  assert.equal(snapshot.recent[1].sourceDomain, null);
  assert.equal(snapshot.sources.reduce((total, source) => total + source.attributedConversions, 0), snapshot.summary.attributedConversions);
  assert.match(JSON.stringify(snapshot), /\"sourceDomain\":\"TRAVEL\"/);
  assert.doesNotMatch(JSON.stringify(snapshot), /CAMPAIGN_RAW_VALUE/);
  for (const forbidden of ['dealer_internal', 'member_', 'evidence_', 'referral_', 'token', 'amount', 'currency', 'balance', 'payout']) assert.equal(JSON.stringify(snapshot).includes(forbidden), false);
});

test('source projection derives only the approved domain and keeps mixed attribution sources separated', async () => {
  const source = await readFile(new URL('../src/commission/read-api.ts', import.meta.url), 'utf8');
  assert.match(source, /CASE WHEN c\.conversion_source='TRAVEL' THEN 'TRAVEL' ELSE NULL END/);
  assert.match(source, /GROUP BY a\.attribution_source,\$\{safeSourceDomain\}/);
  assert.match(source, /sourceDomain: sourceDomain\(row\.source_domain\)/);
  assert.doesNotMatch(source, /sourceDomain:\s*(?:String\()?row\.conversion_source/);
});

test('dealer-scoped snapshot has own-only aggregates and no recent internal records', async () => {
  const snapshot = await commissionAttributionSnapshot(readDb(), { workspaceId: 'workspace_a', lineAccountId: 'account_a', dealerId: 'dealer_internal', days: 30, now: new Date('2026-08-12T00:00:00.000Z') });
  assert.equal(snapshot.summary.attributedConversions, 3);
  assert.deepEqual(snapshot.recent, []);
  assert.equal(JSON.stringify(snapshot).includes('dealer_internal'), false);
});

test('read-only routes scope account/program, derive dealer identity server-side, and expose no restricted data', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  for (const route of ["app.get('/api/commission-attributions'", "app.get('/api/member/dealer/commission-attributions'"]) assert.equal(source.includes(route), true);
  const tenant = source.slice(source.indexOf("app.get('/api/commission-attributions'"), source.indexOf("app.get('/api/member/dealer/commission-attributions'"));
  assert.match(tenant, /requireRole\(c,'viewer'\)/);
  assert.match(tenant, /workspace_id=\? AND line_account_id=\?/);
  assert.match(tenant, /programId&&!await db\.prepare\('SELECT id FROM commission_programs WHERE id=\? AND workspace_id=\? AND line_account_id=\? LIMIT 1'\)/);
  const self = source.slice(source.indexOf("app.get('/api/member/dealer/commission-attributions'"), source.indexOf("app.get('/api/member/dealer/commission-ledger'"));
  assert.match(self, /verifiedReferralMember/);
  assert.match(self, /member_id=\? LIMIT 1/);
  assert.match(self, /NOT_ENROLLED/);
  assert.match(self, /return c\.json\(\{success:true,status:'ENROLLED',period:snapshot\.period,summary:snapshot\.summary,trend:snapshot\.trend,programs:snapshot\.programs\.map\(\(row:any\)=>\(\{programName:row\.programName,attributedConversions:row\.attributedConversions\}\)\),sources:snapshot\.sources\}\)/);
  for (const forbidden of ['referralAttribution', 'evidenceId', 'conversionEventId', 'amount', 'currency', 'balance', 'payout', 'points', 'reward', 'INSERT ', 'UPDATE ', 'DELETE ', 'referralFlowToken']) assert.equal(self.includes(forbidden), false);
  for (const forbidden of ['INSERT ', 'UPDATE ', 'DELETE ', 'establishCommissionAttribution', 'establishConversionReferralEvidence']) assert.equal(tenant.includes(forbidden), false);
});
