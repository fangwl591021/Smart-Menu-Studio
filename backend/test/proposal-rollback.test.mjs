import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildRollbackPlan,
  canRoleRollback,
  evaluateRollbackEligibility,
  normalizeDisplayText,
  ROLLBACK_EXECUTORS,
} from '../src/guide/proposals/rollback.ts';
import { operationLogEvents } from '../src/guide/proposals/execution.ts';

const proposal = (overrides = {}) => ({
  id: 'aip-one', workspaceId: 'workspace-a', projectId: 'project-a',
  recommendationId: 'rec:R010:project-a:stable', ruleCode: 'R010',
  proposalType: 'postback-display-text', sourceEntityId: '1', status: 'executed',
  title: 'Proposal', summary: '', generatedBy: 'rule', snapshot: {}, sourceFingerprint: 'fingerprint',
  createdByUserId: 'editor-a', createdByName: 'Editor', reviewedByUserId: 'editor-a',
  reviewedByName: 'Editor', approvedByUserId: 'admin-a', approvedByName: 'Admin',
  rejectedByUserId: null, rejectedByName: null, createdAt: '2026-08-09', updatedAt: '2026-08-09',
  reviewedAt: '2026-08-09', approvedAt: '2026-08-09', rejectedAt: null, executedAt: '2026-08-09',
  ...overrides,
});

const operation = (overrides = {}) => ({
  id: 'op-one', workspaceId: 'workspace-a', proposalId: 'aip-one', projectId: 'project-a',
  operationType: 'SET_PROJECT_AREA_DISPLAY_TEXT', targetEntityType: 'project_area',
  targetEntityId: 'area-row-one', status: 'succeeded', before: { actionDisplayText: '' },
  after: { actionDisplayText: '聯絡我們' }, actorUserId: 'admin-a', actorName: 'Admin',
  errorCode: null, errorMessage: null, createdAt: '2026-08-09T00:00:00.000Z',
  completedAt: '2026-08-09T00:00:01.000Z', revertsOperationId: null,
  rootOperationId: null, rollbackOperationId: null, ...overrides,
});

const target = (overrides = {}) => ({
  workspaceId: 'workspace-a', projectId: 'project-a', entityId: 'area-row-one',
  areaIndex: '1', label: '聯絡我們', actionDisplayText: '聯絡我們', ...overrides,
});

const eligibility = (op = operation(), current = target(), stored = proposal()) =>
  evaluateRollbackEligibility({ operationLog: op, currentTarget: current, proposal: stored });

const planFor = (role = 'admin', op = operation(), current = target(), stored = proposal()) =>
  buildRollbackPlan({ proposal: stored, operationLog: op, currentTarget: current, actor: { userId: `${role}-a`, role } });

const expectCode = (code, callback) => assert.throws(callback, error => error?.code === code);

test('executed P001 with unchanged target is eligible for rollback', () => {
  assert.deepEqual(eligibility(), { eligible: true, reasonCode: 'ELIGIBLE', message: '此操作可以安全回復。' });
});

test('approved but not executed proposal is not rollbackable', () => {
  assert.equal(eligibility(operation(), target(), proposal({ status: 'approved' })).reasonCode, 'PROPOSAL_NOT_EXECUTED');
});

test('failed operation is not rollbackable', () => {
  assert.equal(eligibility(operation({ status: 'failed' })).reasonCode, 'OPERATION_NOT_SUCCEEDED');
});

test('unsupported operation is not rollbackable', () => {
  assert.equal(eligibility(operation({ operationType: 'UNSUPPORTED' })).reasonCode, 'OPERATION_NOT_ROLLBACKABLE');
});

test('viewer cannot rollback', () => {
  assert.equal(canRoleRollback('viewer'), false);
  expectCode('ROLLBACK_FORBIDDEN', () => planFor('viewer'));
});

test('editor cannot rollback', () => {
  assert.equal(canRoleRollback('editor'), false);
  expectCode('ROLLBACK_FORBIDDEN', () => planFor('editor'));
});

test('admin can build a typed rollback plan', () => {
  assert.equal(canRoleRollback('admin'), true);
  assert.deepEqual(planFor('admin').mutation, {
    field: 'action_display_text', expectedCurrent: '聯絡我們', restoreTo: '',
  });
});

