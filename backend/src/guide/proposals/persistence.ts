import { sanitizeProposal } from './engine.ts';
import type { Proposal, ProposalType } from './types.ts';

export type ProposalStatus = 'draft' | 'reviewed' | 'approved' | 'rejected' | 'executed' | 'stale';
export type ProposalEventType =
  | 'CREATED'
  | 'REVIEWED'
  | 'APPROVED'
  | 'REJECTED'
  | 'STALE_DETECTED'
  | 'REGENERATED'
  | 'EXECUTION_STARTED'
  | 'EXECUTION_SUCCEEDED'
  | 'EXECUTION_FAILED'
  | 'ROLLBACK_STARTED'
  | 'ROLLBACK_SUCCEEDED'
  | 'ROLLBACK_FAILED'
  | 'ROLLBACK_BLOCKED';
export type WorkspaceRole = 'viewer' | 'editor' | 'admin' | 'owner';

export type ProposalPermissions = {
  canCreate: boolean;
  canReview: boolean;
  canApprove: boolean;
  canReject: boolean;
  canRegenerate: boolean;
  canExecute: boolean;
};

export type StoredProposal = {
  id: string;
  workspaceId: string;
  projectId: string;
  recommendationId: string;
  ruleCode: string;
  proposalType: ProposalType;
  sourceEntityId: string | null;
  status: ProposalStatus;
  title: string;
  summary: string;
  generatedBy: 'rule' | 'rule+ai';
  snapshot: Proposal;
  sourceFingerprint: string;
  createdByUserId: string;
  createdByName: string;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  rejectedByUserId: string | null;
  rejectedByName: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  executedAt: string | null;
};

export type ProposalEvent = {
  id: string;
  eventType: ProposalEventType;
  actorUserId: string | null;
  actorName: string | null;
  fromStatus: ProposalStatus | null;
  toStatus: ProposalStatus | null;
  metadata: Record<string, string>;
  createdAt: string;
};

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

const recordId = (prefix: string) =>
  `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function proposalPermissions(
  roleValue: string,
  status?: ProposalStatus,
  executable = false,
): ProposalPermissions {
  const role = (clean(roleValue).toLowerCase() || 'viewer') as WorkspaceRole;
  const level = ROLE_LEVEL[role] || 0;
  return {
    canCreate: level >= ROLE_LEVEL.editor,
    canReview: level >= ROLE_LEVEL.editor && status === 'draft',
    canApprove: level >= ROLE_LEVEL.admin && status === 'reviewed',
    canReject: level >= ROLE_LEVEL.admin && (status === 'draft' || status === 'reviewed'),
    canRegenerate: level >= ROLE_LEVEL.editor && status === 'stale',
    canExecute: level >= ROLE_LEVEL.admin && status === 'approved' && executable,
  };
}

export function canTransitionProposal(from: ProposalStatus, to: ProposalStatus): boolean {
  return (
    (from === 'draft' && (to === 'reviewed' || to === 'rejected' || to === 'stale'))
    || (from === 'reviewed' && (to === 'approved' || to === 'rejected' || to === 'stale'))
    || (from === 'approved' && to === 'stale')
  );
}

export async function fingerprintProposal(
  proposal: Proposal,
  proposalType: ProposalType,
  sourceFacts: Array<{ key: string; value: string | number | boolean }> = [],
): Promise<string> {
  const sanitized = sanitizeProposal(proposal);
  if (!sanitized) throw new Error('INVALID_PROPOSAL_SNAPSHOT');

  const source = {
    projectId: sanitized.projectId,
    recommendationId: sanitized.recommendationId,
    proposalType,
    relevantBeforeValues: sanitized.changes.map(change => ({
      entityType: change.entityType,
      entityId: change.entityId,
      field: change.field,
      before: change.before,
      after: change.after,
    })),
    sourceFacts: sourceFacts.map(fact => ({ key: clean(fact.key), value: fact.value })),
    reviewOnlyState: sanitized.changes.length === 0
      ? {
          summary: sanitized.summary,
          warnings: sanitized.warnings.map(warning => ({ code: warning.code, message: warning.message })),
        }
      : null,
  };

  return sha256(canonical(source));
}

export function parseProposalSnapshot(value: unknown): Proposal | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return sanitizeProposal(parsed as Proposal);
  } catch {
    return null;
  }
}

function metadata(value: unknown): Record<string, string> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, item]) => [clean(key), clean(item)])
        .filter(([key, item]) => key && item),
    );
  } catch {
    return {};
  }
}

function fromRow(row: any): StoredProposal | null {
  const snapshot = parseProposalSnapshot(row?.proposal_snapshot);
  if (
    !snapshot
    || snapshot.workspaceId !== clean(row.workspace_id)
    || snapshot.projectId !== clean(row.project_id)
    || snapshot.recommendationId !== clean(row.recommendation_id)
    || snapshot.ruleCode !== clean(row.rule_code)
  ) return null;
  return {
    id: clean(row.id),
    workspaceId: clean(row.workspace_id),
    projectId: clean(row.project_id),
    recommendationId: clean(row.recommendation_id),
    ruleCode: clean(row.rule_code),
    proposalType: clean(row.proposal_type) as ProposalType,
    sourceEntityId: clean(row.source_entity_id) || null,
    status: clean(row.status) as ProposalStatus,
    title: clean(row.title),
    summary: clean(row.summary),
    generatedBy: clean(row.generated_by) as 'rule' | 'rule+ai',
    snapshot,
    sourceFingerprint: clean(row.source_fingerprint),
    createdByUserId: clean(row.created_by_user_id),
    createdByName: clean(row.created_by_name) || '使用者',
    reviewedByUserId: clean(row.reviewed_by_user_id) || null,
    reviewedByName: clean(row.reviewed_by_name) || null,
    approvedByUserId: clean(row.approved_by_user_id) || null,
    approvedByName: clean(row.approved_by_name) || null,
    rejectedByUserId: clean(row.rejected_by_user_id) || null,
    rejectedByName: clean(row.rejected_by_name) || null,
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
    reviewedAt: clean(row.reviewed_at) || null,
    approvedAt: clean(row.approved_at) || null,
    rejectedAt: clean(row.rejected_at) || null,
    executedAt: clean(row.executed_at) || null,
  };
}

const PROPOSAL_SELECT = `
  SELECT
    p.*,
    creator.display_name AS created_by_name,
    reviewer.display_name AS reviewed_by_name,
    approver.display_name AS approved_by_name,
    rejector.display_name AS rejected_by_name
  FROM ai_proposals p
  LEFT JOIN users creator ON creator.id = p.created_by_user_id
  LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by_user_id
  LEFT JOIN users approver ON approver.id = p.approved_by_user_id
  LEFT JOIN users rejector ON rejector.id = p.rejected_by_user_id
