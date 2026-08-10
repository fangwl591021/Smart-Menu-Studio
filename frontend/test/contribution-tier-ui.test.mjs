import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const tenantUrl = new URL('../src/components/ContributionTierPanel.jsx', import.meta.url);
const memberUrl = new URL('../src/components/MemberContributionTierPanel.jsx', import.meta.url);
const appUrl = new URL('../src/App.jsx', import.meta.url);
const liffUrl = new URL('../src/components/LiffReferralPage.jsx', import.meta.url);

test('Tenant Contribution and Tier UI uses the existing rules and aggregate summary endpoints', async () => {
  const source = await readFile(tenantUrl, 'utf8');
  for (const text of ['/api/contribution-rules', '/api/tier-rules', '/api/contribution-summary', 'lineAccountId', '7d', '30d', 'totalContributionScore', 'dailyTrend', 'eventTypeBreakdown', 'tierDistribution']) assert.equal(source.includes(text), true);
  for (const tier of ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']) assert.equal(source.includes(tier), true);
  assert.match(source, /editableRole/);
  assert.doesNotMatch(source, /memberId|line_identity_hash|source_ref|manual.*override/i);
});

test('Tenant mutation controls are role-gated and create versioned rules only', async () => {
  const source = await readFile(tenantUrl, 'utf8');
  assert.match(source, /\['owner', 'admin'\]/);
  assert.match(source, /POST/);
  assert.match(source, /新增規則版本/);
  assert.match(source, /新增等級版本/);
  assert.match(source, /Editor \/ viewer 僅可檢視規則/);
  assert.doesNotMatch(source, /method:\s*['"](?:DELETE|PATCH|PUT)['"]|manual.*score/i);
});

test('Member UI reads only verified-LIFF self contribution projection and renders backend tier truth', async () => {
  const source = await readFile(memberUrl, 'utf8');
  for (const text of ['/api/member/contribution', 'Authorization', 'contributionScore', 'currentTier', 'nextTier', 'scoreToNextTier', 'recentHistory', 'eventTypeBreakdown']) assert.equal(source.includes(text), true);
  assert.match(source, /data\.currentTier/);
  assert.doesNotMatch(source, /memberId|sourceRef|line_identity_hash|localStorage|sessionStorage|indexedDB/i);
});

test('Contribution terminology and tier-boundary copy keep Points, benefits, and financial privileges separate', async () => {
  const tenant = await readFile(tenantUrl, 'utf8');
  const member = await readFile(memberUrl, 'utf8');
  assert.match(tenant, /貢獻分數與點數分開計算/);
  assert.match(member, /不包含折扣、額外點數、佣金或金流權益/);
  assert.doesNotMatch(`${tenant}\n${member}`, /VIP discount|reward multiplier|commission bonus|payout privilege|cash benefit/i);
});

test('existing Settings and LIFF referral experiences retain Points Rewards and insert Contribution Tier panels', async () => {
  const [app, liff] = await Promise.all([readFile(appUrl, 'utf8'), readFile(liffUrl, 'utf8')]);
  assert.match(app, /RewardRedemptionPanel[\s\S]*ContributionTierPanel/);
  assert.match(liff, /MemberRewardRedemptionPanel[\s\S]*MemberContributionTierPanel/);
  assert.match(liff, /DealerSettlementPayoutPanel/);
});