test('owner can build a typed rollback plan', () => {
  assert.equal(canRoleRollback('owner'), true);
  assert.equal(planFor('owner').actor.role, 'owner');
});

test('cross-tenant rollback is blocked', () => {
  assert.equal(eligibility(operation({ workspaceId: 'workspace-b' })).reasonCode, 'TENANT_MISMATCH');
  assert.equal(eligibility(operation(), target({ workspaceId: 'workspace-b' })).reasonCode, 'TENANT_MISMATCH');
});

test('current value equal to operation after remains eligible', () => {
  assert.equal(eligibility().eligible, true);
});

test('current value changed after execution is blocked', () => {
  assert.equal(eligibility(operation(), target({ actionDisplayText: '立即聯絡' })).reasonCode, 'TARGET_CHANGED_AFTER_EXECUTION');
});

test('missing target is blocked', () => {
  assert.equal(eligibility(operation(), null).reasonCode, 'TARGET_NOT_FOUND');
});

test('successful prior rollback makes operation idempotently unavailable', () => {
  assert.equal(eligibility(operation({ rollbackOperationId: 'rollback-one' })).reasonCode, 'ROLLBACK_ALREADY_COMPLETED');
});

test('null and empty display text normalize to the same restore value', () => {
  assert.equal(normalizeDisplayText(null), '');
  assert.equal(normalizeDisplayText(undefined), '');
  assert.equal(normalizeDisplayText(''), '');
  assert.equal(eligibility(operation({ before: { actionDisplayText: null } })).eligible, true);
});

test('rollback registry contains only the P001 typed operation', () => {
  assert.deepEqual(Object.keys(ROLLBACK_EXECUTORS), ['SET_PROJECT_AREA_DISPLAY_TEXT']);
});

