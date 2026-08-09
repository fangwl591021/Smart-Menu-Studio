import type { GuideContext } from '../types.ts';
import type { HttpsProbeEligibility } from './https-probe.ts';
import type { StoredProposal } from './persistence.ts';
import {
  OPERATION_POLICY_VERSION,
  policyForProposalType,
  type OperationRiskLevel,
} from './policy.ts';
import type { ProposalType, SafeProposalValue } from './types.ts';

export type CompositePlanStatus = 'draft' | 'reviewed' | 'approved' | 'stale' | 'cancelled';
export type CompositePlanRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type CompositeOperationType =
  | 'SET_PROJECT_AREA_DISPLAY_TEXT'
  | 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS';

export type CompositePlanReasonCode =
  | 'PLAN_CONTAINS_NON_EXECUTABLE_PROPOSAL'
  | 'DUPLICATE_PROPOSAL'
  | 'PLAN_CONFLICT'
  | 'TARGET_MISSING'
  | 'STALE_PROPOSAL'
  | 'EXPIRED_PROBE'
  | 'CROSS_WORKSPACE_TARGET'
  | 'PROPOSAL_ALREADY_EXECUTED'
  | 'INVALID_PLAN_SELECTION'
  | 'POLICY_VERSION_MISMATCH';

export class CompositePlanError extends Error {
  readonly code: CompositePlanReasonCode;
  readonly details: Record<string, unknown>;

  constructor(code: CompositePlanReasonCode, details: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.details = details;
    this.name = 'CompositePlanError';
  }
}

export type OperationPlanStepRequirements = {
  approvalRequired: boolean;
  freshProbeRequired: boolean;
  currentStateRequired: boolean;
  fingerprintRequired: boolean;
};

export type OperationPlanStepSnapshot = {
  title: string;
  field: string;
  before: SafeProposalValue;
  after: SafeProposalValue;
  proposalStatus: StoredProposal['status'];
  proposalFingerprint: string;
  fingerprintMatches: boolean;
  targetExists: boolean;
  targetInWorkspace: boolean;
  probeEligibility: HttpsProbeEligibility;
};

export type OperationPlanStep = {
  id: string;
  sequence: number;
  proposalId: string;
  proposalType: ProposalType;
  operationType: CompositeOperationType;
  riskLevel: CompositePlanRisk;
  targetEntityType: 'project_area';
  targetEntityId: string;
  dependencies: string[];
  executable: boolean;
  rollbackSupported: boolean;
  requirements: OperationPlanStepRequirements;
  snapshot: OperationPlanStepSnapshot;
};

export type OperationPlanPreflightCheck = {
  code:
    | 'PLAN_POLICY_VALID'
    | 'ALL_STEPS_EXECUTABLE'
    | 'ALL_PROPOSALS_APPROVED'
    | 'NO_CONFLICTS'
    | 'ALL_FINGERPRINTS_MATCH'
    | 'ALL_TARGETS_EXIST'
    | 'ALL_TARGETS_IN_WORKSPACE'
    | 'P002_PROBES_FRESH'
    | 'POLICY_VERSION_VALID';
  passed: boolean;
  stepId?: string;
  message?: string;
};

export type OperationPlanPreflight = {
  allowed: boolean;
  result: 'PASS' | 'BLOCKED';
  checks: OperationPlanPreflightCheck[];
};

export type CompositeOperationPlan = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  status: CompositePlanStatus;
  riskLevel: CompositePlanRisk;
  policyVersion: string;
  steps: OperationPlanStep[];
  preflight: OperationPlanPreflight;
  sourceFingerprint: string;
  createdByUserId: string;
  reviewedByUserId: string | null;
  approvedByUserId: string | null;
  cancelledByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
};

export type CompositePlanProposalInput = {
  proposal: StoredProposal;
  fingerprintMatches?: boolean;
  probeEligibility?: HttpsProbeEligibility;
};

type OperationMetadata = {
  operationType: CompositeOperationType;
  field: 'action_display_text' | 'action_uri';
  riskLevel: 'LOW' | 'MEDIUM';
  rank: number;
};

const OPERATION_METADATA: Partial<Record<ProposalType, OperationMetadata>> = Object.freeze({
  'postback-display-text': Object.freeze({
    operationType: 'SET_PROJECT_AREA_DISPLAY_TEXT',
    field: 'action_display_text',
    riskLevel: 'LOW',
    rank: 10,
  }),
  'https-upgrade-candidate': Object.freeze({
    operationType: 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS',
    field: 'action_uri',
    riskLevel: 'MEDIUM',
    rank: 20,
  }),
});

const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

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

function firstFailedStep(steps: OperationPlanStep[], predicate: (step: OperationPlanStep) => boolean): string | undefined {
  return steps.find(step => !predicate(step))?.id;
}

