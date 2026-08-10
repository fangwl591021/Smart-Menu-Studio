import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = await readFile(fileURLToPath(new URL('../src/components/CrmPipelinePanel.jsx', import.meta.url)), 'utf8');
const workspace = await readFile(fileURLToPath(new URL('../src/components/CrmWorkspace.jsx', import.meta.url)), 'utf8');

test('Pipeline overview has loading, safe empty state, cards, management, and no invented stages', () => {
  for (const value of ['/api/crm/pipeline-summary', '/api/crm/pipeline-stages', '載入 Pipeline 中…', '目前尚未建立 CRM 階段。', '客戶數：', '建立 CRM 階段', '封存階段', '進行中', '已成交', '未成交']) assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /\[['"]NEW['"].*CONTACTED.*QUALIFIED.*OPPORTUNITY/i);
});

test('CRM 360 business process uses only safe stage and task references', () => {
  for (const value of ['/business-process', '/stage', '/follow-ups', 'safeStageReference', 'safeTaskReference', 'assignedUserReference', '下次跟進', '已逾期', '完成', '取消']) assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /stage_id|task_id|users\.id|memberId|line_identity_hash|source_ref/i);
});

test('follow-up UI preserves permission, priority, status, privacy, and domain boundaries', () => {
  for (const value of ['低', '一般', '高', '待處理', '已完成', '已取消', '您目前只有閱讀權限。', 'CRM 階段僅代表業務流程狀態']) assert.match(source, new RegExp(value));
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|commission earned|payout|reward|dealer approved/i);
});

test('CRM workspace activates business process without disturbing existing 360 ownership and referral separation', () => {
  assert.match(workspace, /CrmPipelinePanel/);
  assert.match(workspace, /CrmBusinessProcessPanel/);
  assert.match(workspace, /推薦人（系統歸屬）/);
  assert.match(workspace, /CRM 負責人/);
  assert.match(workspace, /CrmInsightsTraitsPanel/);
  assert.match(workspace, /匯入紀錄/);
  assert.match(workspace, /未來功能：Timeline/);
});
