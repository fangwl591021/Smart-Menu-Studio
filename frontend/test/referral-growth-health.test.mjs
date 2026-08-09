import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = () => readFile(new URL('../src/components/ReferralGrowthHealthPanel.jsx', import.meta.url), 'utf8');
const app = () => readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('system admin referral growth health renders aggregate metrics, states and safe nulls', async () => {
  const source = await panel();
  for (const value of ['Referral Growth Ready', 'LIFF Ready Tenant Count', 'Referral Active Tenant Count', 'Qualified Referral Count', 'Funnel Health Summary', 'Stale Growth Tenant Count', 'Last Referral Growth Activity', 'landings', 'qualified', 'overallQualificationRate', 'lastReferralGrowthActivityAt', 'READY', 'NO_REFERRAL_DATA', 'LIFF_NOT_READY', 'INSUFFICIENT_REFERRAL_ACTIVITY', 'STALE_DATA']) assert.ok(source.includes(value));
  assert.match(source, /value\s*==\s*null\s*\?\s*'—'/);
  assert.match(source, /value \? new Date\(value\).*: '—'/);
  assert.match(source, /loading/);
  assert.match(source, /error/);
  assert.match(source, /onClick=\{load\}/);
});

test('referral growth health remains system-admin-only and never renders member data', async () => {
  const [panelSource, appSource] = await Promise.all([panel(), app()]);
  assert.match(appSource, /currentView === 'intelligence-health' && isPlatformAdminMode/);
  assert.match(appSource, /ReferralGrowthHealthPanel request=\{authFetch\}/);
  const tenantSettings = appSource.slice(appSource.indexOf("{currentView === 'settings' && !isPlatformAdminMode"), appSource.indexOf("{currentView === 'ai-usage'"));
  assert.equal(tenantSettings.includes('ReferralGrowthHealthPanel'), false);
  for (const forbidden of ['memberId', 'lineUserId', 'line_identity_hash', 'referralCode', 'referralFlowToken', 'dedupeKey', 'fingerprint', 'Top Contributors', 'Top Referrers', 'Member leaderboard', 'member_referral_events', 'member_referral_attributions']) assert.equal(panelSource.includes(forbidden), false, `must not render ${forbidden}`);
});
