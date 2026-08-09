import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = () => readFile(new URL('../src/components/LiffReferralPage.jsx', import.meta.url), 'utf8');
const ledgerSection = source => source.slice(source.indexOf('function SelfLedgerPanel'), source.indexOf('export default function LiffReferralPage'));

test('dealer self ledger renders LIFF-scoped earned commission aggregates and periods', async () => {
  const full = await page();
  const source = ledgerSection(full);
  for (const value of ['我的已賺佣金', '/api/member/dealer/commission-ledger?period=', "['7d', '30d']", 'earnedByCurrency', 'amountMinor', 'currencyCode', 'attributionCount', 'trend', 'programBreakdown', '佣金趨勢', '方案佣金']) assert.ok(full.includes(value), `missing ${value}`);
  assert.match(source, /data\.status === 'NOT_ENROLLED'/);
  assert.match(source, /目前尚未加入經銷商方案/);
  assert.match(source, /目前尚無已賺佣金紀錄/);
});

test('dealer self ledger keeps historical money read-only and privacy-safe', async () => {
  const full = await page();
  const source = ledgerSection(full);
  for (const forbidden of ['dealerId', 'memberId', 'lineUserId', 'line_identity_hash', 'invitee', 'customer', 'evidenceId', 'contextId', 'calculationId', 'ledgerId', 'conversionPayload', 'manual credit', 'manual debit', 'recalculate', 'Delete Ledger', 'Points', 'Rewards']) assert.equal(source.includes(forbidden), false, `must not include ${forbidden}`);
  for (const value of ['不代表可提領或已結算', 'SelfAttributionPanel', 'MemberGrowthPanel', '我的推薦 QR Code', '複製連結', 'LINE 分享']) assert.ok(full.includes(value));
  assert.equal(source.includes("status !== 'ACTIVE'"), false);
  assert.equal(source.includes('amount = 0'), false);
});