`;

export async function getStoredProposal(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  proposalId: string,
): Promise<StoredProposal | null> {
  const row = await db.prepare(`${PROPOSAL_SELECT}
    WHERE p.id = ? AND p.workspace_id = ? AND p.project_id = ?
    LIMIT 1
  `).bind(proposalId, workspaceId, projectId).first();
  return fromRow(row);
}

export async function listStoredProposals(
  db: D1Database,
  workspaceId: string,
  projectId: string,
): Promise<StoredProposal[]> {
  const result = await db.prepare(`${PROPOSAL_SELECT}
    WHERE p.workspace_id = ? AND p.project_id = ?
    ORDER BY p.created_at DESC, p.id DESC
  `).bind(workspaceId, projectId).all();
  return (result.results || []).map(fromRow).filter(Boolean) as StoredProposal[];
}

export async function listProposalEvents(
  db: D1Database,
  workspaceId: string,
  proposalId: string,
): Promise<ProposalEvent[]> {
  const result = await db.prepare(`
    SELECT e.*, actor.display_name AS actor_name
    FROM ai_proposal_events e
    LEFT JOIN users actor ON actor.id = e.actor_user_id
    WHERE e.workspace_id = ? AND e.proposal_id = ?
    ORDER BY e.created_at ASC, e.id ASC
  `).bind(workspaceId, proposalId).all();
  return (result.results || []).map((row: any) => ({
    id: clean(row.id),
    eventType: clean(row.event_type) as ProposalEventType,
    actorUserId: clean(row.actor_user_id) || null,
    actorName: clean(row.actor_name) || null,
    fromStatus: (clean(row.from_status) || null) as ProposalStatus | null,
    toStatus: (clean(row.to_status) || null) as ProposalStatus | null,
    metadata: metadata(row.metadata_json),
    createdAt: clean(row.created_at),
  }));
}

export async function createProposalDraft(
  db: D1Database,
  input: {
    proposal: Proposal;
    proposalType: ProposalType;
    sourceEntityId?: string;
    actorUserId: string;
    sourceFacts?: Array<{ key: string; value: string | number | boolean }>;
    regeneratedFromId?: string;
  },
): Promise<string> {
  const snapshot = sanitizeProposal(input.proposal);
  if (!snapshot) throw new Error('INVALID_PROPOSAL_SNAPSHOT');
  const fingerprint = await fingerprintProposal(snapshot, input.proposalType, input.sourceFacts || []);
  const proposalId = recordId('aip');
  const createdEventId = recordId('aipe');
  const statements = [
    db.prepare(`
      INSERT INTO ai_proposals (
        id, workspace_id, project_id, recommendation_id, rule_code, proposal_type,
        source_entity_id, status, title, summary, generated_by, proposal_snapshot,
        source_fingerprint, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      proposalId,
      snapshot.workspaceId,
      snapshot.projectId,
      snapshot.recommendationId,
      snapshot.ruleCode,
      input.proposalType,
      clean(input.sourceEntityId) || null,
      snapshot.title,
      snapshot.summary,
      snapshot.generatedBy,
      JSON.stringify(snapshot),
      fingerprint,
      input.actorUserId,
    ),
    db.prepare(`
      INSERT INTO ai_proposal_events (
        id, workspace_id, proposal_id, event_type, actor_user_id,
        from_status, to_status, metadata_json, created_at
      ) VALUES (?, ?, ?, 'CREATED', ?, NULL, 'draft', NULL, CURRENT_TIMESTAMP)
    `).bind(createdEventId, snapshot.workspaceId, proposalId, input.actorUserId),
  ];

  if (input.regeneratedFromId) {
    statements.push(db.prepare(`
      INSERT INTO ai_proposal_events (
        id, workspace_id, proposal_id, event_type, actor_user_id,
        from_status, to_status, metadata_json, created_at
      ) VALUES (?, ?, ?, 'REGENERATED', ?, 'stale', 'stale', ?, CURRENT_TIMESTAMP)
    `).bind(
      recordId('aipe'),
      snapshot.workspaceId,
      input.regeneratedFromId,
      input.actorUserId,
      JSON.stringify({ newProposalId: proposalId }),
    ));
  }

  await db.batch(statements);
  return proposalId;
}

