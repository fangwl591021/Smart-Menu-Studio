import type { StoredProposal, WorkspaceRole } from './persistence.ts';
import {
  listOperationLogs,
  type OperationLog,
  type OperationType,
} from './execution.ts';

export type RollbackReasonCode =
  | 'ELIGIBLE'
  | 'OPERATION_NOT_SUCCEEDED'
  | 'PROPOSAL_NOT_EXECUTED'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_CHANGED_AFTER_EXECUTION'
  | 'ROLLBACK_ALREADY_COMPLETED'
  | 'OPERATION_NOT_ROLLBACKABLE'
  | 'TENANT_MISMATCH';

export type RollbackEligibility = {
  eligible: boolean;
  reasonCode: RollbackReasonCode;
  message: string;
};

export type RollbackTarget = {
  workspaceId: string;
  projectId: string;
  entityId: string;
  areaIndex: string;
  label: string;
  actionDisplayText: string;
};

export type RollbackPreview = RollbackEligibility & {
  rollbackState: 'available' | 'completed' | 'blocked';
  canRollback: boolean;
  operation: {
    id: string;
    operationType: OperationType;
    executedAt: string;
    executedBy: string;
  } | null;
  target: {
    entityType: 'project_area';
    entityId: string;
    areaIndex: string;
    label: string;
  } | null;
  rollback: {
    current: string;
    restoreTo: string;
  } | null;
};

export type RollbackPlan = {
  proposalId: string;
  operationType: OperationType;
  workspaceId: string;
  projectId: string;
  sourceOperationId: string;
  rootOperationId: string;
  target: {
    entityType: 'project_area';
    entityId: string;
    areaIndex: string;
    areaLabel: string;
  };
  mutation: {
    field: 'action_display_text';
    expectedCurrent: string;
    restoreTo: string;
  };
  actor: {
    userId: string;
    role: 'admin' | 'owner';
  };
};

export class RollbackExecutionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'RollbackExecutionError';
  }
}

const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
export const normalizeDisplayText = (value: unknown): string => value === null || value === undefined || value === ''
  ? ''
  : clean(value);