export function evaluatePlanPreflight(input: {
  steps: OperationPlanStep[];
  policyVersion: string;
  noConflicts?: boolean;
}): OperationPlanPreflight {
  const steps = input.steps;
  const policyValid = steps.every(step => {
    const policy = policyForProposalType(step.proposalType);
    return policy.policyVersion === input.policyVersion
      && policy.executionEnabled
      && policy.riskLevel === step.riskLevel;
  });
  const checks: OperationPlanPreflightCheck[] = [
    {
      code: 'PLAN_POLICY_VALID',
      passed: policyValid,
      stepId: firstFailedStep(steps, step => policyForProposalType(step.proposalType).executionEnabled),
    },
    {
      code: 'ALL_STEPS_EXECUTABLE',
      passed: steps.length > 0 && steps.every(step => step.executable),
      stepId: firstFailedStep(steps, step => step.executable),
    },
    {
      code: 'ALL_PROPOSALS_APPROVED',
      passed: steps.every(step => step.snapshot.proposalStatus === 'approved'),
      stepId: firstFailedStep(steps, step => step.snapshot.proposalStatus === 'approved'),
    },
    { code: 'NO_CONFLICTS', passed: input.noConflicts !== false },
    {
      code: 'ALL_FINGERPRINTS_MATCH',
      passed: steps.every(step => step.snapshot.fingerprintMatches),
      stepId: firstFailedStep(steps, step => step.snapshot.fingerprintMatches),
    },
    {
      code: 'ALL_TARGETS_EXIST',
      passed: steps.every(step => step.snapshot.targetExists),
      stepId: firstFailedStep(steps, step => step.snapshot.targetExists),
    },
    {
      code: 'ALL_TARGETS_IN_WORKSPACE',
      passed: steps.every(step => step.snapshot.targetInWorkspace),
      stepId: firstFailedStep(steps, step => step.snapshot.targetInWorkspace),
    },
    {
      code: 'P002_PROBES_FRESH',
      passed: steps.every(step => !step.requirements.freshProbeRequired || step.snapshot.probeEligibility === 'SAFE'),
      stepId: firstFailedStep(steps, step => !step.requirements.freshProbeRequired || step.snapshot.probeEligibility === 'SAFE'),
    },
    { code: 'POLICY_VERSION_VALID', passed: input.policyVersion === OPERATION_POLICY_VERSION },
  ];
  const allowed = checks.every(check => check.passed);
  return { allowed, result: allowed ? 'PASS' : 'BLOCKED', checks };
}

export async function fingerprintCompositePlan(input: {
  projectId: string;
  policyVersion: string;
  steps: OperationPlanStep[];
}): Promise<string> {
  return sha256(canonical({
    projectId: clean(input.projectId),
    policyVersion: clean(input.policyVersion),
    steps: input.steps.map(step => ({
      proposalId: step.proposalId,
      proposalFingerprint: step.snapshot.proposalFingerprint,
      operationType: step.operationType,
      targetEntityType: step.targetEntityType,
      targetEntityId: step.targetEntityId,
      field: step.snapshot.field,
      expectedBefore: step.snapshot.before,
    })),
  }));
}

