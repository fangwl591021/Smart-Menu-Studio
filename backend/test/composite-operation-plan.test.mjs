import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CompositePlanError,
  buildCompositeOperationPlan,
  evaluatePlanPreflight,
  fingerprintCompositePlan,
} from '../src/guide/proposals/composite-plan.ts';
import {
  evaluateCompositePlanPolicy,
} from '../src/guide/proposals/policy.ts';
import {
  canTransitionCompositePlan,
} from '../src/guide/proposals/composite-plan-persistence.ts';

const context = (areas = [
  { id: 'area-a', recordId: 'row-a', actionType: 'postback', data: 'go', displayText: '', uri: '' },
  { id: 'area-b', recordId: 'row-b', actionType: 'uri', data: '', displayText: '', uri: 'http://example.com/path?redacted=1' },
]) => ({
  workspaceId: 'ws-a',
  project: { id: 'project-a', name: 'Project A' },
  areas,
});

const storedProposal = ({
  id = 'proposal-p001',
  proposalType = 'postback-display-text',
  sourceEntityId = 'area-a',
  status = 'approved',
  workspaceId = 'ws-a',
  projectId = 'project-a',
  field = proposalType === 'https-upgrade-candidate' ? 'action_uri' : 'action_display_text',
  before = proposalType === 'https-upgrade-candidate' ? 'http://example.com/path' : '',
  after = proposalType === 'https-upgrade-candidate' ? 'https://example.com/path' : '聯絡我們',
} = {}) => ({
  id,
  workspaceId,
  projectId,
  recommendationId: `rec-${id}`,
  ruleCode: proposalType === 'https-upgrade-candidate' ? 'R008' : 'R010',
  proposalType,
  sourceEntityId,
  status,
  title: `方案 ${id}`,
  summary: 'safe summary',
  generatedBy: 'rule',
  snapshot: {
    id: `snapshot-${id}`,
    recommendationId: `rec-${id}`,
    ruleCode: proposalType === 'https-upgrade-candidate' ? 'R008' : 'R010',
    workspaceId,
    projectId,
    status: 'preview',
    title: `方案 ${id}`,
    summary: 'safe summary',
    changes: [{
      id: `change-${id}`,
      entityType: 'project_area',
      entityId: sourceEntityId,
      field,
      operation: proposalType === 'https-upgrade-candidate' ? 'replace' : 'set',
      before,
      after,
      reason: 'safe',
    }],
    warnings: [],
    generatedBy: 'rule',
    canApply: false,
  },
  sourceFingerprint: `fp-${id}`,
  createdByUserId: 'editor-a',
  createdByName: 'Editor',
  reviewedByUserId: 'editor-a',
  reviewedByName: 'Editor',
  approvedByUserId: status === 'approved' ? 'admin-a' : null,
  approvedByName: status === 'approved' ? 'Admin' : null,
  rejectedByUserId: null,
  rejectedByName: null,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  reviewedAt: '2026-08-09T00:00:00.000Z',
  approvedAt: status === 'approved' ? '2026-08-09T00:00:00.000Z' : null,
  rejectedAt: null,
  executedAt: status === 'executed' ? '2026-08-09T00:00:00.000Z' : null,
});

const build = (proposals, options = {}) => buildCompositeOperationPlan({
  id: options.id || 'plan-a',
  workspaceId: options.workspaceId || 'ws-a',
  projectId: options.projectId || 'project-a',
  proposals,
  context: options.context || context(),
  actorUserId: 'editor-a',
  now: '2026-08-09T00:00:00.000Z',
});

test('P001 only creates a LOW Plan', async () => {
  const plan = await build([{ proposal: storedProposal() }]);
  assert.equal(plan.riskLevel, 'LOW');
  assert.equal(plan.steps[0].operationType, 'SET_PROJECT_AREA_DISPLAY_TEXT');
  assert.equal(plan.preflight.allowed, true);
});

test('P002 only creates a MEDIUM Plan with fresh SAFE probe requirement', async () => {
  const p002 = storedProposal({ id: 'proposal-p002', proposalType: 'https-upgrade-candidate', sourceEntityId: 'area-b' });
  const plan = await build([{ proposal: p002, probeEligibility: 'SAFE' }]);
  assert.equal(plan.riskLevel, 'MEDIUM');
  assert.equal(plan.steps[0].requirements.freshProbeRequired, true);
  assert.equal(plan.preflight.allowed, true);
});

