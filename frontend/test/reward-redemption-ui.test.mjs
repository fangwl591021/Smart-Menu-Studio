import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const tenantUrl = new URL('../src/components/RewardRedemptionPanel.jsx', import.meta.url);
const memberUrl = new URL('../src/components/MemberRewardRedemptionPanel.jsx', import.meta.url);
const appUrl = new URL('../src/App.jsx', import.meta.url);
const liffUrl = new URL('../src/components/LiffReferralPage.jsx', import.meta.url);

test('tenant Points Rewards UI uses the scoped read and admin mutation endpoints with 7d and 30d views', async () => {
  const source = await readFile(tenantUrl, 'utf8');
  for (const endpoint of ['/api/line/account', '/api/point-rewards?', '/api/point-redemptions?', '/api/point-rewards', '/status?lineAccountId=']) assert.equal(source.includes(endpoint), true);
  for (const status of ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']) assert.equal(source.includes(status), true);
  assert.match(source, /\['owner', 'admin'\]/);
  assert.match(source, /\['7d', '30d'\]/);
  assert.match(source, /Number\.isSafeInteger/);
  for (const forbidden of ['withdrawable', 'cash', 'commission', 'coupon', 'voucher', 'shipping', 'pickup', 'QRCode']) assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false);
});

test('member Rewards UI derives identity from LIFF auth and submits only the opaque reward handle', async () => {
  const source = await readFile(memberUrl, 'utf8');
  for (const endpoint of ['/api/member/points?', '/api/member/rewards?', '/api/member/redemptions?']) assert.equal(source.includes(endpoint), true);
  assert.match(source, /JSON\.stringify\(\{ lineAccountId: auth\.lineAccountId, liffAccessToken: auth\.accessToken, rewardHandle: reward\.rewardHandle \}\)/);
  assert.doesNotMatch(source, /body\.memberId|body\.pointAccountId|pointsCost:\s*.*input|rewardId:/);
  assert.match(source, /INSUFFICIENT_POINTS/);
  assert.match(source, /await load\(\)/);
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'console.', 'coupon', 'voucher', 'shipping', 'pickup', 'withdrawable', 'commission']) assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false);
});

test('Reward Redemption UI is mounted in existing tenant settings and LIFF referral experiences', async () => {
  const [app, liff] = await Promise.all([readFile(appUrl, 'utf8'), readFile(liffUrl, 'utf8')]);
  assert.match(app, /RewardRedemptionPanel request=\{authFetch\} userRole=\{activeRole\}/);
  assert.match(liff, /MemberRewardRedemptionPanel request=\{api\} auth=\{authRef\.current\}/);
  assert.match(liff, /DealerSettlementPayoutPanel/);
});
