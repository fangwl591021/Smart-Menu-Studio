import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildOperationPlan,
  OPERATION_EXECUTORS,
  operationLogEvents,
  proposalExecutionContract,
} from '../src/guide/proposals/execution.ts';
import { proposalPermissions } from '../src/guide/proposals/persistence.ts';

const currentProposal = (overrides = {}) => ({
  id: 'prop:rec:R010:project-a:stable:postback-display-text',
  recommendationId: 'rec:R010:project-a:stable',
  ruleCode: 'R010',
  workspaceId: 'workspace-a',
  projectId: 'project-a',
  status: 'preview',
  title: '為 Postback 加入顯示文字',
  summary: '建立安全的顯示文字草案。',
  changes: [{
    id: 'chg:1:action-display-text',
    entityType: 'project_area',
    entityId: '1',
    field: 'action_display_text',
    operation: 'set',
    before: '',
    after: '聯絡我們',
    reason: '使用既有區域標籤。',
  }],
  warnings: [],
  generatedBy: 'rule',
  canApply: false,
  ...overrides,
});

const storedProposal = (status = 'approved', overrides = {}) => ({
  id: 'aip-one',
  workspaceId: 'workspace-a',
  projectId: 'project-a',
  recommendationId: 'rec:R010:project-a:stable',
  ruleCode: 'R010',
  proposalType: 'postback-display-text',
  sourceEntityId: '1',
  status,
  title: 'Proposal',
  summary: '',
  generatedBy: 'rule',
  snapshot: currentProposal(),
  sourceFingerprint: 'fingerprint',
  createdByUserId: 'editor-a',
  createdByName: 'Editor',
  reviewedByUserId: 'editor-a',
  reviewedByName: 'Editor',
  approvedByUserId: 'admin-a',
  approvedByName: 'Admin',
  rejectedByUserId: null,
  rejectedByName: null,
  createdAt: '2026-08-09',
  updatedAt: '2026-08-09',
  reviewedAt: '2026-08-09',
  approvedAt: '2026-08-09',
  rejectedAt: null,
  executedAt: null,
  ...overrides,
});

const context = (overrides = {}) => ({
  workspaceId: 'workspace-a',
  userId: 'admin-a',
  route: '/projects/project-a',
  page: { key: 'project_detail', title: 'Project Detail' },
  workspace: { id: 'workspace-a', name: 'Workspace A' },
  project: {
    id: 'project-a', name: '首頁', status: 'draft', templateId: 'template-a', assetId: 'asset-a', areaCount: 1,
  },
  selectedArea: null,
  areas: [{
    recordId: 'project-area-row-1', id: '1', label: '聯絡我們', actionType: 'postback',
    uri: '', text: '', data: 'action=contact', displayText: '', targetPageId: '',
  }],
  lineAccount: { exists: true, hasBotToken: true, hasBotSecret: true, webhookEnabled: true },
  completeness: { projectHasImage: true, allAreasConfigured: true, lineAccountReady: true, hasInvalidActions: false },
  ...overrides,
});

const planFor = (role = 'admin', proposal = storedProposal(), proposalNow = currentProposal(), ctx = context()) =>
  buildOperationPlan({ proposal, currentProposal: proposalNow, context: ctx, actor: { userId: `${role}-a`, role } });

const expectCode = (code, callback) => assert.throws(callback, error => error?.code === code);

test('P001 exposes the only executable proposal contract', () => {
  assert.deepEqual(proposalExecutionContract('postback-display-text', '1'), {
    executable: true,
    operationType: 'SET_PROJECT_AREA_DISPLAY_TEXT',
    targetEntityType: 'project_area',
    targetEntityId: '1',
  });
});

test('P002 exposes the HTTPS upgrade typed operation contract', () => {
  assert.deepEqual(proposalExecutionContract('https-upgrade-candidate', '1'), {
    executable: true,
    operationType: 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS',
    targetEntityType: 'project_area',
    targetEntityId: '1',
  });
});

for (const [label, type] of [
  ['P003', 'duplicate-message-review'],
  ['P004', 'duplicate-postback-review'],
  ['P005', 'multi-page-structure-draft'],
]) {
  test(`${label} remains NOT_EXECUTABLE`, () => {
    assert.deepEqual(proposalExecutionContract(type), {
      executable: false, operationType: 'NOT_EXECUTABLE', targetEntityType: null, targetEntityId: null,
    });
  });
}

for (const status of ['draft', 'reviewed', 'rejected']) {
  test(`${status} proposal cannot execute`, () => {
    expectCode('PROPOSAL_NOT_APPROVED', () => planFor('admin', storedProposal(status)));
  });
}

test('stale proposal cannot execute', () => {
  expectCode('PROPOSAL_STALE', () => planFor('admin', storedProposal('stale')));
});

