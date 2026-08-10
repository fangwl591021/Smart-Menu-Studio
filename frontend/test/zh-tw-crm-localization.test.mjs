import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [workspace, analytics, pipeline, timeline, labels] = await Promise.all([
  read('../src/components/CrmWorkspace.jsx'),
  read('../src/components/CrmAnalyticsPanel.jsx'),
  read('../src/components/CrmPipelinePanel.jsx'),
  read('../src/components/CrmTimelinePanel.jsx'),
  read('../src/utils/presentationLabels.js'),
]);

test('CRM visible navigation and profile labels use zh-TW presentation', () => {
  for (const value of ['CRM 客戶管理', 'CRM 客戶', 'CRM 分析', 'CRM 個人資料', 'CRM 負責人', '取得來源', '推薦關係（唯讀）', '個人卡片', '歷史商務名片', '匯入紀錄']) {
    assert.match(workspace, new RegExp(value));
  }
  assert.doesNotMatch(workspace, />CRM People</);
  assert.doesNotMatch(workspace, />CRM Analytics</);
  assert.doesNotMatch(workspace, />CRM Profile</);
});

test('CRM analytics and segment controls use zh-TW labels without changing contracts', () => {
  for (const value of ['CRM 分析', '客戶區隔建立器', '最新取得來源', '預覽', '已儲存的客戶區隔', '封存客戶區隔', '載入更多', '7d', '30d']) assert.match(analytics, new RegExp(value));
  for (const endpoint of ['/api/crm/analytics-summary', '/api/crm/segments', '/api/crm/segments/preview']) assert.match(analytics, new RegExp(endpoint.replace(/[/?]/g, '\\$&')));
  for (const value of ['ACTIVE', 'ARCHIVED', 'assignedUserReference']) assert.match(analytics, new RegExp(value));
});

test('pipeline and timeline retain Chinese presentation for known state and event labels', () => {
  for (const value of ['業務流程', '跟進事項', '待處理', '已完成', '已逾期']) assert.match(pipeline, new RegExp(value));
  for (const value of ['客戶活動時間線', '已建立跟進事項', '跟進事項已完成', '載入更多活動']) assert.match(timeline, new RegExp(value));
});

test('central presentation labels keep backend enum values out of the public wording', () => {
  for (const value of ['labelStatus', 'labelRole', 'labelAcquisitionSource', 'labelSegmentOperator', 'labelZodiac', 'LINE_ORGANIC', 'ACTIVE', 'ARCHIVED', 'ARIES']) assert.match(labels, new RegExp(value));
});
