import type { CompositeOperationPlan, OperationPlanStep } from './composite-plan.ts';
import type { OperationLog, OperationPlan } from './execution.ts';
import type { StoredProposal } from './persistence.ts';
import { OPERATION_POLICY_VERSION } from './policy.ts';

export type PlanExecutionStatus = 'executing' | 'executed' | 'failed' | 'rolled_back' | 'partially_compensated';
export type PlanRunStepStatus = 'pending' | 'executing' | 'succeeded' | 'failed' | 'rollback_succeeded' | 'rollback_failed';

export type PreparedPlanStep = {
  step: OperationPlanStep;
  proposal: StoredProposal;
  operationPlan: OperationPlan;
  sourceFingerprint: string;
};

export type FinalPlanPreflight = {
  allowed: boolean;
  result: 'PASS' | 'BLOCKED';
  checks: Array<{ code: string; passed: boolean; stepId?: string }>;
};

export type PlanExecutionRunStep = {
  id: string;
  planStepId: string;
  sequence: number;
  status: PlanRunStepStatus;
  operationLogId: string | null;
  rollbackOperationLogId: string | null;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type PlanExecutionRun = {
  id: string;
  planId: string;
  status: PlanExecutionStatus;
  actorUserId: string;
  actorName: string | null;
  startedAt: string;
  completedAt: string | null;
  failureStepId: string | null;
  errorCode: string | null;
  steps: PlanExecutionRunStep[];
};

export class CompositeExecutionError extends Error {
  readonly code: string;
  readonly preflight?: FinalPlanPreflight;
  constructor(code: string, preflight?: FinalPlanPreflight) {
    super(code);
    this.name = 'CompositeExecutionError';
    this.code = code;
    this.preflight = preflight;
  }
}

const clean = (value: unknown, maximum = 160) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum);
const recordId = (prefix: string) => `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
const isoNow = () => new Date().toISOString();

export function buildFinalPlanPreflight(input: {
  plan: CompositeOperationPlan;
  preparedSteps: PreparedPlanStep[];
}): FinalPlanPreflight {
  const { plan, preparedSteps } = input;
  const base = new Map(plan.preflight.checks.map(check => [check.code, check.passed]));
  const checks = [
    { code: 'PLAN_POLICY_VALID', passed: base.get('PLAN_POLICY_VALID') === true },
    { code: 'PLAN_APPROVED', passed: plan.status === 'approved' },
    { code: 'PLAN_NOT_STALE', passed: plan.status !== 'stale' },
    { code: 'POLICY_VERSION_VALID', passed: plan.policyVersion === OPERATION_POLICY_VERSION && base.get('POLICY_VERSION_VALID') === true },
    { code: 'ALL_PROPOSALS_APPROVED', passed: preparedSteps.length === plan.steps.length && preparedSteps.every(item => item.proposal.status === 'approved') },
    { code: 'ALL_PROPOSALS_NOT_EXECUTED', passed: preparedSteps.every(item => item.proposal.status !== 'executed') },
    { code: 'ALL_TARGETS_EXIST', passed: base.get('ALL_TARGETS_EXIST') === true },
    { code: 'ALL_TARGETS_IN_WORKSPACE', passed: base.get('ALL_TARGETS_IN_WORKSPACE') === true },
    { code: 'ALL_FINGERPRINTS_MATCH', passed: base.get('ALL_FINGERPRINTS_MATCH') === true && preparedSteps.every(item => item.proposal.sourceFingerprint === item.sourceFingerprint) },
    { code: 'NO_CONFLICTS', passed: base.get('NO_CONFLICTS') === true },
    { code: 'P002_PROBES_FRESH', passed: base.get('P002_PROBES_FRESH') === true && preparedSteps.every(item => item.step.operationType !== 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS' || item.operationPlan.probe?.status === 'SAFE') },
    { code: 'ALL_STEPS_EXECUTABLE', passed: base.get('ALL_STEPS_EXECUTABLE') === true && preparedSteps.every(item => item.step.executable) },
    { code: 'ALL_REQUIRED_ROLLBACKS_AVAILABLE', passed: preparedSteps.every(item => item.step.rollbackSupported) },
  ];
  return { allowed: checks.every(check => check.passed), result: checks.every(check => check.passed) ? 'PASS' : 'BLOCKED', checks };
}

async function appendEvent(db: D1Database, input: {
  plan: CompositeOperationPlan;
  eventType: string;
  actorUserId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  metadata?: Record<string, unknown>;
  at?: string;
}): Promise<void> {
  const metadata = Object.fromEntries(Object.entries(input.metadata || {})
    .map(([key, value]) => [clean(key, 60), clean(value, 180)])
    .filter(([key, value]) => key && value));
  await db.prepare(`
    INSERT INTO ai_operation_plan_events (
      id, plan_id, workspace_id, project_id, event_type, actor_user_id,
      from_status, to_status, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    recordId('aiope'), input.plan.id, input.plan.workspaceId, input.plan.projectId,
    input.eventType, clean(input.actorUserId) || null, clean(input.fromStatus) || null,
    clean(input.toStatus) || null, JSON.stringify(metadata), input.at || isoNow(),
  ).run();
}