const recordId = (prefix: string) =>
  `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

const ELIGIBILITY_MESSAGES: Record<RollbackReasonCode, string> = {
  ELIGIBLE: '此操作可以安全回復。',
  OPERATION_NOT_SUCCEEDED: '只有成功的操作可以回復。',
  PROPOSAL_NOT_EXECUTED: '只有已執行的改善方案可以回復。',
  TARGET_NOT_FOUND: '找不到原操作修改的專案區域。',
  TARGET_CHANGED_AFTER_EXECUTION: '此欄位在執行後又被修改，為避免覆蓋較新的資料，系統已阻擋回復。',
  ROLLBACK_ALREADY_COMPLETED: '此操作已經回復。',
  OPERATION_NOT_ROLLBACKABLE: '此操作類型不支援自動回復。',
  TENANT_MISMATCH: '操作資料不屬於目前 Workspace。',
};

const ERROR_MESSAGES: Record<string, string> = {
  ROLLBACK_NOT_AVAILABLE: '目前沒有可回復的成功操作。',
  ROLLBACK_ALREADY_COMPLETED: '此操作已經回復。',
  ROLLBACK_FORBIDDEN: '權限不足。',
  ROLLBACK_TARGET_NOT_FOUND: '找不到原操作修改的專案區域。',
  ROLLBACK_TARGET_CHANGED: ELIGIBILITY_MESSAGES.TARGET_CHANGED_AFTER_EXECUTION,
  ROLLBACK_NOT_SUPPORTED: '此操作類型不支援自動回復。',
  ROLLBACK_EXECUTION_FAILED: '回復失敗，系統未覆寫正式專案資料。',
  ROLLBACK_VERIFICATION_FAILED: '回復後驗證失敗。',
  ROLLBACK_TENANT_MISMATCH: '操作資料不屬於目前 Workspace。',
};

export function rollbackErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.ROLLBACK_EXECUTION_FAILED;
}

export function canRoleRollback(roleValue: string): boolean {
  const role = clean(roleValue).toLowerCase() as WorkspaceRole;
  return (ROLE_LEVEL[role] || 0) >= ROLE_LEVEL.admin;
}

export function evaluateRollbackEligibility(input: {
  operationLog: OperationLog | null;
  currentTarget: RollbackTarget | null;
  proposal: StoredProposal;
}): RollbackEligibility {
  const { operationLog, currentTarget, proposal } = input;
  let reasonCode: RollbackReasonCode = 'ELIGIBLE';

  if (!operationLog || operationLog.revertsOperationId || operationLog.operationType !== 'SET_PROJECT_AREA_DISPLAY_TEXT') {
    reasonCode = 'OPERATION_NOT_ROLLBACKABLE';
  } else if (
    operationLog.workspaceId !== proposal.workspaceId
    || operationLog.projectId !== proposal.projectId
    || (currentTarget && (
      currentTarget.workspaceId !== proposal.workspaceId
      || currentTarget.projectId !== proposal.projectId
      || currentTarget.entityId !== operationLog.targetEntityId
    ))
  ) {
    reasonCode = 'TENANT_MISMATCH';
  } else if (operationLog.status !== 'succeeded') {
    reasonCode = 'OPERATION_NOT_SUCCEEDED';
  } else if (proposal.status !== 'executed') {
    reasonCode = 'PROPOSAL_NOT_EXECUTED';
  } else if (operationLog.rollbackOperationId) {
    reasonCode = 'ROLLBACK_ALREADY_COMPLETED';
  } else if (!currentTarget) {
    reasonCode = 'TARGET_NOT_FOUND';
  } else if (
    normalizeDisplayText(currentTarget.actionDisplayText)
    !== normalizeDisplayText(operationLog.after?.actionDisplayText)
  ) {
    reasonCode = 'TARGET_CHANGED_AFTER_EXECUTION';
  }

  return {
    eligible: reasonCode === 'ELIGIBLE',
    reasonCode,
    message: ELIGIBILITY_MESSAGES[reasonCode],
  };
}

function eligibilityFailureCode(reasonCode: RollbackReasonCode): string {
  if (reasonCode === 'ROLLBACK_ALREADY_COMPLETED') return 'ROLLBACK_ALREADY_COMPLETED';
  if (reasonCode === 'TARGET_NOT_FOUND') return 'ROLLBACK_TARGET_NOT_FOUND';
  if (reasonCode === 'TARGET_CHANGED_AFTER_EXECUTION') return 'ROLLBACK_TARGET_CHANGED';
  if (reasonCode === 'OPERATION_NOT_ROLLBACKABLE') return 'ROLLBACK_NOT_SUPPORTED';
  if (reasonCode === 'TENANT_MISMATCH') return 'ROLLBACK_TENANT_MISMATCH';
  return 'ROLLBACK_NOT_AVAILABLE';
}

export async function buildRollbackContext(input: {
  db: D1Database;
  proposal: StoredProposal;
  role: string;
}): Promise<{
  preview: RollbackPreview;
  operationLog: OperationLog | null;
  currentTarget: RollbackTarget | null;
}> {
  const { db, proposal } = input;
  const operationLogs = await listOperationLogs(db, proposal.workspaceId, proposal.projectId, proposal.id);
  const operationLog = [...operationLogs]
    .reverse()
    .find(log => !log.revertsOperationId) || null;

  let currentTarget: RollbackTarget | null = null;
  if (operationLog?.targetEntityId) {
    const row = await db.prepare(`
      SELECT id, workspace_id, project_id, area_index, label, action_display_text
      FROM project_areas
      WHERE id = ? AND workspace_id = ? AND project_id = ?
      LIMIT 1
    `).bind(
      operationLog.targetEntityId,
      proposal.workspaceId,
      proposal.projectId,
    ).first<Record<string, unknown>>();
    if (row) {
      currentTarget = {
        workspaceId: clean(row.workspace_id),
        projectId: clean(row.project_id),
        entityId: clean(row.id),
        areaIndex: clean(row.area_index),
        label: clean(row.label) || `區域 ${clean(row.area_index)}`,
        actionDisplayText: normalizeDisplayText(row.action_display_text),
      };
    }
  }

  const eligibility = evaluateRollbackEligibility({ operationLog, currentTarget, proposal });
  const completed = eligibility.reasonCode === 'ROLLBACK_ALREADY_COMPLETED';
  return {
    preview: {
      ...eligibility,
      rollbackState: eligibility.eligible ? 'available' : completed ? 'completed' : 'blocked',
      canRollback: eligibility.eligible && canRoleRollback(input.role),
      operation: operationLog ? {
        id: operationLog.id,
        operationType: operationLog.operationType,
        executedAt: operationLog.completedAt || operationLog.createdAt,
        executedBy: operationLog.actorName || '使用者',
      } : null,
      target: operationLog ? {
        entityType: 'project_area',
        entityId: operationLog.targetEntityId,
        areaIndex: currentTarget?.areaIndex || '',
        label: currentTarget?.label || '專案區域',
      } : null,
      rollback: operationLog ? {
        current: currentTarget?.actionDisplayText || '',
        restoreTo: normalizeDisplayText(operationLog.before.actionDisplayText),
      } : null,
    },
    operationLog,
    currentTarget,
  };
}

export function buildRollbackPlan(input: {
  proposal: StoredProposal;
  operationLog: OperationLog | null;
  currentTarget: RollbackTarget | null;
  actor: { userId: string; role: string };
}): RollbackPlan {
  if (!canRoleRollback(input.actor.role)) throw new RollbackExecutionError('ROLLBACK_FORBIDDEN');
  const eligibility = evaluateRollbackEligibility(input);
  if (!eligibility.eligible || !input.operationLog || !input.currentTarget) {
    throw new RollbackExecutionError(eligibilityFailureCode(eligibility.reasonCode));
  }
  const role = clean(input.actor.role).toLowerCase() as 'admin' | 'owner';
  return {
    proposalId: input.proposal.id,
    operationType: input.operationLog.operationType,
    workspaceId: input.proposal.workspaceId,
    projectId: input.proposal.projectId,
    sourceOperationId: input.operationLog.id,
    rootOperationId: input.operationLog.rootOperationId || input.operationLog.id,
    target: {
      entityType: 'project_area',
      entityId: input.currentTarget.entityId,
      areaIndex: input.currentTarget.areaIndex,
      areaLabel: input.currentTarget.label,
    },
    mutation: {
      field: 'action_display_text',
      expectedCurrent: normalizeDisplayText(input.operationLog.after?.actionDisplayText),
      restoreTo: normalizeDisplayText(input.operationLog.before.actionDisplayText),
    },
    actor: { userId: clean(input.actor.userId), role },
  };
}

async function classifyRollbackConflict(db: D1Database, plan: RollbackPlan): Promise<string> {
  const [proposal, source, target, completed] = await Promise.all([
    db.prepare(`SELECT status FROM ai_proposals WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1`)
      .bind(plan.proposalId, plan.workspaceId, plan.projectId).first<Record<string, unknown>>(),
    db.prepare(`SELECT status, operation_type FROM ai_operation_logs WHERE id = ? AND workspace_id = ? AND project_id = ? AND proposal_id = ? LIMIT 1`)
      .bind(plan.sourceOperationId, plan.workspaceId, plan.projectId, plan.proposalId).first<Record<string, unknown>>(),
    db.prepare(`SELECT action_display_text FROM project_areas WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1`)
      .bind(plan.target.entityId, plan.workspaceId, plan.projectId).first<Record<string, unknown>>(),
    db.prepare(`SELECT id FROM ai_operation_logs WHERE workspace_id = ? AND project_id = ? AND proposal_id = ? AND reverts_operation_id = ? AND status = 'succeeded' LIMIT 1`)
      .bind(plan.workspaceId, plan.projectId, plan.proposalId, plan.sourceOperationId).first<Record<string, unknown>>(),
  ]);
  if (completed) return 'ROLLBACK_ALREADY_COMPLETED';
  if (clean(proposal?.status) !== 'executed') return 'ROLLBACK_NOT_AVAILABLE';
  if (!source || clean(source.status) !== 'succeeded') return 'ROLLBACK_NOT_AVAILABLE';
  if (clean(source.operation_type) !== 'SET_PROJECT_AREA_DISPLAY_TEXT') return 'ROLLBACK_NOT_SUPPORTED';
  if (!target) return 'ROLLBACK_TARGET_NOT_FOUND';
  if (normalizeDisplayText(target.action_display_text) !== plan.mutation.expectedCurrent) {
    return 'ROLLBACK_TARGET_CHANGED';
  }
  return 'ROLLBACK_EXECUTION_FAILED';
}

async function recordFailedRollback(
  db: D1Database,
  plan: RollbackPlan,
  logId: string,
  code: string,
): Promise<void> {
  const completedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO ai_operation_logs (
      id, workspace_id, proposal_id, project_id, operation_type,
      target_entity_type, target_entity_id, status, before_snapshot,
      actor_user_id, error_code, error_message, created_at, completed_at,
      reverts_operation_id, root_operation_id
    ) VALUES (?, ?, ?, ?, ?, 'project_area', ?, 'failed', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    logId,
    plan.workspaceId,
    plan.proposalId,
    plan.projectId,
    plan.operationType,
    plan.target.entityId,
    JSON.stringify({ actionDisplayText: plan.mutation.expectedCurrent }),
    plan.actor.userId,
    code,
    rollbackErrorMessage(code),
    completedAt,
    completedAt,
    plan.sourceOperationId,
    plan.rootOperationId,
  ).run();
}

async function rollbackSetProjectAreaDisplayText(
  db: D1Database,
  plan: RollbackPlan,
): Promise<OperationLog> {
  const logId = recordId('aiol');
  const rollbackAt = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO ai_operation_logs (
          id, workspace_id, proposal_id, project_id, operation_type,
          target_entity_type, target_entity_id, status, before_snapshot,
          actor_user_id, created_at, reverts_operation_id, root_operation_id
        ) VALUES (?, ?, ?, ?, ?, 'project_area', ?, 'started', ?, ?, ?, ?, ?)
      `).bind(
        logId,
        plan.workspaceId,
        plan.proposalId,
        plan.projectId,
        plan.operationType,
        plan.target.entityId,
        JSON.stringify({ actionDisplayText: plan.mutation.expectedCurrent }),
        plan.actor.userId,
        rollbackAt,
        plan.sourceOperationId,
        plan.rootOperationId,
      ),
      db.prepare(`
        UPDATE project_areas
        SET action_display_text = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND project_id = ?
          AND COALESCE(action_display_text, '') = ?
          AND EXISTS (
            SELECT 1 FROM ai_proposals
            WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = 'executed'
          )
          AND EXISTS (
            SELECT 1 FROM ai_operation_logs
            WHERE id = ? AND workspace_id = ? AND project_id = ? AND proposal_id = ?
              AND operation_type = 'SET_PROJECT_AREA_DISPLAY_TEXT'
              AND status = 'succeeded' AND reverts_operation_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM ai_operation_logs
            WHERE workspace_id = ? AND project_id = ? AND proposal_id = ?
              AND reverts_operation_id = ? AND status = 'succeeded'
          )
      `).bind(
        plan.mutation.restoreTo,
        plan.target.entityId,
        plan.workspaceId,
        plan.projectId,
        plan.mutation.expectedCurrent,
        plan.proposalId,
        plan.workspaceId,
        plan.projectId,
        plan.sourceOperationId,
        plan.workspaceId,
        plan.projectId,
        plan.proposalId,
        plan.workspaceId,
        plan.projectId,
        plan.proposalId,
        plan.sourceOperationId,
      ),
      db.prepare(`
        UPDATE ai_operation_logs
        SET status = 'succeeded', after_snapshot = ?, completed_at = ?
        WHERE id = ? AND workspace_id = ? AND proposal_id = ?
          AND reverts_operation_id = ? AND status = 'started' AND changes() = 1
          AND EXISTS (
            SELECT 1 FROM project_areas
            WHERE id = ? AND workspace_id = ? AND project_id = ?
              AND COALESCE(action_display_text, '') = ?
          )
      `).bind(
        JSON.stringify({ actionDisplayText: plan.mutation.restoreTo }),
        rollbackAt,
        logId,
        plan.workspaceId,
        plan.proposalId,
        plan.sourceOperationId,
        plan.target.entityId,
        plan.workspaceId,
        plan.projectId,
        plan.mutation.restoreTo,
      ),
      db.prepare(`
        INSERT INTO ai_operation_logs (
          id, workspace_id, proposal_id, project_id, operation_type,
          target_entity_type, target_entity_id, status, before_snapshot,
          actor_user_id, created_at, reverts_operation_id, root_operation_id
        )
        SELECT ?, ?, ?, ?, ?, 'project_area', ?, '__ROLLBACK__', ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM ai_operation_logs rollback
          JOIN ai_operation_logs original ON original.id = rollback.reverts_operation_id
          JOIN ai_proposals proposal ON proposal.id = rollback.proposal_id
          JOIN project_areas target ON target.id = rollback.target_entity_id
          WHERE rollback.id = ? AND rollback.workspace_id = ? AND rollback.project_id = ?
            AND rollback.proposal_id = ? AND rollback.status = 'succeeded'
            AND original.id = ? AND original.workspace_id = ? AND original.status = 'succeeded'
            AND proposal.workspace_id = ? AND proposal.project_id = ? AND proposal.status = 'executed'
            AND target.workspace_id = ? AND target.project_id = ?
            AND COALESCE(target.action_display_text, '') = ?
        )
      `).bind(
        recordId('assert'),
        plan.workspaceId,
        plan.proposalId,
        plan.projectId,
        plan.operationType,
        plan.target.entityId,
        JSON.stringify({ actionDisplayText: plan.mutation.expectedCurrent }),
        plan.actor.userId,
        rollbackAt,
        plan.sourceOperationId,
        plan.rootOperationId,
        logId,
        plan.workspaceId,
        plan.projectId,
        plan.proposalId,
        plan.sourceOperationId,
        plan.workspaceId,
        plan.workspaceId,
        plan.projectId,
        plan.workspaceId,
        plan.projectId,
        plan.mutation.restoreTo,
      ),
    ]);
  } catch {
    const code = await classifyRollbackConflict(db, plan);
    try {
      await recordFailedRollback(db, plan, logId, code);
    } catch {
      console.error(JSON.stringify({ message: 'rollback failure audit write failed', code }));
    }
    throw new RollbackExecutionError(code);
  }

  const [target, proposal, logs] = await Promise.all([
    db.prepare(`SELECT action_display_text FROM project_areas WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1`)
      .bind(plan.target.entityId, plan.workspaceId, plan.projectId).first<Record<string, unknown>>(),
    db.prepare(`SELECT status FROM ai_proposals WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1`)
      .bind(plan.proposalId, plan.workspaceId, plan.projectId).first<Record<string, unknown>>(),
    listOperationLogs(db, plan.workspaceId, plan.projectId, plan.proposalId),
  ]);
  const log = logs.find(item => item.id === logId);
  if (
    !target
    || normalizeDisplayText(target.action_display_text) !== plan.mutation.restoreTo
    || clean(proposal?.status) !== 'executed'
    || log?.status !== 'succeeded'
    || log.revertsOperationId !== plan.sourceOperationId
  ) throw new RollbackExecutionError('ROLLBACK_VERIFICATION_FAILED');
  return log;
}

export const ROLLBACK_EXECUTORS: Record<
  OperationType,
  (db: D1Database, plan: RollbackPlan) => Promise<OperationLog>
> = {
  SET_PROJECT_AREA_DISPLAY_TEXT: rollbackSetProjectAreaDisplayText,
};

export async function executeRollbackPlan(
  db: D1Database,
  plan: RollbackPlan,
): Promise<OperationLog> {
  const executor = ROLLBACK_EXECUTORS[plan.operationType];
  if (!executor) throw new RollbackExecutionError('ROLLBACK_NOT_SUPPORTED');
  return executor(db, plan);
}
