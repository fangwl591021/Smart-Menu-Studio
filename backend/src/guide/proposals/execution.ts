import type { GuideContext } from '../types.ts';
import type { Proposal, ProposalType } from './types.ts';
import type { ProposalEvent, StoredProposal, WorkspaceRole } from './persistence.ts';

export type OperationType = 'SET_PROJECT_AREA_DISPLAY_TEXT';
export type OperationLogStatus = 'started' | 'succeeded' | 'failed';

export type ProposalExecutionContract = {
  executable: boolean;
  operationType: OperationType | 'NOT_EXECUTABLE';
  targetEntityType: 'project_area' | null;
  targetEntityId: string | null;
};

export type OperationPlan = {
  proposalId: string;
  operationType: OperationType;
  workspaceId: string;
  projectId: string;
  projectName: string;
  target: {
    entityType: 'project_area';
    entityId: string;
    areaIndex: string;
    areaLabel: string;
  };
  mutation: {
    field: 'action_display_text';
    before: '';
    after: string;
  };
  preconditions: string[];
  actor: {
    userId: string;
    role: 'admin' | 'owner';
  };
};

export type OperationLog = {
  id: string;
  workspaceId: string;
  proposalId: string;
  projectId: string;
  operationType: OperationType;
  targetEntityType: 'project_area';
  targetEntityId: string;
  status: OperationLogStatus;
  before: { actionDisplayText: string };
  after: { actionDisplayText: string } | null;
  actorUserId: string;
  actorName: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  revertsOperationId: string | null;
  rootOperationId: string | null;
  rollbackOperationId: string | null;
};

export class OperationExecutionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'OperationExecutionError';
  }
}