test('P001 plus P002 aggregates to MEDIUM', async () => {
  const p001 = storedProposal();
  const p002 = storedProposal({ id: 'proposal-p002', proposalType: 'https-upgrade-candidate', sourceEntityId: 'area-b' });
  const plan = await build([{ proposal: p001 }, { proposal: p002, probeEligibility: 'SAFE' }]);
  assert.equal(plan.riskLevel, 'MEDIUM');
  assert.equal(plan.steps.length, 2);
});

for (const proposalType of ['duplicate-message-review', 'duplicate-postback-review', 'multi-page-structure-draft']) {
  test(`${proposalType} is blocked from executable Plan`, async () => {
    await assert.rejects(
      build([{ proposal: storedProposal({ id: `proposal-${proposalType}`, proposalType }) }]),
      error => error instanceof CompositePlanError && error.code === 'PLAN_CONTAINS_NON_EXECUTABLE_PROPOSAL',
    );
  });
}

test('duplicate Proposal is blocked', async () => {
  const proposal = storedProposal();
  await assert.rejects(
    build([{ proposal }, { proposal }]),
    error => error instanceof CompositePlanError && error.code === 'DUPLICATE_PROPOSAL',
  );
});

test('same entity and same field is a hard PLAN_CONFLICT', async () => {
  const first = storedProposal({ id: 'proposal-a' });
  const second = storedProposal({ id: 'proposal-b' });
  await assert.rejects(
    build([{ proposal: first }, { proposal: second }]),
    error => error instanceof CompositePlanError
      && error.code === 'PLAN_CONFLICT'
      && error.details.conflict === 'SAME_ENTITY_SAME_FIELD',
  );
});

test('same entity different fields creates deterministic dependency', async () => {
  const p001 = storedProposal({ id: 'proposal-a' });
  const p002 = storedProposal({
    id: 'proposal-b', proposalType: 'https-upgrade-candidate', sourceEntityId: 'area-a',
  });
  const planContext = context([{
    id: 'area-a', recordId: 'row-a', actionType: 'postback', data: 'go', displayText: '', uri: 'http://example.com/path',
  }]);
  const plan = await build([
    { proposal: p002, probeEligibility: 'SAFE' },
    { proposal: p001 },
  ], { context: planContext });
  assert.equal(plan.steps[0].proposalId, 'proposal-a');
  assert.deepEqual(plan.steps[1].dependencies, [plan.steps[0].id]);
});

test('stale Proposal is detected', async () => {
  await assert.rejects(
    build([{ proposal: storedProposal({ status: 'stale' }) }]),
    error => error instanceof CompositePlanError && error.code === 'STALE_PROPOSAL',
  );
});

test('missing target is detected', async () => {
  await assert.rejects(
    build([{ proposal: storedProposal() }], { context: context([]) }),
    error => error instanceof CompositePlanError && error.code === 'TARGET_MISSING',
  );
});

test('expired P002 probe blocks preflight without creating an operation', async () => {
  const p002 = storedProposal({ id: 'proposal-p002', proposalType: 'https-upgrade-candidate', sourceEntityId: 'area-b' });
  const plan = await build([{ proposal: p002, probeEligibility: 'EXPIRED' }]);
  assert.equal(plan.preflight.allowed, false);
  assert.deepEqual(
    plan.preflight.checks.find(check => check.code === 'P002_PROBES_FRESH'),
    { code: 'P002_PROBES_FRESH', passed: false, stepId: plan.steps[0].id },
  );
});

test('unapproved Proposal may create draft but blocks approval preflight', async () => {
  const plan = await build([{ proposal: storedProposal({ status: 'reviewed' }) }]);
  assert.equal(plan.status, 'draft');
  assert.equal(plan.preflight.allowed, false);
  assert.equal(plan.preflight.checks.find(check => check.code === 'ALL_PROPOSALS_APPROVED').passed, false);
});

test('Plan fingerprint is stable and independent of input order and Plan id', async () => {
  const p001 = storedProposal();
  const p002 = storedProposal({ id: 'proposal-p002', proposalType: 'https-upgrade-candidate', sourceEntityId: 'area-b' });
  const first = await build([{ proposal: p001 }, { proposal: p002, probeEligibility: 'SAFE' }], { id: 'plan-first' });
  const second = await build([{ proposal: p002, probeEligibility: 'SAFE' }, { proposal: p001 }], { id: 'plan-second' });
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
  assert.deepEqual(first.steps.map(step => step.proposalId), second.steps.map(step => step.proposalId));
});