export async function listPlanExecutionRuns(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  planId: string,
): Promise<PlanExecutionRun[]> {
  const runs = await db.prepare(`
    SELECT r.*, u.display_name AS actor_name
    FROM ai_operation_plan_runs r
    LEFT JOIN users u ON u.id = r.actor_user_id
    WHERE r.plan_id = ? AND r.workspace_id = ? AND r.project_id = ?
    ORDER BY r.created_at DESC, r.id DESC
  `).bind(planId, workspaceId, projectId).all<Record<string, unknown>>();
  const output: PlanExecutionRun[] = [];
  for (const row of runs.results || []) {
    const steps = await db.prepare(`
      SELECT * FROM ai_operation_plan_run_steps
      WHERE run_id = ? ORDER BY sequence ASC, id ASC
    `).bind(row.id).all<Record<string, unknown>>();
    output.push({
      id: clean(row.id), planId: clean(row.plan_id), status: clean(row.status) as PlanExecutionStatus,
      actorUserId: clean(row.actor_user_id), actorName: clean(row.actor_name) || null,
      startedAt: clean(row.started_at), completedAt: clean(row.completed_at) || null,
      failureStepId: clean(row.failure_step_id) || null, errorCode: clean(row.error_code) || null,
      steps: (steps.results || []).map((step: Record<string, unknown>) => ({
        id: clean(step.id), planStepId: clean(step.plan_step_id), sequence: Number(step.sequence),
        status: clean(step.status) as PlanRunStepStatus,
        operationLogId: clean(step.operation_log_id) || null,
        rollbackOperationLogId: clean(step.rollback_operation_log_id) || null,
        errorCode: clean(step.error_code) || null,
        startedAt: clean(step.started_at) || null, completedAt: clean(step.completed_at) || null,
      })),
    });
  }
  return output;
}

