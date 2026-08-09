import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = () => readFile(new URL('../src/components/LiffReferralPage.jsx', import.meta.url), 'utf8');

test('member self growth renders backend aggregates, sources, trend and safe rate', async () => {
  const source = await page();
  for (const value of ['我的推薦成長', 'qualifiedReferrals', 'qualified7d', 'qualified30d', "'qr'", "'line_share'", "'web_share'", '推薦入口來源', '推薦趨勢', 'sourceBreakdown', 'trend']) assert.ok(source.includes(value));
  assert.match(source, /value\s*==\s*null\s*\?\s*'—'/);
  assert.match(source, /\['7d', '30d'\]/);
  assert.match(source, /onPeriodChange\(value\)/);
  assert.match(source, /\/api\/member\/referral-growth\?period=/);
});

test('member self growth keeps empty, LIFF-not-ready, privacy and 5A-1 referral protections', async () => {
  const source = await page();
  for (const value of ['目前還沒有有效推薦紀錄。', '此官方帳號尚未完成推薦功能設定。', '我的推薦 QR Code', '複製連結', 'LINE 分享', 'requestFriendship', '/api/member/referral/qualify', 'X-Smart-Menu-Referral-Flow']) assert.ok(source.includes(value));
  for (const forbidden of ['memberId', 'inviterMemberId', 'inviteeMemberId', 'lineUserId', 'line_identity_hash', 'referral graph', 'Points']) assert.equal(source.includes(forbidden), false, `must not render or request ${forbidden}`);
  assert.doesNotMatch(source, /member\/referral-growth\?[^`]*memberId/);
});
