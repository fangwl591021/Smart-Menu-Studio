import type {
  CompositeOperationPlan,
  CompositePlanRisk,
  CompositePlanStatus,
  OperationPlanPreflight,
  OperationPlanStep,
  OperationPlanStepRequirements,
  OperationPlanStepSnapshot,
} from './composite-plan.ts';

export type CompositePlanEventType =
  | 'PLAN_CREATED'
  | 'PLAN_REVIEWED'
  | 'PLAN_APPROVED'
  | 'PLAN_STALE'
  | 'PLAN_CANCELLED'
  | 'PLAN_EXECUTION_STARTED'
  | 'PLAN_STEP_STARTED'
  | 'PLAN_STEP_SUCCEEDED'
  | 'PLAN_STEP_FAILED'
  | 'PLAN_COMPENSATION_STARTED'
  | 'PLAN_STEP_ROLLBACK_SUCCEEDED'
  | 'PLAN_STEP_ROLLBACK_FAILED'
  | 'PLAN_EXECUTED'
  | 'PLAN_FAILED'
  | 'PLAN_ROLLED_BACK'
  | 'PLAN_PARTIALLY_COMPENSATED';

export type CompositePlanEvent = {
  id: string;
  eventType: CompositePlanEventType;
  actorUserId: string | null;
  actorName: string | null;
  fromStatus: CompositePlanStatus | null;
  toStatus: CompositePlanStatus | null;
  metadata: Record<string, string>;
  createdAt: string;
};

const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
const recordId = (prefix: string) =>
  `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function parseMetadata(value: unknown): Record<string, string> {
  const parsed = parseJson<Record<string, unknown>>(value, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([key, item]) => [clean(key), clean(item)])
      .filter(([key, item]) => key && item),
  );
}

function stepFromRow(row: any): OperationPlanStep | null {
  const requirements = parseJson<OperationPlanStepRequirements | null>(row?.requirements_json, null);
  const snapshot = parseJson<OperationPlanStepSnapshot | null>(row?.step_snapshot, null);
  const dependencies = parseJson<unknown[]>(row?.dependencies_json, []);
  if (!requirements || !snapshot || !Array.isArray(dependencies)) return null;
  return {
    id: clean(row.id),
    sequence: Number(row.sequence),
    proposalId: clean(row.proposal_id),
    proposalType: clean(row.proposal_type) as OperationPlanStep['proposalType'],
    operationType: clean(row.operation_type) as OperationPlanStep['operationType'],
    riskLevel: clean(row.risk_level) as CompositePlanRisk,
    targetEntityType: 'project_area',
    targetEntityId: clean(row.target_entity_id),
    dependencies: dependencies.map(clean).filter(Boolean),
    executable: Number(row.executable) === 1,
    rollbackSupported: Number(row.rollback_supported) === 1,
    requirements,
    snapshot,
  };
}

function planFromRow(row: any, steps: OperationPlanStep[]): CompositeOperationPlan | null {
  const preflight = parseJson<OperationPlanPreflight | null>(row?.preflight_json, null);
  if (!preflight || !Array.isArray(preflight.checks)) return null;
  return {
    id: clean(row.id),
    workspaceId: clean(row.workspace_id),
    projectId: clean(row.project_id),
    title: clean(row.title),
    status: clean(row.status) as CompositePlanStatus,
    riskLevel: clean(row.risk_level) as CompositePlanRisk,
    policyVersion: clean(row.policy_version),
    steps,
    preflight,
    sourceFingerprint: clean(row.source_fingerprint),
    createdByUserId: clean(row.created_by_user_id),
    reviewedByUserId: clean(row.reviewed_by_user_id) || null,
    approvedByUserId: clean(row.approved_by_user_id) || null,
    cancelledByUserId: clean(row.cancelled_by_user_id) || null,
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
    reviewedAt: clean(row.reviewed_at) || null,
    approvedAt: clean(row.approved_at) || null,
    cancelledAt: clean(row.cancelled_at) || null,
  };
}

const PLAN_SELECT = `
  SELECT p.*
  FROM ai_operation_plans p