async function finalizeRun(db: D1Database, input: {
  plan: CompositeOperationPlan;
  runId: string;
  status: PlanExecutionStatus;
  actorUserId: string;
  failureStepId?: string | null;
  errorCode?: string | null;
}): Promise<void> {
  const at = isoNow();
  const results = await db.batch([
    db.prepare(`UPDATE ai_operation_plan_runs SET status = ?, completed_at = ?, failure_step_id = ?, error_code = ? WHERE id = ? AND workspace_id = ? AND project_id = ? AND plan_id = ? AND status = 'executing'`)
      .bind(input.status, at, clean(input.failureStepId) || null, clean(input.errorCode) || null, input.runId, input.plan.workspaceId, input.plan.projectId, input.plan.id),
    db.prepare(`UPDATE ai_operation_plans SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = 'executing'`)
      .bind(input.status, at, input.plan.id, input.plan.workspaceId, input.plan.projectId),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
    throw new CompositeExecutionError('PLAN_FINALIZE_CONFLICT');
  }
  const eventType = input.status === 'executed' ? 'PLAN_EXECUTED'
    : input.status === 'rolled_back' ? 'PLAN_ROLLED_BACK'
      : input.status === 'partially_compensated' ? 'PLAN_PARTIALLY_COMPENSATED' : 'PLAN_FAILED';
  await appendEvent(db, {
    plan: input.plan, eventType, actorUserId: input.actorUserId,
    fromStatus: 'executing', toStatus: input.status,
    metadata: { runId: input.runId, failureStepId: input.failureStepId, errorCode: input.errorCode }, at,
  });
}

export async function executeCompositeOperationPlan(input: {
  db: D1Database;
  plan: CompositeOperationPlan;
  actor: { userId: string; role: string };
  confirmation: boolean;
  prepareStep: (step: OperationPlanStep) => Promise<PreparedPlanStep>;
  executeStep: (prepared: PreparedPlanStep) => Promise<OperationLog>;
  rollbackStep: (prepared: PreparedPlanStep, operationLog: OperationLog) => Promise<OperationLog>;
}): Promise<PlanExecutionRun> {
  if (!['admin', 'owner'].includes(clean(input.actor.role).toLowerCase())) throw new CompositeExecutionError('PLAN_ROLE_NOT_ALLOWED');
  if (input.confirmation !== true) throw new CompositeExecutionError('CONFIRMATION_REQUIRED');
  if (input.plan.status === 'executing') throw new CompositeExecutionError('PLAN_ALREADY_EXECUTING');
  if (input.plan.status === 'executed') throw new CompositeExecutionError('PLAN_ALREADY_EXECUTED');
  if (input.plan.status !== 'approved') throw new CompositeExecutionError('PLAN_NOT_APPROVED');

  const initiallyPrepared: PreparedPlanStep[] = [];
  try {
    for (const step of [...input.plan.steps].sort((a, b) => a.sequence - b.sequence)) {
      initiallyPrepared.push(await input.prepareStep(step));
    }
  } catch {
    throw new CompositeExecutionError('PRECHECK_FAILED');
  }
  const preflight = buildFinalPlanPreflight({ plan: input.plan, preparedSteps: initiallyPrepared });
  if (!preflight.allowed) throw new CompositeExecutionError('PRECHECK_FAILED', preflight);

  const runId = recordId('aiopr');
  const startedAt = isoNow();
  const lock = await input.db.prepare(`
    UPDATE ai_operation_plans SET status = 'executing', updated_at = ?
    WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = 'approved'
  `).bind(startedAt, input.plan.id, input.plan.workspaceId, input.plan.projectId).run();
  if (Number(lock.meta?.changes || 0) !== 1) {
    const current = await input.db.prepare(`SELECT status FROM ai_operation_plans WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1`)
      .bind(input.plan.id, input.plan.workspaceId, input.plan.projectId).first<Record<string, unknown>>();
    const status = clean(current?.status);
    throw new CompositeExecutionError(status === 'executing' ? 'PLAN_ALREADY_EXECUTING' : status === 'executed' ? 'PLAN_ALREADY_EXECUTED' : 'PLAN_EXECUTION_CONFLICT');
  }

  try {
    await input.db.batch([
      input.db.prepare(`INSERT INTO ai_operation_plan_runs (id, workspace_id, project_id, plan_id, status, actor_user_id, started_at, created_at) VALUES (?, ?, ?, ?, 'executing', ?, ?, ?)`)
        .bind(runId, input.plan.workspaceId, input.plan.projectId, input.plan.id, input.actor.userId, startedAt, startedAt),
      ...input.plan.steps.map(step => input.db.prepare(`INSERT INTO ai_operation_plan_run_steps (id, run_id, plan_step_id, status, sequence, created_at) VALUES (?, ?, ?, 'pending', ?, ?)`)
        .bind(recordId('aioprs'), runId, step.id, step.sequence, startedAt)),
    ]);
    await appendEvent(input.db, { plan: input.plan, eventType: 'PLAN_EXECUTION_STARTED', actorUserId: input.actor.userId, fromStatus: 'approved', toStatus: 'executing', metadata: { runId }, at: startedAt });
  } catch (error) {
    await input.db.prepare(`UPDATE ai_operation_plans SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = 'executing'`)
      .bind(input.plan.id, input.plan.workspaceId, input.plan.projectId).run().catch(() => {});
    throw error;
  }

  const succeeded: Array<{ prepared: PreparedPlanStep; log: OperationLog }> = [];
  let failureStep: OperationPlanStep | null = null;
  let failureCode = '';
  try {
    for (const planned of initiallyPrepared) {
      failureStep = planned.step;
      const stepStartedAt = isoNow();
      await input.db.prepare(`UPDATE ai_operation_plan_run_steps SET status = 'executing', started_at = ? WHERE run_id = ? AND plan_step_id = ? AND status = 'pending'`)
        .bind(stepStartedAt, runId, planned.step.id).run();
      await appendEvent(input.db, { plan: input.plan, eventType: 'PLAN_STEP_STARTED', actorUserId: input.actor.userId, metadata: { runId, stepId: planned.step.id, sequence: planned.step.sequence }, at: stepStartedAt });

      const rebuilt = await input.prepareStep(planned.step);
      const log = await input.executeStep(rebuilt);
      succeeded.push({ prepared: rebuilt, log });
      const stepCompletedAt = isoNow();
      await input.db.prepare(`UPDATE ai_operation_plan_run_steps SET status = 'succeeded', operation_log_id = ?, completed_at = ? WHERE run_id = ? AND plan_step_id = ? AND status = 'executing'`)
        .bind(log.id, stepCompletedAt, runId, planned.step.id).run();
      await appendEvent(input.db, { plan: input.plan, eventType: 'PLAN_STEP_SUCCEEDED', actorUserId: input.actor.userId, metadata: { runId, stepId: planned.step.id, operationLogId: log.id }, at: stepCompletedAt });
      failureStep = null;
    }
    await finalizeRun(input.db, { plan: input.plan, runId, status: 'executed', actorUserId: input.actor.userId });
  } catch (error) {
    failureCode = clean((error as { code?: unknown; message?: unknown })?.code || (error as { message?: unknown })?.message || 'PLAN_STEP_FAILED');
    if (failureStep) {
      const at = isoNow();
      await input.db.prepare(`UPDATE ai_operation_plan_run_steps SET status = 'failed', error_code = ?, completed_at = ? WHERE run_id = ? AND plan_step_id = ? AND status IN ('pending', 'executing')`)
        .bind(failureCode, at, runId, failureStep.id).run().catch(() => {});
      await appendEvent(input.db, { plan: input.plan, eventType: 'PLAN_STEP_FAILED', actorUserId: input.actor.userId, metadata: { runId, stepId: failureStep.id, errorCode: failureCode }, at }).catch(() => {});
    }
    if (succeeded.length === 0) {
      await finalizeRun(input.db, { plan: input.plan, runId, status: 'failed', actorUserId: input.actor.userId, failureStepId: failureStep?.id, errorCode: failureCode });
    } else {
      await appendEvent(input.db, { plan: input.plan, eventType: 'PLAN_COMPENSATION_STARTED', actorUserId: input.actor.userId, metadata: { runId, successfulSteps: succeeded.length } }).catch(() => {});
      let rollbackFailed = false;
      for (const item of [...succeeded].reverse()) {
        try {
          const rollbackLog = await input.rollbackStep(item.prepared, item.log);
          await input.db.prepare(`UPDATE ai_operation_plan_run_steps SET status = 'rollback_succeeded', rollback_operation_log_id = ?, completed_at = ? WHERE run_id = ? AND plan_step_id = ?`)
            .bind(rollbackLog.id, isoNow(), runId, item.prepared.step.id).run();
          await appendEvent(input.db, { plan: input.plan, eventType: 'PLAN_STEP_ROLLBACK_SUCCEEDED', actorUserId: input.actor.userId, metadata: { runId, stepId: item.prepared.step.id, rollbackOperationLogId: rollbackLog.id } });
        } catch (rollbackError) {
          rollbackFailed = true;
          const rollbackCode = clean((rollbackError as { code?: unknown; message?: unknown })?.code || (rollbackError as { message?: unknown })?.message || 'ROLLBACK_FAILED');
          await input.db.prepare(`UPDATE ai_operation_plan_run_steps SET status = 'rollback_failed', error_code = ?, completed_at = ? WHERE run_id = ? AND plan_step_id = ?`)
            .bind(rollbackCode, isoNow(), runId, item.prepared.step.id).run().catch(() => {});
          await appendEvent(input.db, { plan: input.plan, eventType: 'PLAN_STEP_ROLLBACK_FAILED', actorUserId: input.actor.userId, metadata: { runId, stepId: item.prepared.step.id, errorCode: rollbackCode } }).catch(() => {});
        }
      }
      await finalizeRun(input.db, {
        plan: input.plan, runId,
        status: rollbackFailed ? 'partially_compensated' : 'rolled_back',
        actorUserId: input.actor.userId, failureStepId: failureStep?.id, errorCode: failureCode,
      });
    }
  }

  const runs = await listPlanExecutionRuns(input.db, input.plan.workspaceId, input.plan.projectId, input.plan.id);
  const run = runs.find(item => item.id === runId);
  if (!run) throw new CompositeExecutionError('PLAN_RUN_NOT_FOUND');
  return run;
}