export async function buildCompositeOperationPlan(input: {
  id: string;
  workspaceId: string;
  projectId: string;
  title?: string;
  proposals: CompositePlanProposalInput[];
  context: Pick<GuideContext, 'workspaceId' | 'project' | 'areas'>;
  actorUserId: string;
  now?: string;
}): Promise<CompositeOperationPlan> {
  if (input.proposals.length < 1 || input.proposals.length > 20) {
    throw new CompositePlanError('INVALID_PLAN_SELECTION');
  }
  const proposalIds = input.proposals.map(item => clean(item.proposal.id));
  const duplicateId = proposalIds.find((id, index) => proposalIds.indexOf(id) !== index);
  if (duplicateId) throw new CompositePlanError('DUPLICATE_PROPOSAL', { proposalId: duplicateId });
  if (
    clean(input.context.workspaceId) !== clean(input.workspaceId)
    || clean(input.context.project.id) !== clean(input.projectId)
  ) throw new CompositePlanError('CROSS_WORKSPACE_TARGET');

  const candidates = input.proposals.map(item => {
    const proposal = item.proposal;
    if (
      proposal.workspaceId !== input.workspaceId
      || proposal.projectId !== input.projectId
      || proposal.snapshot.workspaceId !== input.workspaceId
      || proposal.snapshot.projectId !== input.projectId
    ) throw new CompositePlanError('CROSS_WORKSPACE_TARGET', { proposalId: proposal.id });
    if (proposal.status === 'executed') {
      throw new CompositePlanError('PROPOSAL_ALREADY_EXECUTED', { proposalId: proposal.id });
    }
    if (proposal.status === 'stale' || item.fingerprintMatches === false) {
      throw new CompositePlanError('STALE_PROPOSAL', { proposalId: proposal.id });
    }
    const metadata = OPERATION_METADATA[proposal.proposalType];
    const policy = policyForProposalType(proposal.proposalType);
    if (!metadata || !policy.executionEnabled || !['LOW', 'MEDIUM'].includes(policy.riskLevel)) {
      throw new CompositePlanError('PLAN_CONTAINS_NON_EXECUTABLE_PROPOSAL', {
        proposalId: proposal.id,
        proposalType: proposal.proposalType,
      });
    }
    if (policy.policyVersion !== OPERATION_POLICY_VERSION) {
      throw new CompositePlanError('POLICY_VERSION_MISMATCH', { proposalId: proposal.id });
    }
    const changes = proposal.snapshot.changes;
    const change = changes.length === 1 ? changes[0] : null;
    if (
      !change
      || change.entityType !== 'project_area'
      || change.field !== metadata.field
      || !proposal.sourceEntityId
      || change.entityId !== proposal.sourceEntityId
    ) throw new CompositePlanError('STALE_PROPOSAL', { proposalId: proposal.id });
    const area = input.context.areas.find(candidate => candidate.id === proposal.sourceEntityId);
    if (!area?.recordId) throw new CompositePlanError('TARGET_MISSING', { proposalId: proposal.id });
    return { item, proposal, metadata, policy, change, area };
  });

  candidates.sort((left, right) =>
    clean(left.area.recordId).localeCompare(clean(right.area.recordId))
    || left.metadata.rank - right.metadata.rank
    || left.proposal.id.localeCompare(right.proposal.id)
  );

  const fieldOwners = new Map<string, string>();
  for (const candidate of candidates) {
    const key = `${candidate.area.recordId}:${candidate.metadata.field}`;
    const conflictingProposalId = fieldOwners.get(key);
    if (conflictingProposalId) {
      throw new CompositePlanError('PLAN_CONFLICT', {
        conflict: 'SAME_ENTITY_SAME_FIELD',
        proposalIds: [conflictingProposalId, candidate.proposal.id],
        targetEntityId: candidate.area.recordId,
        field: candidate.metadata.field,
      });
    }
    fieldOwners.set(key, candidate.proposal.id);
  }

  const lastStepByEntity = new Map<string, string>();
  const steps: OperationPlanStep[] = candidates.map((candidate, index) => {
    const id = `${clean(input.id)}_step_${index + 1}`;
    const previous = lastStepByEntity.get(clean(candidate.area.recordId));
    lastStepByEntity.set(clean(candidate.area.recordId), id);
    const riskLevel = candidate.policy.riskLevel as 'LOW' | 'MEDIUM';
    return {
      id,
      sequence: index + 1,
      proposalId: candidate.proposal.id,
      proposalType: candidate.proposal.proposalType,
      operationType: candidate.metadata.operationType,
      riskLevel,
      targetEntityType: 'project_area',
      targetEntityId: clean(candidate.area.recordId),
      dependencies: previous ? [previous] : [],
      executable: candidate.policy.executionEnabled,
      rollbackSupported: candidate.policy.rollbackSupported,
      requirements: {
        approvalRequired: candidate.policy.approvalRequired,
        freshProbeRequired: Boolean(candidate.policy.probe?.required),
        currentStateRequired: candidate.policy.revalidation.currentStateRequired,
        fingerprintRequired: candidate.policy.revalidation.fingerprintRequired,
      },
      snapshot: {
        title: clean(candidate.proposal.title),
        field: candidate.metadata.field,
        before: candidate.change.before,
        after: candidate.change.after,
        proposalStatus: candidate.proposal.status,
        proposalFingerprint: candidate.proposal.sourceFingerprint,
        fingerprintMatches: candidate.item.fingerprintMatches !== false,
        targetExists: true,
        targetInWorkspace: true,
        probeEligibility: candidate.item.probeEligibility || 'NEEDS_PROBE',
      },
    };
  });

  const riskLevel: CompositePlanRisk = steps.some(step => step.riskLevel === 'MEDIUM') ? 'MEDIUM' : 'LOW';
  const preflight = evaluatePlanPreflight({
    steps,
    policyVersion: OPERATION_POLICY_VERSION,
    noConflicts: true,
  });
  const now = input.now || new Date().toISOString();
  const sourceFingerprint = await fingerprintCompositePlan({
    projectId: input.projectId,
    policyVersion: OPERATION_POLICY_VERSION,
    steps,
  });
  return {
    id: clean(input.id),
    workspaceId: clean(input.workspaceId),
    projectId: clean(input.projectId),
    title: clean(input.title).slice(0, 120) || '改善 Rich Menu 基本設定',
    status: 'draft',
    riskLevel,
    policyVersion: OPERATION_POLICY_VERSION,
    steps,
    preflight,
    sourceFingerprint,
    createdByUserId: clean(input.actorUserId),
    reviewedByUserId: null,
    approvedByUserId: null,
    cancelledByUserId: null,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    approvedAt: null,
    cancelledAt: null,
  };
}

export function compositeRiskReason(risk: CompositePlanRisk): string {
  if (risk === 'MEDIUM') return '此計畫包含 HTTPS 網址修改。';
  if (risk === 'HIGH') return '此計畫包含結構性或正式環境副作用。';
  return '此計畫只包含可驗證、可回復的單欄位修改。';
}

export function operationRiskForPlan(risk: OperationRiskLevel): CompositePlanRisk {
  return risk === 'HIGH' ? 'HIGH' : risk === 'MEDIUM' ? 'MEDIUM' : 'LOW';
}
