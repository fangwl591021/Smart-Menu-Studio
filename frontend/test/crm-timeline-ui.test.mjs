import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const readComponent = (name) => readFile(
  fileURLToPath(new URL(`../src/components/${name}`, import.meta.url)),
  'utf8',
);

test('CRM 360 mounts a cursor-backed read-only timeline', async () => {
  const workspace = await readComponent('CrmWorkspace.jsx');

  assert.match(workspace, /import CrmTimelinePanel from '\.\/CrmTimelinePanel';/);
  assert.match(workspace, /<CrmTimelinePanel request=\{request\} personReference=\{detail\.personRef\}/);
  assert.doesNotMatch(workspace, /未來功能：Timeline/);
});

test('timeline uses the safe backend cursor contract and states', async () => {
  const source = await readComponent('CrmTimelinePanel.jsx');

  for (const value of [
    '/api/crm/people/',
    '/timeline\\?limit=25',
    'nextCursor',
    '載入活動紀錄中',
    '目前尚無可顯示的客戶活動紀錄',
    '活動紀錄載入失敗',
    '載入更多活動',
  ]) assert.match(source, new RegExp(value));

  assert.match(source, /encodeURIComponent\(cursor\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/i);
});

test('timeline renders only safe event labels and allowlisted metadata', async () => {
  const source = await readComponent('CrmTimelinePanel.jsx');

  for (const value of [
    'PROFILE_UPDATED', 'ACQUISITION_RECORDED', 'REFERRAL_ATTRIBUTED',
    'IMPORT_CREATED_PERSON', 'PERSONAL_CARD_CREATED', 'CARD_SHARED',
    'TAG_ASSIGNED', 'INSIGHT_RECORDED', 'TRAIT_DERIVED', 'STAGE_CHANGED',
    'FOLLOW_UP_CREATED', 'POINTS_CREDITED', 'REWARD_REDEEMED',
    'CONTRIBUTION_RECORDED', 'COMMISSION_EARNED', 'SETTLEMENT_FINALIZED',
    'PAYOUT_REQUESTED', 'PAYMENT_SIMULATED_SUCCEEDED',
  ]) assert.match(source, new RegExp(value));

  assert.match(source, /此為模擬付款結果，並非真實付款/);
  assert.match(source, /fromStageLabel|toStageLabel/);
  assert.match(source, /amountMinor|currencyCode|scoreDelta|pointsCost|dueAt/);
  assert.doesNotMatch(source, /source_ref|line_identity_hash|memberId|personId|attributionId|task\.note|provider_payload|raw_prompt|r2_key|revokeHandle/i);
});