export async function transitionStoredProposal(
  db: D1Database,
  input: {
    proposal: StoredProposal;
    toStatus: 'reviewed' | 'approved' | 'rejected' | 'stale';
    eventType: ProposalEventType;
    actorUserId?: string;
    eventMetadata?: Record<string, string>;
  },
): Promise<void> {
  if (!canTransitionProposal(input.proposal.status, input.toStatus)) {
    throw new Error('INVALID_PROPOSAL_TRANSITION');
  }

  const actor = clean(input.actorUserId) || null;
  const transitionAt = new Date().toISOString();
  const actorColumn = input.toStatus === 'reviewed'
    ? 'reviewed_by_user_id'
    : input.toStatus === 'approved'
      ? 'approved_by_user_id'
      : input.toStatus === 'rejected'
        ? 'rejected_by_user_id'
        : null;
  const timeColumn = input.toStatus === 'reviewed'
    ? 'reviewed_at'
    : input.toStatus === 'approved'
      ? 'approved_at'
      : input.toStatus === 'rejected'
        ? 'rejected_at'
        : null;
  const auditAssignments = actorColumn && timeColumn
    ? `, ${actorColumn} = ?, ${timeColumn} = ?`
    : '';
  const updateBindings = actorColumn
    ? [input.toStatus, transitionAt, actor, transitionAt, input.proposal.id, input.proposal.workspaceId, input.proposal.projectId, input.proposal.status]
    : [input.toStatus, transitionAt, input.proposal.id, input.proposal.workspaceId, input.proposal.projectId, input.proposal.status];

  const results = await db.batch([
    db.prepare(`
      UPDATE ai_proposals
      SET status = ?, updated_at = ?${auditAssignments}
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = ?
    `).bind(...updateBindings),
    db.prepare(`
      INSERT INTO ai_proposal_events (
        id, workspace_id, proposal_id, event_type, actor_user_id,
        from_status, to_status, metadata_json, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM ai_proposals
        WHERE id = ? AND workspace_id = ? AND project_id = ?
          AND status = ? AND updated_at = ?
      )
    `).bind(
      recordId('aipe'),
      input.proposal.workspaceId,
      input.proposal.id,
      input.eventType,
      actor,
      input.proposal.status,
      input.toStatus,
      input.eventMetadata ? JSON.stringify(input.eventMetadata) : null,
      transitionAt,
      input.proposal.id,
      input.proposal.workspaceId,
      input.proposal.projectId,
      input.toStatus,
      transitionAt,
    ),
  ]);

  if (Number(results[0]?.meta?.changes || 0) !== 1) throw new Error('PROPOSAL_CONFLICT');
}
