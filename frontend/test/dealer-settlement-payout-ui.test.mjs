import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelUrl = new URL('../src/components/DealerSettlementPayoutPanel.jsx', import.meta.url);
const liffUrl = new URL('../src/components/LiffReferralPage.jsx', import.meta.url);

test('Dealer Self settlement and payout panel uses only member-safe endpoints and opaque action carriers', async () => {
  const source = await readFile(panelUrl, 'utf8');
  for (const required of ['/api/member/dealer/settlements?period=', '/api/member/dealer/payout-requests', '/api/member/dealer/payout-requests/cancel', '/api/member/dealer/payment-status', 'settlementHandle', 'payoutRequestHandle', '7d', '30d', 'settlementCount', 'earnedByCurrency', 'itemCount', 'REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SIMULATED', 'INTERNAL_TEST']) assert.equal(source.includes(required), true, `missing ${required}`);
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'window.location', 'console.', 'settlementId', 'requestId', 'dealerId', 'memberId', 'lineUserId', 'line_identity_hash', 'amountInput', 'withdraw', 'payable', 'paid', 'execute', 'retry', 'bank', 'provider_secret', 'Points', 'Rewards']) assert.equal(source.includes(forbidden), false, `must not render or store ${forbidden}`);
  for (const forbiddenControl of ['/approve', '/reject', '/execute', 'onClick={() => approve', 'onClick={() => reject', 'onClick={() => execute', 'onClick={() => retry']) assert.equal(source.includes(forbiddenControl), false, `must not contain control ${forbiddenControl}`);
});

test('Dealer Self UI has null-safe historical, loading, empty, error, cancellation, and simulated wording', async () => {
  const source = await readFile(panelUrl, 'utf8');
  for (const required of ['NOT_ENROLLED', '正在讀取結算紀錄', '目前尚無已完成結算紀錄', '目前尚無佣金申請紀錄', '目前尚無付款處理紀錄', '取消申請', "row.status === 'REQUESTED'", '此為模擬付款結果，不代表真實付款完成', '模擬付款未完成']) assert.equal(source.includes(required), true, `missing ${required}`);
  assert.equal(source.includes('已付款'), false);
  assert.equal(source.includes('真實付款、轉帳或匯款'), true);
});

test('Liff referral page retains existing Dealer attribution, ledger, referral, QR, and sharing UI around the new panel', async () => {
  const source = await readFile(liffUrl, 'utf8');
  for (const required of ['SelfAttributionPanel', 'SelfLedgerPanel', 'DealerSettlementPayoutPanel', 'MemberGrowthPanel', '我的推薦 QR Code', '複製連結', 'LINE 分享', 'requestFriendship', 'referral/qualify']) assert.equal(source.includes(required), true, `missing ${required}`);
});