test('fingerprint changes when expected before value changes', async () => {
  const plan = await build([{ proposal: storedProposal() }]);
  const changed = structuredClone(plan.steps);
  changed[0].snapshot.before = 'changed';
  assert.notEqual(
    plan.sourceFingerprint,
    await fingerprintCompositePlan({ projectId: plan.projectId, policyVersion: plan.policyVersion, steps: changed }),
  );
});

test('Plan snapshot excludes secrets and raw URL query', async () => {
  const p002 = storedProposal({ id: 'proposal-p002', proposalType: 'https-upgrade-candidate', sourceEntityId: 'area-b' });
  const plan = await build([{ proposal: p002, probeEligibility: 'SAFE' }]);
  const serialized = JSON.stringify(plan);
  assert.equal(/token|secret|password|redacted=1/i.test(serialized), false);
});

test('cross workspace Proposal is blocked', async () => {
  await assert.rejects(
    build([{ proposal: storedProposal({ workspaceId: 'ws-b' }) }]),
    error => error instanceof CompositePlanError && error.code === 'CROSS_WORKSPACE_TARGET',
  );
});

test('executed Proposal cannot enter a new Plan', async () => {
  await assert.rejects(
    build([{ proposal: storedProposal({ status: 'executed' }) }]),
    error => error instanceof CompositePlanError && error.code === 'PROPOSAL_ALREADY_EXECUTED',
  );
});

test('Plan lifecycle transitions are deterministic and terminal states cannot approve', () => {
  assert.equal(canTransitionCompositePlan('draft', 'reviewed'), true);
  assert.equal(canTransitionCompositePlan('reviewed', 'approved'), true);
  assert.equal(canTransitionCompositePlan('approved', 'cancelled'), true);
  assert.equal(canTransitionCompositePlan('cancelled', 'approved'), false);
  assert.equal(canTransitionCompositePlan('stale', 'approved'), false);
});

test('Plan Policy follows viewer editor admin owner roles and never exposes execute', () => {
  assert.equal(evaluateCompositePlanPolicy({ actorRole: 'viewer', action: 'create' }).allowed, false);
  assert.equal(evaluateCompositePlanPolicy({ actorRole: 'editor', action: 'create' }).allowed, true);
  assert.equal(evaluateCompositePlanPolicy({ actorRole: 'editor', action: 'review', status: 'draft' }).allowed, true);
  assert.equal(evaluateCompositePlanPolicy({ actorRole: 'admin', action: 'approve', status: 'reviewed', preflightAllowed: true, riskLevel: 'LOW' }).allowed, true);
  assert.equal(evaluateCompositePlanPolicy({ actorRole: 'owner', action: 'approve', status: 'reviewed', preflightAllowed: true, riskLevel: 'MEDIUM' }).allowed, true);
  assert.equal(evaluateCompositePlanPolicy({ actorRole: 'owner', action: 'approve', status: 'reviewed', preflightAllowed: true, riskLevel: 'HIGH' }).allowed, false);
  assert.equal(evaluateCompositePlanPolicy({ actorRole: 'owner', action: 'view' }).capabilities.canExecute, false);
});

test('editor may cancel only own draft Plan', () => {
  assert.equal(evaluateCompositePlanPolicy({
    actorRole: 'editor', action: 'cancel', status: 'draft', actorUserId: 'editor-a', createdByUserId: 'editor-a',
  }).allowed, true);
  assert.equal(evaluateCompositePlanPolicy({
    actorRole: 'editor', action: 'cancel', status: 'draft', actorUserId: 'editor-b', createdByUserId: 'editor-a',
  }).allowed, false);
});

