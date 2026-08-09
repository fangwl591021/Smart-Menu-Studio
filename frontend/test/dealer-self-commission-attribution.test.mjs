import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = () => readFile(new URL('../src/components/LiffReferralPage.jsx', import.meta.url), 'utf8');
const selfSection = source => source.slice(source.indexOf('function SelfAttributionPanel'), source.indexOf('function SelfLedgerPanel'));

test('member self attribution uses only the existing LIFF-scoped API and backend aggregates', async () => {
  const source = selfSection(await page());
  for (const value of ['我的已歸因轉換', '/api/member/dealer/commission-attributions?period=', "['7d', '30d']", 'attributedConversions', 'trend', 'programs', 'sources', 'REFERRAL_EVIDENCE', '推薦證據']) assert.ok((await page()).includes(value));
  assert.match(source, /data\.status === 'NOT_ENROLLED'/);
  assert.match(source, /目前尚未加入經銷商方案/);
  assert.match(source, /目前尚無已歸因轉換/);
  assert.match(source, /目前無法讀取已歸因轉換資料/);
});

test('member self attribution remains read-only, private and non-monetary', async () => {
  const source = selfSection(await page());
  for (const forbidden of ['dealerId', 'memberId', 'lineUserId', 'line_identity_hash', 'invitee', 'customer', 'evidenceId', 'contextId', 'referralFlowToken', 'liffAccessToken', 'conversionPayload', 'Force Assign', 'Override', 'Retry Attribution', 'Delete Attribution', 'amount', 'rate', 'currency', 'balance', 'payable', 'payout', 'settlement', 'withdrawal', 'Points', 'Rewards']) assert.equal(source.includes(forbidden), false, `must not include ${forbidden}`);
  assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('sessionStorage'), false);
  assert.equal(source.includes('indexedDB'), false);
});

test('existing referral sharing and growth UI remain present with self attribution extension', async () => {
  const source = await page();
  for (const value of ['MemberGrowthPanel', '我的推薦 QR Code', '複製連結', 'LINE 分享', 'requestFriendship', '/api/member/referral/qualify', 'SelfAttributionPanel']) assert.ok(source.includes(value));
  assert.match(source, /authRef\.current/);
  assert.match(source, /Authorization: `Bearer \$\{auth\.accessToken\}`/);
});