test('0014 only extends operation audit and links rollback to original operation', async () => {
  const sql = await readFile(new URL('../migrations/0014_ai_operation_rollback.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN reverts_operation_id TEXT/);
  assert.match(sql, /ADD COLUMN root_operation_id TEXT/);
  assert.match(sql, /idx_ai_operation_logs_one_successful_rollback/);
  assert.doesNotMatch(sql, /ALTER TABLE (projects|project_areas|templates|assets)|UPDATE |DELETE FROM /i);
});

test('rollback update changes only action_display_text with expected-current concurrency guard', async () => {
  const source = await readFile(new URL('../src/guide/proposals/rollback.ts', import.meta.url), 'utf8');
  assert.match(source, /UPDATE project_areas\s+SET action_display_text = \?/);
  assert.match(source, /COALESCE\(action_display_text, ''\) = \?/);
  assert.match(source, /changes\(\) = 1/);
  assert.match(source, /'__ROLLBACK__'/);
  for (const forbidden of ['SET action_type', 'SET action_data', 'SET action_uri', 'SET action_text', 'SET target_page_id']) {
    assert.equal(source.includes(forbidden), false);
  }
});

test('rollback leaves template, R2, LINE, and Gemini untouched', async () => {
  const source = await readFile(new URL('../src/guide/proposals/rollback.ts', import.meta.url), 'utf8');
  for (const forbidden of ['UPDATE templates', 'UPDATE template_areas', 'smart_menu_assets', 'api.line.me', 'GEMINI_API_KEY', 'requestGemini']) {
    assert.equal(source.includes(forbidden), false);
  }
});

test('rollback audit row contains original and root operation links', async () => {
  const source = await readFile(new URL('../src/guide/proposals/rollback.ts', import.meta.url), 'utf8');
  assert.match(source, /reverts_operation_id, root_operation_id/);
  assert.match(source, /plan\.sourceOperationId/);
  assert.match(source, /plan\.rootOperationId/);
});

test('rollback log derives started and succeeded proposal timeline events without status rewind', () => {
  const events = operationLogEvents([operation({
    id: 'rollback-one', revertsOperationId: 'op-one', rootOperationId: 'op-one',
    before: { actionDisplayText: '聯絡我們' }, after: { actionDisplayText: '' },
  })]);
  assert.deepEqual(events.map(event => event.eventType), ['ROLLBACK_STARTED', 'ROLLBACK_SUCCEEDED']);
  assert.ok(events.every(event => event.toStatus === 'executed'));
});

test('blocked rollback derives ROLLBACK_BLOCKED event', () => {
  const events = operationLogEvents([operation({
    id: 'rollback-failed', status: 'failed', revertsOperationId: 'op-one',
    errorCode: 'ROLLBACK_TARGET_CHANGED', after: null,
  })]);
  assert.equal(events[1].eventType, 'ROLLBACK_BLOCKED');
});

test('failed rollback cannot be reported as succeeded and post-write verification is mandatory', async () => {
  const source = await readFile(new URL('../src/guide/proposals/rollback.ts', import.meta.url), 'utf8');
  assert.match(source, /status = 'succeeded'[\s\S]*changes\(\) = 1/);
  assert.match(source, /ROLLBACK_VERIFICATION_FAILED/);
  assert.match(source, /listOperationLogs\(db/);
});

test('execute rollback endpoint trusts only confirmation and rebuilds source from server state', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/projects/:projectId/proposals/:proposalId/rollback'");
  const end = source.indexOf("app.post('/api/projects/:projectId/publish'", start);
  const route = source.slice(start, end);
  assert.match(route, /requireRole\(c, 'admin'\)/);
  assert.match(route, /body\.confirmation !== true/);
  assert.match(route, /buildRollbackContext/);
  assert.match(route, /buildRollbackPlan/);
  assert.match(route, /executeRollbackPlan/);
  for (const forged of ['body.field', 'body.before', 'body.after', 'body.entityId', 'body.operationType']) {
    assert.equal(route.includes(forged), false);
  }
});

test('rollback preview endpoint is GET-only and project/workspace scoped', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf("app.get('/api/projects/:projectId/proposals/:proposalId/rollback-preview'");
  const end = source.indexOf("app.post('/api/projects/:projectId/proposals/:proposalId/rollback'", start);
  const route = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(route, /workspaceIdOf\(c\)/);
  assert.match(route, /getStoredProposal/);
  assert.doesNotMatch(route, /UPDATE |INSERT INTO|DELETE FROM /);
});

test('all required rollback failure codes are explicit and raw D1 errors are hidden', async () => {
  const source = await readFile(new URL('../src/guide/proposals/rollback.ts', import.meta.url), 'utf8');
  for (const code of [
    'ROLLBACK_NOT_AVAILABLE', 'ROLLBACK_ALREADY_COMPLETED', 'ROLLBACK_FORBIDDEN',
    'ROLLBACK_TARGET_NOT_FOUND', 'ROLLBACK_TARGET_CHANGED', 'ROLLBACK_NOT_SUPPORTED',
    'ROLLBACK_EXECUTION_FAILED', 'ROLLBACK_VERIFICATION_FAILED', 'ROLLBACK_TENANT_MISMATCH',
  ]) assert.match(source, new RegExp(code));
  assert.doesNotMatch(source, /error\.stack|raw database error/i);
});

test('frontend exposes eligible admin/owner confirmation, success, blocked, and operation history UX', async () => {
  const source = await readFile(new URL('../../frontend/src/components/ProposalManagement.jsx', import.meta.url), 'utf8');
  for (const marker of [
    '回復這次修改', '確認回復', '只有這次 AI Operation 所修改的欄位會被回復。',
    '系統將拒絕回復', '已安全回復', '無法自動回復', '操作歷程', 'admin', 'owner',
  ]) assert.match(source, new RegExp(marker));
  assert.doesNotMatch(source, /強制回復按鈕|force rollback/i);
});

test('rollback refreshes recommendations without auto-regenerate or auto-execute', async () => {
  const app = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
  const start = app.indexOf('const handleProposalRolledBack');
  const end = app.indexOf('const focusGuideTarget', start);
  const handler = app.slice(start, end);
  assert.match(handler, /type: 'guide-refresh'/);
  assert.match(handler, /stepId: 'PROJECT_ACTIONS'/);
  assert.doesNotMatch(handler, /regenerate|approve|executeProposal|executeOperation/i);
});

test('rollback implementation never changes proposal status from executed', async () => {
  const source = await readFile(new URL('../src/guide/proposals/rollback.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /UPDATE ai_proposals\s+SET status/i);
  assert.match(source, /proposal\.status !== 'executed'/);
});
