import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  calculateCostMicros,
  executeMeteredAiCall,
  extractGeminiUsageMetadata,
  normalizeAiUsage,
  normalizeUsagePeriod,
} from '../src/ai/usage.ts';
import {
  buildFinalPlanPreflight,
  CompositeExecutionError,
  executeCompositeOperationPlan,
} from '../src/guide/proposals/composite-execution.ts';
import { evaluateCompositePlanPolicy } from '../src/guide/proposals/policy.ts';

class UsageDb {
  constructor(pricing = null) { this.pricing = pricing; this.ledger = []; this.failInsert = false; }
  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() { return sql.includes('FROM ai_pricing_versions') ? db.pricing : null; },
          async run() {
            if (!sql.includes('INSERT INTO ai_usage_ledger')) return { meta: { changes: 0 } };
            if (db.failInsert) throw new Error('metering unavailable');
            db.ledger.push({ sql, args });
            return { meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

const pricing = version => ({
  id: `price-${version}`, version,
  input_price_micros_per_million: 100,
  output_price_micros_per_million: 200,
  cached_input_price_micros_per_million: 25,
  billable_input_price_micros_per_million: 150,
  billable_output_price_micros_per_million: 300,
  billable_cached_input_price_micros_per_million: 40,
});

test('Gemini usage metadata captures input output total cached and reasoning tokens', () => {
  assert.deepEqual(extractGeminiUsageMetadata({ usageMetadata: {
    promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 21,
    cachedContentTokenCount: 3, thoughtsTokenCount: 3,
  } }), { inputTokens: 11, outputTokens: 7, totalTokens: 21, cachedInputTokens: 3, reasoningTokens: 3 });
  assert.deepEqual(normalizeAiUsage({ inputTokens: 2, outputTokens: 3 }), {
    inputTokens: 2, outputTokens: 3, totalTokens: 5, cachedInputTokens: 0, reasoningTokens: 0,
  });
});

test('integer micros cost calculation has no floating financial arithmetic', () => {
  const usage = normalizeAiUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(calculateCostMicros(usage, { input: 100, output: 200, cachedInput: 25 }), 300);
});

test('Recommendation explanation success writes workspace user feature provider model tokens and separate costs', async () => {
  const db = new UsageDb(pricing('v1'));
  const value = await executeMeteredAiCall({
    db, workspaceId: 'ws-a', userId: 'user-a', featureCode: 'recommendation_explanation',
    operationCode: 'R010', provider: 'google', model: 'gemini-test', createId: () => 'usage-1',
    now: () => new Date('2026-08-01T00:00:00Z'),
    execute: async () => ({ value: 'ok', status: 'success', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } }),
  });
  assert.equal(value, 'ok');
  assert.equal(db.ledger.length, 1);
  const args = db.ledger[0].args;
  assert.deepEqual(args.slice(0, 8), ['usage-1', 'ws-a', 'user-a', 'recommendation_explanation', 'R010', 'google', 'gemini-test', null]);
  assert.equal(args[8], 'success');
  assert.equal(args[14], 300);
  assert.equal(args[15], 450);
  assert.equal(args[22], 'v1');
});

test('failed fallback and cached usage are never billable; cached provider cost is zero', async () => {
  for (const status of ['failed', 'fallback', 'cached']) {
    const db = new UsageDb(pricing('v1'));
    await executeMeteredAiCall({
      db, workspaceId: 'ws-a', userId: 'user-a', featureCode: 'recommendation_explanation',
      provider: 'google', model: 'gemini-test',
      execute: async () => ({ value: status, status, usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } }),
    });
    assert.equal(db.ledger[0].args[15], 0, `${status} billable`);
    if (status === 'cached') assert.equal(db.ledger[0].args[14], 0);
  }
});

test('pricing snapshots are immutable ledger values and are not rewritten by later prices', async () => {
  const db = new UsageDb(pricing('v1'));
  const call = () => executeMeteredAiCall({
    db, workspaceId: 'ws-a', userId: 'user-a', featureCode: 'recommendation_explanation',
    provider: 'google', model: 'gemini-test',
    execute: async () => ({ value: true, status: 'success', usage: { inputTokens: 10 } }),
  });
  await call();
  db.pricing = { ...pricing('v2'), input_price_micros_per_million: 999 };
  await call();
  assert.equal(db.ledger[0].args[16], '100');
  assert.equal(db.ledger[0].args[22], 'v1');
  assert.equal(db.ledger[1].args[16], '999');
  assert.equal(db.ledger[1].args[22], 'v2');
});

test('metering DB failure never breaks a successful AI result', async () => {
  const db = new UsageDb(pricing('v1'));
  db.failInsert = true;
  const value = await executeMeteredAiCall({
    db, workspaceId: 'ws-a', featureCode: 'recommendation_explanation', provider: 'google', model: 'gemini-test',
    logger: () => {}, execute: async () => ({ value: 'AI response', status: 'success' }),
  });
  assert.equal(value, 'AI response');
});

test('usage period defaults to the UTC month and rejects inverted periods', () => {
  assert.deepEqual(normalizeUsagePeriod('', '', new Date('2026-08-09T03:00:00Z')), {
    from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z',
  });
  assert.throws(() => normalizeUsagePeriod('2026-09-01', '2026-08-01'), /INVALID_USAGE_PERIOD/);
});

test('metering schema stores metadata only and has no price seed, prompt completion or secrets', async () => {
  const migration = await readFile(new URL('../migrations/0017_ai_usage_and_plan_execution.sql', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/ai/usage.ts', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_usage_ledger/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_pricing_versions/);
  assert.doesNotMatch(migration, /INSERT INTO ai_pricing_versions/i);
  for (const forbidden of ['prompt TEXT', 'completion TEXT', 'secret TEXT', 'token TEXT', 'REAL']) {
    assert.doesNotMatch(migration, new RegExp(forbidden, 'i'));
  }
  assert.doesNotMatch(source, /prompt\s*:|completion\s*:|GEMINI_API_KEY|LINE_CHANNEL_ACCESS_TOKEN/);
});

test('Tenant and System Admin usage APIs enforce scoped aggregation policy', async () => {
  const app = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const usage = await readFile(new URL('../src/ai/usage.ts', import.meta.url), 'utf8');
  assert.match(app, /GET|app\.get\('\/api\/ai-usage\/summary'/);
  assert.match(app, /app\.get\('\/api\/system\/ai-usage\/summary'/);
  assert.match(app, /requireSystemAdmin\(c\)/);
  assert.match(usage, /\['owner', 'admin'\]\.includes/);
  assert.match(usage, /AND l\.user_id = \?/);
  assert.match(usage, /byWorkspace/);
  for (const metric of ['input_tokens', 'output_tokens', 'total_tokens', 'provider_cost_micros', 'billable_cost_micros', 'estimated_margin_micros']) {
    assert.match(usage, new RegExp(metric));
  }
});

const preflightChecks = [
  'PLAN_POLICY_VALID', 'ALL_STEPS_EXECUTABLE', 'ALL_PROPOSALS_APPROVED', 'NO_CONFLICTS',
  'ALL_FINGERPRINTS_MATCH', 'ALL_TARGETS_EXIST', 'ALL_TARGETS_IN_WORKSPACE',
  'P002_PROBES_FRESH', 'POLICY_VERSION_VALID',
].map(code => ({ code, passed: true }));

const planStep = (sequence, operationType = 'SET_PROJECT_AREA_DISPLAY_TEXT') => ({
  id: `step-${sequence}`, sequence, proposalId: `proposal-${sequence}`,
  proposalType: operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS' ? 'https-upgrade-candidate' : 'postback-display-text',
  operationType, riskLevel: operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS' ? 'MEDIUM' : 'LOW',
  targetEntityType: 'project_area', targetEntityId: `area-${sequence}`, dependencies: [],
  executable: true, rollbackSupported: true,
  requirements: { approvalRequired: true, freshProbeRequired: operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS', currentStateRequired: true, fingerprintRequired: true },
  snapshot: { title: `Step ${sequence}`, field: 'action_display_text', before: '', after: 'next', proposalStatus: 'approved', proposalFingerprint: `fp-${sequence}`, fingerprintMatches: true, targetExists: true, targetInWorkspace: true, probeEligibility: operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS' ? 'SAFE' : 'NOT_REQUIRED' },
});

const approvedPlan = steps => ({
  id: 'plan-1', workspaceId: 'ws-a', projectId: 'project-a', title: 'Plan', status: 'approved', riskLevel: 'MEDIUM', policyVersion: '1',
  steps, preflight: { allowed: true, result: 'PASS', checks: preflightChecks }, sourceFingerprint: 'plan-fp',
  createdByUserId: 'owner-a', reviewedByUserId: 'owner-a', approvedByUserId: 'owner-a', cancelledByUserId: null,
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', reviewedAt: null, approvedAt: null, cancelledAt: null,
});

const prepared = step => ({
  step,
  proposal: { id: step.proposalId, workspaceId: 'ws-a', projectId: 'project-a', status: 'approved', sourceFingerprint: `fp-${step.sequence}` },
  sourceFingerprint: `fp-${step.sequence}`,
  operationPlan: { operationType: step.operationType, probe: step.operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS' ? { status: 'SAFE' } : null },
});

class RunDb {
  constructor() { this.planStatus = 'approved'; this.runs = new Map(); this.steps = new Map(); this.events = []; }
  prepare(sql) {
    const db = this;
    return { bind(...args) { return { sql, args, run: () => db.exec(sql, args), first: () => db.first(sql), all: () => db.all(sql, args) }; } };
  }
  async batch(statements) { return Promise.all(statements.map(statement => this.exec(statement.sql, statement.args))); }
  async first(sql) { return sql.includes('SELECT status FROM ai_operation_plans') ? { status: this.planStatus } : null; }
  async all(sql, args) {
    if (sql.includes('FROM ai_operation_plan_runs')) return { results: [...this.runs.values()].map(run => ({ ...run, actor_name: 'Admin' })) };
    if (sql.includes('FROM ai_operation_plan_run_steps')) return { results: [...this.steps.values()].filter(step => step.run_id === args[0]).sort((a, b) => a.sequence - b.sequence) };
    return { results: [] };
  }
  async exec(sql, args) {
    const normalized = sql.replace(/\s+/g, ' ');
    if (normalized.includes("UPDATE ai_operation_plans SET status = 'executing'")) {
      if (this.planStatus !== 'approved') return { meta: { changes: 0 } };
      this.planStatus = 'executing'; return { meta: { changes: 1 } };
    }
    if (normalized.includes('INSERT INTO ai_operation_plan_runs')) {
      this.runs.set(args[0], { id: args[0], workspace_id: args[1], project_id: args[2], plan_id: args[3], status: 'executing', actor_user_id: args[4], started_at: args[5], completed_at: null, failure_step_id: null, error_code: null });
    } else if (normalized.includes('INSERT INTO ai_operation_plan_run_steps')) {
      this.steps.set(args[2], { id: args[0], run_id: args[1], plan_step_id: args[2], status: 'pending', sequence: args[3], operation_log_id: null, rollback_operation_log_id: null, error_code: null, started_at: null, completed_at: null });
    } else if (normalized.includes('INSERT INTO ai_operation_plan_events')) {
      this.events.push({ type: args[4], metadata: args[8] });
    } else if (normalized.includes("SET status = 'executing', started_at")) {
      Object.assign(this.steps.get(args[2]), { status: 'executing', started_at: args[0] });
    } else if (normalized.includes("SET status = 'succeeded', operation_log_id")) {
      Object.assign(this.steps.get(args[3]), { status: 'succeeded', operation_log_id: args[0], completed_at: args[1] });
    } else if (normalized.includes("SET status = 'failed', error_code")) {
      const step = this.steps.get(args[3]); if (step) Object.assign(step, { status: 'failed', error_code: args[0], completed_at: args[1] });
    } else if (normalized.includes("SET status = 'rollback_succeeded'")) {
      Object.assign(this.steps.get(args[3]), { status: 'rollback_succeeded', rollback_operation_log_id: args[0], completed_at: args[1] });
    } else if (normalized.includes("SET status = 'rollback_failed'")) {
      Object.assign(this.steps.get(args[3]), { status: 'rollback_failed', error_code: args[0], completed_at: args[1] });
    } else if (normalized.includes('UPDATE ai_operation_plan_runs SET status = ?')) {
      const run = this.runs.get(args[4]); Object.assign(run, { status: args[0], completed_at: args[1], failure_step_id: args[2], error_code: args[3] });
      return { meta: { changes: 1 } };
    } else if (normalized.includes('UPDATE ai_operation_plans SET status = ?')) {
      this.planStatus = args[0]; return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
}

test('AI Usage frontend is wired for tenant and System Admin without exposing restricted tenant navigation', async () => {
  const app = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../../frontend/src/components/AIUsagePanel.jsx', import.meta.url), 'utf8');
  assert.match(app, /import AIUsagePanel/);
  assert.match(app, /<AIUsagePanel request=\{authFetch\} systemAdmin=\{isPlatformAdminMode\}/);
  assert.match(app, /currentView === 'templates' && isPlatformAdminMode/);
  const tenantNavigation = app.slice(app.indexOf('const visibleNavigation'), app.indexOf('const navigateHome'));
  assert.ok(tenantNavigation.includes("return ['dashboard', 'projects', 'templates', 'crm', 'campaigns', 'commerce', 'travel', 'ai-usage'].includes(item.id);"));
  assert.equal(tenantNavigation.includes("return ['dashboard', 'projects', 'templates', 'crm', 'ai-usage', 'accounts'"), false);
  for (const marker of ['byWorkspace', 'byUser', 'byFeature', 'byModel', 'billableCostMicros']) assert.match(panel, new RegExp(marker));
});
test('final preflight contains every execution-time safety gate', () => {
  const steps = [planStep(1), planStep(2, 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS')];
  const result = buildFinalPlanPreflight({ plan: approvedPlan(steps), preparedSteps: steps.map(prepared) });
  assert.equal(result.allowed, true);
  for (const code of ['PLAN_APPROVED', 'PLAN_NOT_STALE', 'ALL_PROPOSALS_NOT_EXECUTED', 'ALL_REQUIRED_ROLLBACKS_AVAILABLE', 'P002_PROBES_FRESH']) {
    assert.equal(result.checks.find(check => check.code === code)?.passed, true);
  }
});

test('viewer/editor cannot execute while admin/owner can execute approved passing Plan', () => {
  for (const role of ['viewer', 'editor']) assert.equal(evaluateCompositePlanPolicy({ actorRole: role, action: 'execute', status: 'approved', preflightAllowed: true, riskLevel: 'LOW' }).allowed, false);
  for (const role of ['admin', 'owner']) assert.equal(evaluateCompositePlanPolicy({ actorRole: role, action: 'execute', status: 'approved', preflightAllowed: true, riskLevel: 'LOW' }).allowed, true);
});

test('P001 plus P002 executes sequentially and links operation logs to one run', async () => {
  const db = new RunDb();
  const steps = [planStep(1), planStep(2, 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS')];
  const order = [];
  const run = await executeCompositeOperationPlan({
    db, plan: approvedPlan(steps), actor: { userId: 'admin-a', role: 'admin' }, confirmation: true,
    prepareStep: async step => prepared(step),
    executeStep: async item => { order.push(item.step.id); return { id: `op-${item.step.sequence}` }; },
    rollbackStep: async () => { throw new Error('not expected'); },
  });
  assert.deepEqual(order, ['step-1', 'step-2']);
  assert.equal(run.status, 'executed');
  assert.deepEqual(run.steps.map(step => step.operationLogId), ['op-1', 'op-2']);
  assert.equal(db.planStatus, 'executed');
});

test('duplicate and concurrent execution are conditionally locked', async () => {
  const steps = [planStep(1)];
  for (const state of ['executing', 'executed']) {
    const db = new RunDb(); db.planStatus = state;
    await assert.rejects(() => executeCompositeOperationPlan({
      db, plan: { ...approvedPlan(steps), status: state }, actor: { userId: 'owner-a', role: 'owner' }, confirmation: true,
      prepareStep: async step => prepared(step), executeStep: async () => ({ id: 'op' }), rollbackStep: async () => ({ id: 'rb' }),
    }), error => error instanceof CompositeExecutionError && error.code === (state === 'executing' ? 'PLAN_ALREADY_EXECUTING' : 'PLAN_ALREADY_EXECUTED'));
  }
});

test('Step failure compensates successful steps in reverse order and finishes rolled_back', async () => {
  const db = new RunDb();
  const steps = [planStep(1), planStep(2), planStep(3)];
  const rollbackOrder = [];
  const run = await executeCompositeOperationPlan({
    db, plan: approvedPlan(steps), actor: { userId: 'owner-a', role: 'owner' }, confirmation: true,
    prepareStep: async step => prepared(step),
    executeStep: async item => { if (item.step.sequence === 3) throw new Error('step failed'); return { id: `op-${item.step.sequence}` }; },
    rollbackStep: async item => { rollbackOrder.push(item.step.sequence); return { id: `rb-${item.step.sequence}` }; },
  });
  assert.deepEqual(rollbackOrder, [2, 1]);
  assert.equal(run.status, 'rolled_back');
  assert.equal(db.planStatus, 'rolled_back');
});

test('changed compensation target is never overwritten and finishes partially_compensated', async () => {
  const db = new RunDb();
  const steps = [planStep(1), planStep(2)];
  const run = await executeCompositeOperationPlan({
    db, plan: approvedPlan(steps), actor: { userId: 'owner-a', role: 'owner' }, confirmation: true,
    prepareStep: async step => prepared(step),
    executeStep: async item => { if (item.step.sequence === 2) throw new Error('step failed'); return { id: 'op-1' }; },
    rollbackStep: async () => { const error = new Error('ROLLBACK_TARGET_CHANGED'); error.code = 'ROLLBACK_TARGET_CHANGED'; throw error; },
  });
  assert.equal(run.status, 'partially_compensated');
  assert.equal(run.steps[0].status, 'rollback_failed');
  assert.equal(db.planStatus, 'partially_compensated');
});

test('Plan execution is deterministic and creates no AI usage', async () => {
  const source = await readFile(new URL('../src/guide/proposals/composite-execution.ts', import.meta.url), 'utf8');
  for (const forbidden of ['executeMeteredAiCall', 'ai_usage_ledger', 'Gemini', 'requestGemini', 'fetch(', 'Promise.all(input.plan.steps']) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /\[\.\.\.succeeded\]\.reverse\(\)/);
});

test('Plan execution migration and endpoint preserve tenant, Template, R2 and LINE boundaries', async () => {
  const migration = await readFile(new URL('../migrations/0017_ai_usage_and_plan_execution.sql', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_operation_plan_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_operation_plan_run_steps/);
  assert.match(migration, /idx_ai_operation_plan_one_active_run/);
  const start = app.indexOf("app.post('/api/projects/:projectId/operation-plans/:planId/execute'");
  const end = app.indexOf("app.get('/api/projects/:projectId/intelligence/summary'", start);
  const route = app.slice(start, end);
  assert.match(route, /workspaceId|plan\.workspaceId/);
  assert.doesNotMatch(route, /UPDATE\s+templates|smart_menu_assets|api\.line\.me|LINE_CHANNEL_ACCESS_TOKEN/);
  assert.doesNotMatch(route, /body\.(?:steps|operationType|target|before|after|probeId|risk)/);
});