`;

async function listPlanSteps(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  planId: string,
): Promise<OperationPlanStep[]> {
  const result = await db.prepare(`
    SELECT * FROM ai_operation_plan_steps
    WHERE plan_id = ? AND workspace_id = ? AND project_id = ?
    ORDER BY sequence ASC, id ASC
  `).bind(planId, workspaceId, projectId).all();
  return (result.results || []).map(stepFromRow).filter(Boolean) as OperationPlanStep[];
}

export async function getStoredCompositePlan(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  planId: string,
): Promise<CompositeOperationPlan | null> {
  const row = await db.prepare(`${PLAN_SELECT}
    WHERE p.id = ? AND p.workspace_id = ? AND p.project_id = ?
    LIMIT 1
  `).bind(planId, workspaceId, projectId).first();
  if (!row) return null;
  const steps = await listPlanSteps(db, workspaceId, projectId, planId);
  return planFromRow(row, steps);
}

export async function listStoredCompositePlans(
  db: D1Database,
  workspaceId: string,
  projectId: string,
): Promise<CompositeOperationPlan[]> {
  const result = await db.prepare(`${PLAN_SELECT}
    WHERE p.workspace_id = ? AND p.project_id = ?
    ORDER BY p.created_at DESC, p.id DESC
  `).bind(workspaceId, projectId).all();
  const rows = result.results || [];
  return (await Promise.all(rows.map(async (row: any) => {
    const steps = await listPlanSteps(db, workspaceId, projectId, clean(row.id));
    return planFromRow(row, steps);
  }))).filter(Boolean) as CompositeOperationPlan[];
}

export async function listCompositePlanEvents(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  planId: string,
): Promise<CompositePlanEvent[]> {
  const result = await db.prepare(`
    SELECT e.*, actor.display_name AS actor_name
    FROM ai_operation_plan_events e
    LEFT JOIN users actor ON actor.id = e.actor_user_id
    WHERE e.plan_id = ? AND e.workspace_id = ? AND e.project_id = ?
    ORDER BY e.created_at ASC, e.id ASC
  `).bind(planId, workspaceId, projectId).all();
  return (result.results || []).map((row: any) => ({
    id: clean(row.id),
    eventType: clean(row.event_type) as CompositePlanEventType,
    actorUserId: clean(row.actor_user_id) || null,
    actorName: clean(row.actor_name) || null,
    fromStatus: (clean(row.from_status) || null) as CompositePlanStatus | null,
    toStatus: (clean(row.to_status) || null) as CompositePlanStatus | null,
    metadata: parseMetadata(row.metadata_json),
    createdAt: clean(row.created_at),
  }));
}

export async function createStoredCompositePlan(
  db: D1Database,
  plan: CompositeOperationPlan,
): Promise<void> {
  const statements = [
    db.prepare(`
      INSERT INTO ai_operation_plans (
        id, workspace_id, project_id, title, status, risk_level, policy_version,
        source_fingerprint, preflight_json, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      plan.id,
      plan.workspaceId,
      plan.projectId,
      plan.title,
      plan.riskLevel,
      plan.policyVersion,
      plan.sourceFingerprint,
      JSON.stringify(plan.preflight),
      plan.createdByUserId,
      plan.createdAt,
      plan.updatedAt,
    ),
    ...plan.steps.map(step => db.prepare(`
      INSERT INTO ai_operation_plan_steps (
        id, plan_id, workspace_id, project_id, sequence, proposal_id, proposal_type,
        operation_type, risk_level, target_entity_type, target_entity_id,
        dependencies_json, executable, rollback_supported, requirements_json,
        step_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'project_area', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      step.id,
      plan.id,
      plan.workspaceId,
      plan.projectId,
      step.sequence,
      step.proposalId,
      step.proposalType,
      step.operationType,
      step.riskLevel,
      step.targetEntityId,
      JSON.stringify(step.dependencies),
      step.executable ? 1 : 0,
      step.rollbackSupported ? 1 : 0,
      JSON.stringify(step.requirements),
      JSON.stringify(step.snapshot),
      plan.createdAt,
    )),
    db.prepare(`
      INSERT INTO ai_operation_plan_events (
        id, plan_id, workspace_id, project_id, event_type, actor_user_id,
        from_status, to_status, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, 'PLAN_CREATED', ?, NULL, 'draft', ?, ?)
    `).bind(
      recordId('aiope'),
      plan.id,
      plan.workspaceId,
      plan.projectId,
      plan.createdByUserId,
      JSON.stringify({
        policyVersion: plan.policyVersion,
        riskLevel: plan.riskLevel,
        preflightResult: plan.preflight.result,
      }),
      plan.createdAt,
    ),
  ];
  const results = await db.batch(statements);
  if (Number(results[0]?.meta?.changes || 0) !== 1) throw new Error('PLAN_CREATE_CONFLICT');
}

export function canTransitionCompositePlan(
  from: CompositePlanStatus,
  to: CompositePlanStatus,
): boolean {
  return (
    (from === 'draft' && ['reviewed', 'stale', 'cancelled'].includes(to))
    || (from === 'reviewed' && ['approved', 'stale', 'cancelled'].includes(to))
    || (from === 'approved' && ['stale', 'cancelled'].includes(to))
  );
}

export async function updateCompositePlanPreflight(
  db: D1Database,
  plan: CompositeOperationPlan,
  preflight: OperationPlanPreflight,
): Promise<void> {
  const result = await db.prepare(`
    UPDATE ai_operation_plans
    SET preflight_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = ?
  `).bind(
    JSON.stringify(preflight),
    plan.id,
    plan.workspaceId,
    plan.projectId,
    plan.status,
  ).run();
  if (Number(result.meta?.changes || 0) !== 1) throw new Error('PLAN_CONFLICT');
}

export async function transitionStoredCompositePlan(
  db: D1Database,
  input: {
    plan: CompositeOperationPlan;
    toStatus: 'reviewed' | 'approved' | 'stale' | 'cancelled';
    actorUserId?: string;
    preflight: OperationPlanPreflight;
    metadata?: Record<string, string>;
  },
): Promise<void> {
  if (!canTransitionCompositePlan(input.plan.status, input.toStatus)) {
    throw new Error('INVALID_PLAN_TRANSITION');
  }
  const actor = clean(input.actorUserId) || null;
  const transitionAt = new Date().toISOString();
  const eventType: CompositePlanEventType = input.toStatus === 'reviewed'
    ? 'PLAN_REVIEWED'
    : input.toStatus === 'approved'
      ? 'PLAN_APPROVED'
      : input.toStatus === 'cancelled'
        ? 'PLAN_CANCELLED'
        : 'PLAN_STALE';
  const actorColumn = input.toStatus === 'reviewed'
    ? 'reviewed_by_user_id'
    : input.toStatus === 'approved'
      ? 'approved_by_user_id'
      : input.toStatus === 'cancelled'
        ? 'cancelled_by_user_id'
        : null;
  const timeColumn = input.toStatus === 'reviewed'
    ? 'reviewed_at'
    : input.toStatus === 'approved'
      ? 'approved_at'
      : input.toStatus === 'cancelled'
        ? 'cancelled_at'
        : null;
  const auditAssignments = actorColumn && timeColumn
    ? `, ${actorColumn} = ?, ${timeColumn} = ?`
    : '';
  const bindings = actorColumn
    ? [input.toStatus, transitionAt, JSON.stringify(input.preflight), actor, transitionAt,
        input.plan.id, input.plan.workspaceId, input.plan.projectId, input.plan.status]
    : [input.toStatus, transitionAt, JSON.stringify(input.preflight),
        input.plan.id, input.plan.workspaceId, input.plan.projectId, input.plan.status];
  const eventMetadata = {
    policyVersion: input.plan.policyVersion,
    riskLevel: input.plan.riskLevel,
    preflightResult: input.preflight.result,
    ...(input.metadata || {}),
  };
  const results = await db.batch([
    db.prepare(`
      UPDATE ai_operation_plans
      SET status = ?, updated_at = ?, preflight_json = ?${auditAssignments}
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = ?
    `).bind(...bindings),
    db.prepare(`
      INSERT INTO ai_operation_plan_events (
        id, plan_id, workspace_id, project_id, event_type, actor_user_id,
        from_status, to_status, metadata_json, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM ai_operation_plans
        WHERE id = ? AND workspace_id = ? AND project_id = ?
          AND status = ? AND updated_at = ?
      )
    `).bind(
      recordId('aiope'),
      input.plan.id,
      input.plan.workspaceId,
      input.plan.projectId,
      eventType,
      actor,
      input.plan.status,
      input.toStatus,
      JSON.stringify(eventMetadata),
      transitionAt,
      input.plan.id,
      input.plan.workspaceId,
      input.plan.projectId,
      input.toStatus,
      transitionAt,
    ),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) throw new Error('PLAN_CONFLICT');
}