test('executed proposal cannot execute a second time', () => {
  expectCode('PROPOSAL_ALREADY_EXECUTED', () => planFor('admin', storedProposal('executed')));
});

test('viewer cannot execute', () => {
  expectCode('FORBIDDEN_ROLE', () => planFor('viewer'));
  assert.equal(proposalPermissions('viewer', 'approved', true).canExecute, false);
});

test('editor cannot execute even if the editor created the proposal', () => {
  expectCode('FORBIDDEN_ROLE', () => planFor('editor'));
  assert.equal(proposalPermissions('editor', 'approved', true).canExecute, false);
});

test('admin can build a P001 operation plan', () => {
  const plan = planFor('admin');
  assert.equal(plan.operationType, 'SET_PROJECT_AREA_DISPLAY_TEXT');
  assert.deepEqual(plan.target, {
    entityType: 'project_area', entityId: 'project-area-row-1', areaIndex: '1', areaLabel: '聯絡我們',
  });
  assert.deepEqual(plan.mutation, { field: 'action_display_text', before: '', after: '聯絡我們' });
  assert.equal(proposalPermissions('admin', 'approved', true).canExecute, true);
});

test('owner can build a P001 operation plan', () => {
  assert.equal(planFor('owner').actor.role, 'owner');
  assert.equal(proposalPermissions('owner', 'approved', true).canExecute, true);
});

test('cross-tenant operation plan is rejected', () => {
  expectCode('PROPOSAL_STALE', () => planFor('admin', storedProposal(), currentProposal(), context({ workspaceId: 'workspace-b' })));
});

test('missing target is rejected', () => {
  expectCode('TARGET_NOT_FOUND', () => planFor('admin', storedProposal(), currentProposal(), context({ areas: [] })));
});

test('expected-before mismatch is rejected without overwrite', () => {
  const changed = context();
  changed.areas[0].displayText = '已由其他人設定';
  expectCode('TARGET_CHANGED', () => planFor('admin', storedProposal(), currentProposal(), changed));
});

test('invalid or empty deterministic after value is rejected', () => {
  const proposalNow = currentProposal();
  proposalNow.changes[0].after = '';
  expectCode('PROPOSAL_NOT_EXECUTABLE', () => planFor('admin', storedProposal(), proposalNow));
});

test('executor registry contains only the P001 and P002 typed executors', () => {
  assert.deepEqual(Object.keys(OPERATION_EXECUTORS), [
    'SET_PROJECT_AREA_DISPLAY_TEXT',
    'UPGRADE_PROJECT_AREA_URI_TO_HTTPS',
  ]);
});