const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
const recordId = (prefix: string) =>
  `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

const ERROR_MESSAGES: Record<string, string> = {
  PROPOSAL_NOT_FOUND: '找不到改善方案。',
  PROPOSAL_NOT_APPROVED: '只有已核准方案可以套用。',
  PROPOSAL_ALREADY_EXECUTED: '此改善方案已經套用。',
  PROPOSAL_STALE: '專案內容已變更，此方案已失效。',
  PROPOSAL_NOT_EXECUTABLE: '此類改善方案不能自動套用。',
  FORBIDDEN_ROLE: '權限不足。',
  TARGET_NOT_FOUND: '找不到方案指定的專案區域。',
  TARGET_CHANGED: '專案內容已變更，系統沒有覆寫新的設定。',
  STALE_DURING_EXECUTION: '執行期間專案內容已變更，系統沒有覆寫新的設定。',
  EXECUTION_FAILED: '改善方案套用失敗，正式專案未被修改。',
  VERIFICATION_FAILED: '套用後驗證失敗。',
};

export function operationErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.EXECUTION_FAILED;
}

export function proposalExecutionContract(
  proposalType: ProposalType,
  targetEntityId: string | null = null,
): ProposalExecutionContract {
  if (proposalType === 'postback-display-text') {
    return {
      executable: true,
      operationType: 'SET_PROJECT_AREA_DISPLAY_TEXT',
      targetEntityType: 'project_area',
      targetEntityId,
    };
  }
  return {
    executable: false,
    operationType: 'NOT_EXECUTABLE',
    targetEntityType: null,
    targetEntityId: null,
  };
}

function validDisplayText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 20
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function buildOperationPlan(input: {
  proposal: StoredProposal;
  currentProposal: Proposal;
  context: GuideContext;
  actor: { userId: string; role: string };
}): OperationPlan {
  const { proposal, currentProposal, context } = input;
  const role = clean(input.actor.role).toLowerCase() as WorkspaceRole;
  if ((ROLE_LEVEL[role] || 0) < ROLE_LEVEL.admin) throw new OperationExecutionError('FORBIDDEN_ROLE');
  if (proposal.status === 'executed') throw new OperationExecutionError('PROPOSAL_ALREADY_EXECUTED');
  if (proposal.status === 'stale') throw new OperationExecutionError('PROPOSAL_STALE');
  if (proposal.status !== 'approved') throw new OperationExecutionError('PROPOSAL_NOT_APPROVED');
  if (!proposalExecutionContract(proposal.proposalType).executable) {
    throw new OperationExecutionError('PROPOSAL_NOT_EXECUTABLE');
  }
  if (
    proposal.workspaceId !== context.workspaceId
    || proposal.projectId !== context.project.id
    || currentProposal.workspaceId !== context.workspaceId
    || currentProposal.projectId !== context.project.id
    || proposal.proposalType !== 'postback-display-text'
    || currentProposal.ruleCode !== proposal.ruleCode
  ) throw new OperationExecutionError('PROPOSAL_STALE');

  const changes = currentProposal.changes;
  if (changes.length !== 1) throw new OperationExecutionError('PROPOSAL_NOT_EXECUTABLE');
  const change = changes[0];
  if (
    change.entityType !== 'project_area'
    || change.field !== 'action_display_text'
    || change.operation !== 'set'
    || change.before !== ''
    || !validDisplayText(change.after)
    || (proposal.sourceEntityId && proposal.sourceEntityId !== change.entityId)
  ) throw new OperationExecutionError('PROPOSAL_NOT_EXECUTABLE');

  const area = context.areas.find(item => item.id === change.entityId);
  if (!area?.recordId) throw new OperationExecutionError('TARGET_NOT_FOUND');
  if (area.actionType !== 'postback' || !area.data || area.displayText !== '') {
    throw new OperationExecutionError('TARGET_CHANGED');
  }

  return {
    proposalId: proposal.id,
    operationType: 'SET_PROJECT_AREA_DISPLAY_TEXT',
    workspaceId: context.workspaceId,
    projectId: context.project.id,
    projectName: context.project.name,
    target: {
      entityType: 'project_area',
      entityId: area.recordId,
      areaIndex: area.id,
      areaLabel: area.label,
    },
    mutation: {
      field: 'action_display_text',
      before: '',
      after: change.after,
    },
    preconditions: [
      'proposal.status = approved',
      'proposal.source_fingerprint = current source fingerprint',
      'project_area belongs to current workspace and project',
      "project_area.action_type = 'postback'",
      'project_area.action_data is not empty',
      'project_area.action_display_text is empty',
    ],
    actor: {
      userId: clean(input.actor.userId),
      role: role as 'admin' | 'owner',
    },
  };
}

function safeSnapshot(value: unknown): { actionDisplayText: string } {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return { actionDisplayText: clean((parsed as Record<string, unknown>)?.actionDisplayText) };
  } catch {
    return { actionDisplayText: '' };
  }
}

function operationLogFromRow(row: Record<string, unknown>): OperationLog {
  return {
    id: clean(row.id),
    proposalId: clean(row.proposal_id),
    workspaceId: clean(row.workspace_id),
    projectId: clean(row.project_id),
    operationType: clean(row.operation_type) as OperationType,
    targetEntityType: 'project_area',
    targetEntityId: clean(row.target_entity_id),
    status: clean(row.status) as OperationLogStatus,
    before: safeSnapshot(row.before_snapshot),
    after: row.after_snapshot ? safeSnapshot(row.after_snapshot) : null,
    actorUserId: clean(row.actor_user_id),
    actorName: clean(row.actor_name) || null,
    errorCode: clean(row.error_code) || null,
    errorMessage: clean(row.error_message) || null,
    createdAt: clean(row.created_at),
    completedAt: clean(row.completed_at) || null,
    revertsOperationId: clean(row.reverts_operation_id) || null,
    rootOperationId: clean(row.root_operation_id) || null,
    rollbackOperationId: clean(row.rollback_operation_id) || null,
  };
}

export async function listOperationLogs(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  proposalId: string,
): Promise<OperationLog[]> {
  const result = await db.prepare(`
    SELECT l.*, actor.display_name AS actor_name,
      (
        SELECT rollback.id
        FROM ai_operation_logs rollback
        WHERE rollback.workspace_id = l.workspace_id
          AND rollback.project_id = l.project_id
          AND rollback.proposal_id = l.proposal_id
          AND rollback.reverts_operation_id = l.id
          AND rollback.status = 'succeeded'
        ORDER BY rollback.completed_at DESC, rollback.id DESC
        LIMIT 1
      ) AS rollback_operation_id
    FROM ai_operation_logs l
    LEFT JOIN users actor ON actor.id = l.actor_user_id
    WHERE l.workspace_id = ? AND l.project_id = ? AND l.proposal_id = ?
    ORDER BY l.created_at ASC, l.id ASC
  `).bind(workspaceId, projectId, proposalId).all<Record<string, unknown>>();
  return (result.results || []).map(operationLogFromRow);
}

export function operationLogEvents(logs: OperationLog[]): ProposalEvent[] {
  return logs.flatMap(log => {
    const isRollback = Boolean(log.revertsOperationId);
    const events: ProposalEvent[] = [{
      id: `${log.id}:started`,
      eventType: isRollback ? 'ROLLBACK_STARTED' : 'EXECUTION_STARTED',
      actorUserId: log.actorUserId,
      actorName: log.actorName,
      fromStatus: isRollback ? 'executed' : 'approved',
      toStatus: isRollback ? 'executed' : 'approved',
      metadata: {
        operationType: log.operationType,
        ...(log.revertsOperationId ? { revertsOperationId: log.revertsOperationId } : {}),
      },
      createdAt: log.createdAt,
    }];
    if (log.status === 'succeeded') {
      events.push({
        id: `${log.id}:succeeded`,
        eventType: isRollback ? 'ROLLBACK_SUCCEEDED' : 'EXECUTION_SUCCEEDED',
        actorUserId: log.actorUserId,
        actorName: log.actorName,
        fromStatus: isRollback ? 'executed' : 'approved',
        toStatus: 'executed',
        metadata: {
          operationType: log.operationType,
          ...(log.revertsOperationId ? { revertsOperationId: log.revertsOperationId } : {}),
        },
        createdAt: log.completedAt || log.createdAt,
      });
    } else if (log.status === 'failed') {
      events.push({
        id: `${log.id}:failed`,
        eventType: isRollback && [
          'ROLLBACK_TARGET_CHANGED',
          'ROLLBACK_TARGET_NOT_FOUND',
          'ROLLBACK_ALREADY_COMPLETED',
        ].includes(log.errorCode || '') ? 'ROLLBACK_BLOCKED' : isRollback ? 'ROLLBACK_FAILED' : 'EXECUTION_FAILED',
        actorUserId: log.actorUserId,
        actorName: log.actorName,
        fromStatus: isRollback ? 'executed' : 'approved',
        toStatus: isRollback ? 'executed' : 'approved',
        metadata: { errorCode: log.errorCode || 'EXECUTION_FAILED' },
        createdAt: log.completedAt || log.createdAt,
      });
    }
    return events;
  });
}

async function recordFailedExecution(
  db: D1Database,
  plan: OperationPlan,
  logId: string,
  code: string,
  markStale: boolean,
): Promise<void> {
  const completedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO ai_operation_logs (
        id, workspace_id, proposal_id, project_id, operation_type,
        target_entity_type, target_entity_id, status, before_snapshot,
        after_snapshot, actor_user_id, error_code, error_message, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, 'project_area', ?, 'failed', ?, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = 'failed', after_snapshot = NULL, error_code = excluded.error_code,
        error_message = excluded.error_message, completed_at = excluded.completed_at
    `).bind(
      logId,
      plan.workspaceId,
      plan.proposalId,
      plan.projectId,
      plan.operationType,
      plan.target.entityId,
      JSON.stringify({ actionDisplayText: plan.mutation.before }),
      plan.actor.userId,
      code,
      operationErrorMessage(code),
      completedAt,
      completedAt,
    ),
  ];

  if (markStale) {
    const staleAt = new Date().toISOString();
    statements.push(
      db.prepare(`
        UPDATE ai_proposals
        SET status = 'stale', updated_at = ?
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = 'approved'
      `).bind(staleAt, plan.proposalId, plan.workspaceId, plan.projectId),
      db.prepare(`
        INSERT INTO ai_proposal_events (
          id, workspace_id, proposal_id, event_type, actor_user_id,
          from_status, to_status, metadata_json, created_at
        )
        SELECT ?, ?, ?, 'STALE_DETECTED', NULL, 'approved', 'stale', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM ai_proposals
          WHERE id = ? AND workspace_id = ? AND project_id = ?
            AND status = 'stale' AND updated_at = ?
        )
      `).bind(
        recordId('aipe'),
        plan.workspaceId,
        plan.proposalId,
        JSON.stringify({ reason: code }),
        staleAt,
        plan.proposalId,
        plan.workspaceId,
        plan.projectId,
        staleAt,
      ),
    );
  }
  await db.batch(statements);
}

