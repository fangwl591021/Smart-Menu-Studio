import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = await readFile(fileURLToPath(new URL('../src/components/CrmAnalyticsPanel.jsx', import.meta.url)), 'utf8');
const workspace = await readFile(fileURLToPath(new URL('../src/components/CrmWorkspace.jsx', import.meta.url)), 'utf8');

test('CRM Analytics has 7d/30d dashboard metrics and safe current distributions', () => {
  assert.match(source, /\/api\/crm\/analytics-summary\?period=\$\{period\}/);
  for (const value of ['7d','30d','totalPeople','newPeopleInPeriod','peopleWithLineIdentity','peopleWithoutLineIdentity','peopleWithReferrer','peopleWithoutReferrer','peopleByStage','peopleByAcquisitionSource','peopleByTag','peopleByAssignedOwner','openFollowUpCount','overdueFollowUpCount']) assert.match(source, new RegExp(value));
  assert.match(source, /最新取得來源/);
  assert.doesNotMatch(source, /users\.id|line_identity_hash|source_ref|internalNote/);
});

test('Segment Builder is AND-only, bounded, uses only backend V1 fields and safe pickers', () => {
  assert.match(source, /operator:'AND'/); assert.match(source, /conditions\.length>=20/);
  for (const value of ['status','acquisition.firstSource','acquisition.latestSource','tag','stage','assignedOwner','trait.zodiac','followUp.overdue']) assert.match(source, new RegExp(value.replace('.', '\\.')));
  for (const endpoint of ['/api/crm/tags','/api/crm/pipeline-stages','/api/crm/assignees']) assert.match(source, new RegExp(endpoint.replace(/[/?]/g, '\\$&')));
  assert.match(source, /safeTagReference\|\|x\.tagReference/); assert.match(source, /stageReference/); assert.match(source, /assignedUserReference/);
  assert.doesNotMatch(source, /personality|wealth|health|career|interest|LIKE|REGEX|memberId|userId/i);
});

test('preview, saved segments and opaque cursor remain read-only safe UX', () => {
  for (const endpoint of ['/api/crm/segments/preview','/api/crm/segments','/people']) assert.match(source, new RegExp(endpoint.replace(/[/?]/g, '\\$&')));
  assert.match(source, /people\?limit=25/); assert.match(source, /nextCursor/); assert.match(source, /載入更多/);
  assert.match(source, /編輯會建立新的不可變版本/); assert.match(source, /封存客戶區隔/); assert.match(source, /客戶區隔會依目前 CRM 資料即時計算/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|cursor=.*window|decode.*cursor/i);
});

test('CRM workspace provides a concise analytics entry without replacing People or CRM 360', () => {
  assert.match(workspace, /CrmAnalyticsPanel/); assert.match(workspace, /CRM 分析/); assert.match(workspace, /CRM 客戶/); assert.match(workspace, /crm-360/);
  assert.doesNotMatch(source, /campaign|broadcast|openai|lead score|LINE send/i);
});