test('0013 creates only the operation log table and required indexes', async () => {
  const sql = await readFile(new URL('../migrations/0013_ai_operation_logs.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_operation_logs/);
  assert.match(sql, /idx_ai_operation_logs_workspace_proposal/);
  assert.match(sql, /idx_ai_operation_logs_project_created/);
  assert.match(sql, /idx_ai_operation_logs_status_created/);
  assert.doesNotMatch(sql, /ALTER TABLE|CREATE TABLE IF NOT EXISTS (projects|project_areas|templates|template_areas)/i);
});

test('executor uses a conditional typed update and transactional rollback assertion', async () => {
  const source = await readFile(new URL('../src/guide/proposals/execution.ts', import.meta.url), 'utf8');
  assert.match(source, /UPDATE project_areas\s+SET action_display_text = \?/);
  assert.match(source, /action_type = 'postback'/);
  assert.match(source, /action_display_text IS NULL OR action_display_text = ''/);
  assert.match(source, /changes\(\) = 1/);
  assert.match(source, /'__ROLLBACK__'/);
  assert.match(source, /db\.batch\(\[/);
  assert.doesNotMatch(source, /SET\s+\$\{|\[field|field_from_proposal/i);
});

test('successful atomic unit updates only action_display_text and proposal execution state', async () => {
  const source = await readFile(new URL('../src/guide/proposals/execution.ts', import.meta.url), 'utf8');
  const executor = source.slice(source.indexOf('async function executeSetProjectAreaDisplayText'), source.indexOf('async function executeUpgradeProjectAreaUri'));
  for (const forbidden of [
    'SET action_type', 'SET action_data', 'SET action_uri', 'SET action_text', 'SET target_page_id',
    'UPDATE templates', 'UPDATE template_areas', 'smart_menu_assets', 'api.line.me', 'GEMINI_API_KEY',
  ]) assert.equal(executor.includes(forbidden), false);
  assert.match(executor, /SET status = 'executed', executed_at = \?/);
});

test('P001 operation logs expose only sanitized actionDisplayText snapshots', async () => {
  const migration = await readFile(new URL('../migrations/0013_ai_operation_logs.sql', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/guide/proposals/execution.ts', import.meta.url), 'utf8');
  assert.match(migration, /before_snapshot TEXT NOT NULL/);
  assert.match(migration, /after_snapshot TEXT/);
  assert.match(source, /actionDisplayText: value/);
  assert.doesNotMatch(source, /JSON\.stringify\(area\)|SELECT \* FROM project_areas/);
});

test('operation logs derive started and succeeded Proposal timeline events', () => {
  const events = operationLogEvents([{
    id: 'log-one', proposalId: 'aip-one', projectId: 'project-a',
    operationType: 'SET_PROJECT_AREA_DISPLAY_TEXT', targetEntityType: 'project_area',
    targetEntityId: 'project-area-row-1', status: 'succeeded',
    before: { actionDisplayText: '' }, after: { actionDisplayText: '聯絡我們' },
    actorUserId: 'admin-a', actorName: 'Admin', errorCode: null, errorMessage: null,
    createdAt: '2026-08-09T00:00:00.000Z', completedAt: '2026-08-09T00:00:01.000Z',
  }]);
  assert.deepEqual(events.map(event => event.eventType), ['EXECUTION_STARTED', 'EXECUTION_SUCCEEDED']);
});

test('failed operation derives EXECUTION_FAILED without changing Proposal to executed', () => {
  const events = operationLogEvents([{
    id: 'log-failed', proposalId: 'aip-one', projectId: 'project-a',
    operationType: 'SET_PROJECT_AREA_DISPLAY_TEXT', targetEntityType: 'project_area',
    targetEntityId: 'project-area-row-1', status: 'failed',
    before: { actionDisplayText: '' }, after: null,
    actorUserId: 'admin-a', actorName: 'Admin', errorCode: 'TARGET_CHANGED', errorMessage: 'changed',
    createdAt: '2026-08-09T00:00:00.000Z', completedAt: '2026-08-09T00:00:01.000Z',
  }]);
  assert.equal(events[1].eventType, 'EXECUTION_FAILED');
  assert.equal(events[1].toStatus, 'approved');
});

test('execute endpoint accepts only confirmation and rebuilds trusted server state', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/projects/:projectId/proposals/:proposalId/execute'");
  const end = source.indexOf("app.post('/api/projects/:projectId/publish'", start);
  const route = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(route, /requireRole\(c, 'admin'\)/);
  assert.match(route, /body\.confirmation !== true/);
  assert.match(route, /rebuildCurrentProposal/);
  assert.match(route, /fingerprintProposal/);
  assert.match(route, /buildOperationPlan/);
  assert.match(route, /executeOperationPlan/);
  for (const forged of ['body.after', 'body.field', 'body.entityId', 'body.operationType']) {
    assert.equal(route.includes(forged), false);
  }
});

test('execute endpoint returns explicit safe failure codes and scopes tenant lookup', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const operationSource = await readFile(new URL('../src/guide/proposals/execution.ts', import.meta.url), 'utf8');
  for (const code of [
    'PROPOSAL_NOT_FOUND', 'PROPOSAL_NOT_APPROVED', 'PROPOSAL_ALREADY_EXECUTED', 'PROPOSAL_STALE',
    'PROPOSAL_NOT_EXECUTABLE', 'FORBIDDEN_ROLE', 'TARGET_NOT_FOUND', 'TARGET_CHANGED',
    'EXECUTION_FAILED', 'VERIFICATION_FAILED',
  ]) assert.match(source + operationSource, new RegExp(code));
  assert.match(source, /getStoredProposal\([\s\S]*?workspaceId,[\s\S]*?projectId/);
  assert.doesNotMatch(source, /raw database error|error\.stack/);
});

test('frontend shows apply only when backend policy capability and execution eligibility allow it', async () => {
  const source = await readFile(new URL('../../frontend/src/components/ProposalManagement.jsx', import.meta.url), 'utf8');
  assert.match(source, /policy\.capabilities\?\.canExecute === true/);
  assert.match(source, /proposal\.execution\?\.executable === true/);
  assert.doesNotMatch(source, /roleCanManage/);
  assert.match(source, /policy\.capabilities\?\.canRollback === true/);
  for (const marker of ['套用已核准方案', '此操作會修改正式專案資料。', '確認套用', '取消']) {
    assert.match(source, new RegExp(marker));
  }
  assert.doesNotMatch(source, /強制執行|force apply/i);
});

test('frontend renders success, stale, failed, already-executed paths and triggers refresh', async () => {
  const management = await readFile(new URL('../../frontend/src/components/ProposalManagement.jsx', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
  for (const marker of ['✓ 改善方案已套用', '⚠ 方案已失效', 'PROPOSAL_ALREADY_EXECUTED', 'EXECUTION_FAILED', '已執行']) {
    assert.match(management, new RegExp(marker.replace(/[✓⚠]/g, '.')));
  }
  assert.match(app, /handleProposalExecuted/);
  assert.match(app, /type: 'guide-refresh'/);
  assert.match(app, /SET_PROJECT_AREA_DISPLAY_TEXT/);
});