test('0016 migration creates only Plan tables and required indexes', async () => {
  const source = await readFile(new URL('../migrations/0016_composite_operation_plans.sql', import.meta.url), 'utf8');
  for (const table of ['ai_operation_plans', 'ai_operation_plan_steps', 'ai_operation_plan_events']) {
    assert.match(source, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const index of [
    'idx_ai_operation_plans_workspace_project_status',
    'idx_ai_operation_plan_steps_plan_sequence',
    'idx_ai_operation_plan_steps_proposal',
  ]) assert.match(source, new RegExp(index));
  assert.doesNotMatch(source, /(?:ALTER|DROP|UPDATE|DELETE)\s+(?:TABLE\s+)?(?:projects|project_areas|templates|assets)/i);
});

test('Composite Plan code has no executor Gemini R2 LINE or SQL mutation target', async () => {
  const engine = await readFile(new URL('../src/guide/proposals/composite-plan.ts', import.meta.url), 'utf8');
  const persistence = await readFile(new URL('../src/guide/proposals/composite-plan-persistence.ts', import.meta.url), 'utf8');
  for (const forbidden of ['executeOperationPlan', 'executeRollbackPlan', 'Gemini', 'smart_menu_assets', 'api.line.me']) {
    assert.equal((engine + persistence).includes(forbidden), false);
  }
  assert.doesNotMatch(persistence, /UPDATE\s+(?:projects|project_areas|templates|assets)/i);
});

test('evaluatePlanPreflight always includes the nine required checks', async () => {
  const plan = await build([{ proposal: storedProposal() }]);
  assert.deepEqual(evaluatePlanPreflight({ steps: plan.steps, policyVersion: plan.policyVersion }).checks.map(check => check.code), [
    'PLAN_POLICY_VALID', 'ALL_STEPS_EXECUTABLE', 'ALL_PROPOSALS_APPROVED', 'NO_CONFLICTS',
    'ALL_FINGERPRINTS_MATCH', 'ALL_TARGETS_EXIST', 'ALL_TARGETS_IN_WORKSPACE',
    'P002_PROBES_FRESH', 'POLICY_VERSION_VALID',
  ]);
});

test('Plan API accepts only Proposal IDs and rebuilds trusted operation metadata', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/projects/:projectId/operation-plans'");
  const end = source.indexOf("app.get('/api/projects/:projectId/operation-plans'", start);
  const route = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(route, /body\.proposalIds/);
  assert.match(route, /getStoredProposal\(c\.env\.smart_menu_db, workspaceId, projectId, proposalId\)/);
  assert.match(route, /buildCompositeOperationPlan/);
  for (const forged of ['body.operationType', 'body.risk', 'body.targets', 'body.before', 'body.after', 'body.dependencies']) {
    assert.equal(route.includes(forged), false);
  }
});

test('all Plan reads and lifecycle writes are workspace and project scoped', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const persistence = await readFile(new URL('../src/guide/proposals/composite-plan-persistence.ts', import.meta.url), 'utf8');
  assert.match(source, /getStoredCompositePlan\([\s\S]*workspaceIdOf\(c\)[\s\S]*c\.req\.param\('projectId'\)/);
  assert.match(persistence, /WHERE p\.id = \? AND p\.workspace_id = \? AND p\.project_id = \?/);
  assert.match(persistence, /WHERE plan_id = \? AND workspace_id = \? AND project_id = \?/);
  assert.match(persistence, /WHERE id = \? AND workspace_id = \? AND project_id = \? AND status = \?/);
});

test('approved Plan has no execute endpoint and cannot call individual executors', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const planStart = source.indexOf('class CompositePlanApiError');
  const planEnd = source.indexOf("app.post('/api/projects/:projectId/publish'", planStart);
  const routes = source.slice(planStart, planEnd);
  assert.doesNotMatch(routes, /operation-plans[^'\n]*\/execute/);
  assert.doesNotMatch(routes, /executeOperationPlan|executeRollbackPlan/);
  assert.doesNotMatch(routes, /UPDATE\s+(?:projects|project_areas|templates|assets)/i);
  assert.match(routes, /canExecute:\s*false/);
});

test('frontend covers Plan workflow and contains no Plan execute request or force override', async () => {
  const source = await readFile(new URL('../../frontend/src/components/OperationPlanManagement.jsx', import.meta.url), 'utf8');
  for (const marker of [
    'proposalIds', '建立執行計畫', '執行計畫詳情', '低風險', '中風險', '高風險',
    'dependencies', 'PLAN_CONFLICT', '此計畫建立後，部分專案設定已改變。',
    "runPlanAction('review')", "runPlanAction('approve')", "runPlanAction('cancel')",
    '目前版本尚未開放批次執行。',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /operation-plans[^`'\n]*\/execute|force conflict|強制忽略/i);
});

test('Plan persistence audit records policy risk and preflight without secrets', async () => {
  const source = await readFile(new URL('../src/guide/proposals/composite-plan-persistence.ts', import.meta.url), 'utf8');
  assert.match(source, /policyVersion: plan\.policyVersion/);
  assert.match(source, /riskLevel: plan\.riskLevel/);
  assert.match(source, /preflightResult: plan\.preflight\.result/);
  assert.doesNotMatch(source, /token|password|secret/i);
});