async function classifyExecutionConflict(db: D1Database, plan: OperationPlan): Promise<string> {
  const [proposal, target] = await Promise.all([
    db.prepare(`
      SELECT status FROM ai_proposals
      WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1
    `).bind(plan.proposalId, plan.workspaceId, plan.projectId).first<Record<string, unknown>>(),
    db.prepare(`
      SELECT action_display_text FROM project_areas
      WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1
    `).bind(plan.target.entityId, plan.workspaceId, plan.projectId).first<Record<string, unknown>>(),
  ]);
  if (clean(proposal?.status) === 'executed') return 'PROPOSAL_ALREADY_EXECUTED';
  if (clean(proposal?.status) === 'stale') return 'PROPOSAL_STALE';
  if (!target) return 'TARGET_NOT_FOUND';
  if (clean(target.action_display_text) !== '') return 'STALE_DURING_EXECUTION';
  return 'EXECUTION_FAILED';
}

async function executeSetProjectAreaDisplayText(
  db: D1Database,
  plan: OperationPlan,
  sourceFingerprint: string,
): Promise<OperationLog> {
  const logId = recordId('aiol');
  const executedAt = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO ai_operation_logs (
          id, workspace_id, proposal_id, project_id, operation_type,
          target_entity_type, target_entity_id, status, before_snapshot,
          actor_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, 'project_area', ?, 'started', ?, ?, ?)
      `).bind(
        logId,
        plan.workspaceId,
        plan.proposalId,
        plan.projectId,
        plan.operationType,
        plan.target.entityId,
        JSON.stringify({ actionDisplayText: plan.mutation.before }),
        plan.actor.userId,
        executedAt,
      ),
      db.prepare(`
        UPDATE project_areas
        SET action_display_text = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND project_id = ?
          AND action_type = 'postback'
          AND trim(COALESCE(action_data, '')) <> ''
          AND (action_display_text IS NULL OR action_display_text = '')
          AND EXISTS (
            SELECT 1 FROM ai_proposals
            WHERE id = ? AND workspace_id = ? AND project_id = ?
              AND status = 'approved' AND source_fingerprint = ?
          )
      `).bind(
        plan.mutation.after,
        plan.target.entityId,
        plan.workspaceId,
        plan.projectId,
        plan.proposalId,
        plan.workspaceId,
        plan.projectId,
        sourceFingerprint,
      ),
      db.prepare(`
        UPDATE ai_operation_logs
        SET status = 'succeeded', after_snapshot = ?, completed_at = ?
        WHERE id = ? AND workspace_id = ? AND proposal_id = ?
          AND status = 'started' AND changes() = 1
          AND EXISTS (
            SELECT 1 FROM project_areas
            WHERE id = ? AND workspace_id = ? AND project_id = ?
              AND action_display_text = ?
          )
      `).bind(
        JSON.stringify({ actionDisplayText: plan.mutation.after }),
        executedAt,
        logId,
        plan.workspaceId,
        plan.proposalId,
        plan.target.entityId,
        plan.workspaceId,
        plan.projectId,
        plan.mutation.after,
      ),
      db.prepare(`
        UPDATE ai_proposals
        SET status = 'executed', executed_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND project_id = ?
          AND status = 'approved' AND source_fingerprint = ?
          AND EXISTS (
            SELECT 1 FROM ai_operation_logs
            WHERE id = ? AND workspace_id = ? AND proposal_id = ?
              AND status = 'succeeded'
          )
      `).bind(
        executedAt,
        executedAt,
        plan.proposalId,
        plan.workspaceId,
        plan.projectId,
        sourceFingerprint,
        logId,
        plan.workspaceId,
        plan.proposalId,
      ),
      db.prepare(`
        INSERT INTO ai_operation_logs (
          id, workspace_id, proposal_id, project_id, operation_type,
          target_entity_type, target_entity_id, status, before_snapshot,
          actor_user_id, created_at
        )
        SELECT ?, ?, ?, ?, ?, 'project_area', ?, '__ROLLBACK__', ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM ai_operation_logs l
          JOIN ai_proposals p ON p.id = l.proposal_id
          JOIN project_areas a ON a.id = l.target_entity_id
          WHERE l.id = ? AND l.workspace_id = ? AND l.proposal_id = ?
            AND l.status = 'succeeded'
            AND p.workspace_id = ? AND p.project_id = ? AND p.status = 'executed'
            AND p.executed_at = ?
            AND a.workspace_id = ? AND a.project_id = ?
            AND a.action_display_text = ?
        )
      `).bind(
        recordId('assert'),
        plan.workspaceId,
        plan.proposalId,
        plan.projectId,
        plan.operationType,
        plan.target.entityId,
        JSON.stringify({ actionDisplayText: plan.mutation.before }),
        plan.actor.userId,
        executedAt,
        logId,
        plan.workspaceId,
        plan.proposalId,
        plan.workspaceId,
        plan.projectId,
        executedAt,
        plan.workspaceId,
        plan.projectId,
        plan.mutation.after,
      ),
    ]);
  } catch {
    const code = await classifyExecutionConflict(db, plan);
    try {
      await recordFailedExecution(
        db,
        plan,
        logId,
        code,
        ['TARGET_NOT_FOUND', 'TARGET_CHANGED', 'STALE_DURING_EXECUTION'].includes(code),
      );
    } catch {
      console.error(JSON.stringify({ message: 'operation failure audit write failed', code }));
    }
    throw new OperationExecutionError(code);
  }

  const [target, proposal, logs] = await Promise.all([
    db.prepare(`
      SELECT workspace_id, project_id, action_display_text
      FROM project_areas
      WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1
    `).bind(plan.target.entityId, plan.workspaceId, plan.projectId).first<Record<string, unknown>>(),
    db.prepare(`
      SELECT status, executed_at FROM ai_proposals
      WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1
    `).bind(plan.proposalId, plan.workspaceId, plan.projectId).first<Record<string, unknown>>(),
    listOperationLogs(db, plan.workspaceId, plan.projectId, plan.proposalId),
  ]);
  const log = logs.find(item => item.id === logId);
  if (
    !target
    || clean(target.workspace_id) !== plan.workspaceId
    || clean(target.project_id) !== plan.projectId
    || clean(target.action_display_text) !== plan.mutation.after
    || clean(proposal?.status) !== 'executed'
    || !clean(proposal?.executed_at)
    || log?.status !== 'succeeded'
  ) throw new OperationExecutionError('VERIFICATION_FAILED');
  return log;
}

export const OPERATION_EXECUTORS: Record<
  OperationType,
  (db: D1Database, plan: OperationPlan, sourceFingerprint: string) => Promise<OperationLog>
> = {
  SET_PROJECT_AREA_DISPLAY_TEXT: executeSetProjectAreaDisplayText,
};

export async function executeOperationPlan(
  db: D1Database,
  plan: OperationPlan,
  sourceFingerprint: string,
): Promise<OperationLog> {
  return OPERATION_EXECUTORS[plan.operationType](db, plan, sourceFingerprint);
}
