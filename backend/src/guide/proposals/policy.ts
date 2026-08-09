import type { ProposalType } from './types.ts';
import type { ProposalStatus, StoredProposal, WorkspaceRole } from './persistence.ts';

export const OPERATION_POLICY_VERSION = '1' as const;

export type OperationRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'REVIEW_ONLY';
export type PolicyAction = 'view' | 'review' | 'approve' | 'execute' | 'rollback';
export type ConfirmationLevel = 'standard' | 'elevated' | 'critical';
export type ExternalSideEffect = 'none' | 'network_probe' | 'line_api' | 'other';
export type PolicyReasonCode =
  | 'POLICY_ALLOWED'
  | 'ROLE_NOT_ALLOWED'
  | 'REVIEW_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'EXECUTION_DISABLED'
  | 'REVIEW_ONLY_OPERATION'
  | 'HIGH_RISK_EXECUTION_DISABLED'
  | 'CONFIRMATION_REQUIRED'
  | 'PROBE_REQUIRED'
  | 'PROBE_EXPIRED'
  | 'ROLLBACK_NOT_SUPPORTED'
  | 'CURRENT_STATE_REVALIDATION_REQUIRED'
  | 'FINGERPRINT_REQUIRED';

export class OperationPolicyError extends Error {
  readonly code: PolicyReasonCode;
  constructor(code: PolicyReasonCode) {
    super(code);
    this.code = code;
    this.name = 'OperationPolicyError';
  }
}

export const assertPolicyAllowed = (evaluation: OperationPolicyEvaluation): void => {
  if (!evaluation.allowed) throw new OperationPolicyError(evaluation.reasonCode);
};

const POLICY_REASON_MESSAGES: Record<PolicyReasonCode, string> = {
  POLICY_ALLOWED: '政策允許此操作。',
  ROLE_NOT_ALLOWED: '目前角色不允許執行此操作。',
  REVIEW_REQUIRED: '此方案必須先完成檢視。',
  APPROVAL_REQUIRED: '此方案必須先完成核准。',
  EXECUTION_DISABLED: '此方案目前未開放自動執行。',
  REVIEW_ONLY_OPERATION: '此方案僅供檢視，不提供自動修改。',
  HIGH_RISK_EXECUTION_DISABLED: '此高風險結構方案目前僅提供規劃預覽。',
  CONFIRMATION_REQUIRED: '請先明確確認此操作。',
  PROBE_REQUIRED: '此方案需要新鮮的 HTTPS SAFE Probe。',
  PROBE_EXPIRED: 'HTTPS SAFE Probe 已過期，請重新檢查。',
  ROLLBACK_NOT_SUPPORTED: '此方案不支援自動回復。',
  CURRENT_STATE_REVALIDATION_REQUIRED: '目前狀態需要重新驗證。',
  FINGERPRINT_REQUIRED: '方案來源 fingerprint 需要重新驗證。',
};

export function policyReasonMessage(code: PolicyReasonCode): string {
  return POLICY_REASON_MESSAGES[code] || POLICY_REASON_MESSAGES.EXECUTION_DISABLED;
}

export type OperationPolicy = {
  policyVersion: typeof OPERATION_POLICY_VERSION;
  proposalType: ProposalType;
  riskLevel: OperationRiskLevel;
  reviewRequired: boolean;
  approvalRequired: boolean;
  allowedReviewRoles: WorkspaceRole[];
  allowedApprovalRoles: WorkspaceRole[];
  allowedExecutionRoles: WorkspaceRole[];
  allowedRollbackRoles: WorkspaceRole[];
  executionEnabled: boolean;
  rollbackSupported: boolean;
  confirmation: { required: boolean; level: ConfirmationLevel };
  probe?: { required: boolean; type?: 'HTTPS_SAFE_PROBE'; maxAgeSeconds?: number };
  revalidation: { fingerprintRequired: boolean; currentStateRequired: boolean };
  externalSideEffect: ExternalSideEffect;
  ai: { explanationAllowed: boolean; mutationAllowed: false; executionAllowed: false };
};

const EDITORS: WorkspaceRole[] = ['editor', 'admin', 'owner'];
const ADMINS: WorkspaceRole[] = ['admin', 'owner'];
const NO_ROLES: WorkspaceRole[] = [];
const AI_POLICY = { explanationAllowed: true, mutationAllowed: false, executionAllowed: false } as const;
const REVALIDATION = { fingerprintRequired: true, currentStateRequired: true } as const;

export const OPERATION_POLICIES: Readonly<Record<ProposalType, OperationPolicy>> = Object.freeze({
  'postback-display-text': Object.freeze({
    policyVersion: OPERATION_POLICY_VERSION,
    proposalType: 'postback-display-text',
    riskLevel: 'LOW',
    reviewRequired: true,
    approvalRequired: true,
    allowedReviewRoles: EDITORS,
    allowedApprovalRoles: ADMINS,
    allowedExecutionRoles: ADMINS,
    allowedRollbackRoles: ADMINS,
    executionEnabled: true,
    rollbackSupported: true,
    confirmation: { required: true, level: 'standard' as const },
    revalidation: REVALIDATION,
    externalSideEffect: 'none',
    ai: AI_POLICY,
  }),
  'https-upgrade-candidate': Object.freeze({
    policyVersion: OPERATION_POLICY_VERSION,
    proposalType: 'https-upgrade-candidate',
    riskLevel: 'MEDIUM',
    reviewRequired: true,
    approvalRequired: true,
    allowedReviewRoles: EDITORS,
    allowedApprovalRoles: ADMINS,
    allowedExecutionRoles: ADMINS,
    allowedRollbackRoles: ADMINS,
    executionEnabled: true,
    rollbackSupported: true,
    confirmation: { required: true, level: 'elevated' as const },
    probe: { required: true, type: 'HTTPS_SAFE_PROBE' as const, maxAgeSeconds: 30 * 60 },
    revalidation: REVALIDATION,
    externalSideEffect: 'network_probe',
    ai: AI_POLICY,
  }),
  'duplicate-message-review': Object.freeze({
    policyVersion: OPERATION_POLICY_VERSION,
    proposalType: 'duplicate-message-review',
    riskLevel: 'REVIEW_ONLY',
    reviewRequired: false,
    approvalRequired: false,
    allowedReviewRoles: EDITORS,
    allowedApprovalRoles: ADMINS,
    allowedExecutionRoles: NO_ROLES,
    allowedRollbackRoles: NO_ROLES,
    executionEnabled: false,
    rollbackSupported: false,
    confirmation: { required: false, level: 'standard' as const },
    revalidation: REVALIDATION,
    externalSideEffect: 'none',
    ai: AI_POLICY,
  }),
  'duplicate-postback-review': Object.freeze({
    policyVersion: OPERATION_POLICY_VERSION,
    proposalType: 'duplicate-postback-review',
    riskLevel: 'REVIEW_ONLY',
    reviewRequired: false,
    approvalRequired: false,
    allowedReviewRoles: EDITORS,
    allowedApprovalRoles: ADMINS,
    allowedExecutionRoles: NO_ROLES,
    allowedRollbackRoles: NO_ROLES,
    executionEnabled: false,
    rollbackSupported: false,
    confirmation: { required: false, level: 'standard' as const },
    revalidation: REVALIDATION,
    externalSideEffect: 'none',
    ai: AI_POLICY,
  }),
  'multi-page-structure-draft': Object.freeze({
    policyVersion: OPERATION_POLICY_VERSION,
    proposalType: 'multi-page-structure-draft',
    riskLevel: 'HIGH',
    reviewRequired: true,
    approvalRequired: false,
    allowedReviewRoles: EDITORS,
    allowedApprovalRoles: ADMINS,
    allowedExecutionRoles: NO_ROLES,
    allowedRollbackRoles: NO_ROLES,
    executionEnabled: false,
    rollbackSupported: false,
    confirmation: { required: true, level: 'critical' as const },
    revalidation: REVALIDATION,
    externalSideEffect: 'other',
    ai: AI_POLICY,
  }),
});

export type PolicyEvaluationContext = {
  confirmationProvided?: boolean;
  probeEligibility?: 'SAFE' | 'UNSAFE' | 'UNKNOWN' | 'EXPIRED' | 'NEEDS_PROBE';
  fingerprintValid?: boolean;
  currentStateValid?: boolean;
  rollbackAvailable?: boolean;
};

export type OperationPolicyEvaluation = {
  allowed: boolean;
  policyVersion: string;
  riskLevel: OperationRiskLevel;
  reasonCode: PolicyReasonCode;
  requirements: {
    reviewRequired: boolean;
    approvalRequired: boolean;
    confirmationRequired: boolean;
    confirmationLevel: ConfirmationLevel;
    probeRequired: boolean;
    freshProbeRequired: boolean;
    fingerprintRequired: boolean;
    currentStateRequired: boolean;
    rollbackSupported: boolean;
  };
  capabilities: { canReview: boolean; canApprove: boolean; canExecute: boolean; canRollback: boolean };
};

const role = (value: string): WorkspaceRole => {
  const normalized = String(value || '').toLowerCase();
  return (['viewer', 'editor', 'admin', 'owner'].includes(normalized) ? normalized : 'viewer') as WorkspaceRole;
};

function actionDecision(
  policy: OperationPolicy,
  proposalStatus: ProposalStatus,
  actorRole: WorkspaceRole,
  action: PolicyAction,
  context: PolicyEvaluationContext,
): PolicyReasonCode {
  if (action === 'view') return 'POLICY_ALLOWED';
  if (action === 'review') {
    if (!policy.allowedReviewRoles.includes(actorRole)) return 'ROLE_NOT_ALLOWED';
    return proposalStatus === 'draft' ? 'POLICY_ALLOWED' : 'REVIEW_REQUIRED';
  }
  if (action === 'approve') {
    if (!policy.allowedApprovalRoles.includes(actorRole)) return 'ROLE_NOT_ALLOWED';
    if (proposalStatus !== 'reviewed') return policy.reviewRequired ? 'REVIEW_REQUIRED' : 'APPROVAL_REQUIRED';
    return 'POLICY_ALLOWED';
  }
  if (action === 'execute') {
    if (!policy.executionEnabled) {
      if (policy.riskLevel === 'REVIEW_ONLY') return 'REVIEW_ONLY_OPERATION';
      if (policy.riskLevel === 'HIGH') return 'HIGH_RISK_EXECUTION_DISABLED';
      return 'EXECUTION_DISABLED';
    }
    if (!policy.allowedExecutionRoles.includes(actorRole)) return 'ROLE_NOT_ALLOWED';
    if (policy.reviewRequired && !['reviewed', 'approved', 'executed'].includes(proposalStatus)) return 'REVIEW_REQUIRED';
    if (policy.approvalRequired && proposalStatus !== 'approved') return 'APPROVAL_REQUIRED';
    if (policy.confirmation.required && context.confirmationProvided !== true) return 'CONFIRMATION_REQUIRED';
    if (policy.probe?.required) {
      if (context.probeEligibility === 'EXPIRED') return 'PROBE_EXPIRED';
      if (context.probeEligibility !== 'SAFE') return 'PROBE_REQUIRED';
    }
    if (policy.revalidation.fingerprintRequired && context.fingerprintValid === false) return 'FINGERPRINT_REQUIRED';
    if (policy.revalidation.currentStateRequired && context.currentStateValid === false) return 'CURRENT_STATE_REVALIDATION_REQUIRED';
    return 'POLICY_ALLOWED';
  }
  if (!policy.rollbackSupported) return 'ROLLBACK_NOT_SUPPORTED';
  if (!policy.allowedRollbackRoles.includes(actorRole)) return 'ROLE_NOT_ALLOWED';
  if (proposalStatus !== 'executed' || context.rollbackAvailable === false) return 'ROLLBACK_NOT_SUPPORTED';
  if (policy.confirmation.required && context.confirmationProvided !== true) return 'CONFIRMATION_REQUIRED';
  if (policy.revalidation.fingerprintRequired && context.fingerprintValid === false) return 'FINGERPRINT_REQUIRED';
  if (policy.revalidation.currentStateRequired && context.currentStateValid === false) return 'CURRENT_STATE_REVALIDATION_REQUIRED';
  return 'POLICY_ALLOWED';
}

export function policyForProposalType(proposalType: ProposalType): OperationPolicy {
  return OPERATION_POLICIES[proposalType];
}

export function evaluateOperationPolicy(input: {
  proposal: Pick<StoredProposal, 'proposalType' | 'status'>;
  actorRole: string;
  action: PolicyAction;
  context?: PolicyEvaluationContext;
}): OperationPolicyEvaluation {
  const policy = policyForProposalType(input.proposal.proposalType);
  const actorRole = role(input.actorRole);
  const context = input.context || {};
  const decide = (action: PolicyAction, capabilityContext: PolicyEvaluationContext = context) =>
    actionDecision(policy, input.proposal.status, actorRole, action, capabilityContext) === 'POLICY_ALLOWED';
  const reasonCode = actionDecision(policy, input.proposal.status, actorRole, input.action, context);
  return {
    allowed: reasonCode === 'POLICY_ALLOWED',
    policyVersion: policy.policyVersion,
    riskLevel: policy.riskLevel,
    reasonCode,
    requirements: {
      reviewRequired: policy.reviewRequired,
      approvalRequired: policy.approvalRequired,
      confirmationRequired: policy.confirmation.required,
      confirmationLevel: policy.confirmation.level,
      probeRequired: Boolean(policy.probe?.required),
      freshProbeRequired: Boolean(policy.probe?.required),
      fingerprintRequired: policy.revalidation.fingerprintRequired,
      currentStateRequired: policy.revalidation.currentStateRequired,
      rollbackSupported: policy.rollbackSupported,
    },
    capabilities: {
      canReview: decide('review'),
      canApprove: decide('approve'),
      canExecute: decide('execute', { ...context, confirmationProvided: true }),
      canRollback: decide('rollback', { ...context, confirmationProvided: true }),
    },
  };
}

export type ExecutionPreflightCheck = { code: string; passed: boolean };
export type ExecutionPreflight = {
  allowed: boolean;
  policyVersion: string;
  riskLevel: OperationRiskLevel;
  confirmationLevel: ConfirmationLevel;
  checks: ExecutionPreflightCheck[];
};

export function buildExecutionPreflight(input: {
  proposal: Pick<StoredProposal, 'proposalType' | 'status'>;
  actorRole: string;
  confirmationProvided: boolean;
  fingerprintMatches: boolean;
  currentStateValid: boolean;
  probeEligibility?: PolicyEvaluationContext['probeEligibility'];
}): ExecutionPreflight {
  const policy = policyForProposalType(input.proposal.proposalType);
  const evaluation = evaluateOperationPolicy({
    proposal: input.proposal,
    actorRole: input.actorRole,
    action: 'execute',
    context: {
      confirmationProvided: input.confirmationProvided,
      probeEligibility: input.probeEligibility,
      fingerprintValid: input.fingerprintMatches,
      currentStateValid: input.currentStateValid,
    },
  });
  const checks: ExecutionPreflightCheck[] = [
    { code: 'POLICY_EXECUTION_ALLOWED', passed: policy.executionEnabled && policy.allowedExecutionRoles.includes(role(input.actorRole)) },
    { code: 'PROPOSAL_REVIEWED', passed: !policy.reviewRequired || ['reviewed', 'approved', 'executed'].includes(input.proposal.status) },
    { code: 'PROPOSAL_APPROVED', passed: !policy.approvalRequired || input.proposal.status === 'approved' },
    { code: 'CONFIRMATION_PRESENT', passed: !policy.confirmation.required || input.confirmationProvided },
    { code: 'FINGERPRINT_MATCH', passed: !policy.revalidation.fingerprintRequired || input.fingerprintMatches },
    { code: 'CURRENT_STATE_VALID', passed: !policy.revalidation.currentStateRequired || input.currentStateValid },
  ];
  if (policy.probe?.required) checks.push({ code: 'PROBE_FRESH', passed: input.probeEligibility === 'SAFE' });
  return {
    allowed: evaluation.allowed && checks.every(check => check.passed),
    policyVersion: policy.policyVersion,
    riskLevel: policy.riskLevel,
    confirmationLevel: policy.confirmation.level,
    checks,
  };
}

export function publicPolicySummary(input: {
  proposal: Pick<StoredProposal, 'proposalType' | 'status'>;
  actorRole: string;
  probeEligibility?: PolicyEvaluationContext['probeEligibility'];
  rollbackAvailable?: boolean;
}) {
  const evaluation = evaluateOperationPolicy({
    proposal: input.proposal,
    actorRole: input.actorRole,
    action: 'view',
    context: {
      probeEligibility: input.probeEligibility,
      rollbackAvailable: input.rollbackAvailable,
    },
  });
  const policy = policyForProposalType(input.proposal.proposalType);
  const checks = [
    { code: 'POLICY_EXECUTION_ALLOWED', passed: policy.executionEnabled },
    { code: 'PROPOSAL_REVIEWED', passed: !policy.reviewRequired || ['reviewed', 'approved', 'executed'].includes(input.proposal.status) },
    { code: 'PROPOSAL_APPROVED', passed: !policy.approvalRequired || ['approved', 'executed'].includes(input.proposal.status) },
    { code: 'FINGERPRINT_MATCH', passed: input.proposal.status !== 'stale' },
    { code: 'CURRENT_STATE_VALID', passed: input.proposal.status !== 'stale' },
    { code: 'ROLLBACK_SUPPORTED', passed: policy.rollbackSupported },
  ];
  if (policy.probe?.required) checks.push({ code: 'PROBE_FRESH', passed: input.probeEligibility === 'SAFE' });
  return {
    policyVersion: evaluation.policyVersion,
    riskLevel: evaluation.riskLevel,
    capabilities: evaluation.capabilities,
    requirements: evaluation.requirements,
    preflight: {
      allowed: evaluation.capabilities.canExecute,
      checks,
    },
  };
}

export function policyAuditMetadata(preflight: ExecutionPreflight) {
  return {
    policyVersion: preflight.policyVersion,
    riskLevel: preflight.riskLevel,
    confirmationLevel: preflight.confirmationLevel,
    preflightResult: preflight.allowed ? 'PASS' : 'BLOCKED',
    preflightChecks: preflight.checks.map(check => `${check.code}:${check.passed ? 'PASS' : 'FAIL'}`).join(','),
  };
}

export function rollbackPolicyAudit(proposalType: ProposalType) {
  const policy = policyForProposalType(proposalType);
  return {
    policyVersion: policy.policyVersion,
    riskLevel: policy.riskLevel,
    confirmationLevel: policy.confirmation.level,
    preflightResult: 'PASS',
    preflightChecks: 'POLICY_ROLLBACK_ALLOWED:PASS,CURRENT_STATE_VALID:PASS,FINGERPRINT_MATCH:PASS',
  };
}

export type PolicyAuditMetadata = ReturnType<typeof policyAuditMetadata>;

export type CompositePlanPolicyAction = 'view' | 'create' | 'review' | 'approve' | 'cancel' | 'execute';
export type CompositePlanPolicyReason =
  | 'PLAN_POLICY_ALLOWED'
  | 'PLAN_ROLE_NOT_ALLOWED'
  | 'PLAN_REVIEW_REQUIRED'
  | 'PLAN_PREFLIGHT_BLOCKED'
  | 'PLAN_HIGH_RISK_APPROVAL_DISABLED'
  | 'PLAN_STATUS_NOT_ALLOWED';

export type CompositePlanPolicyEvaluation = {
  allowed: boolean;
  reasonCode: CompositePlanPolicyReason;
  policyVersion: string;
  capabilities: {
    canCreate: boolean;
    canReview: boolean;
    canApprove: boolean;
    canCancel: boolean;
    canExecute: boolean;
  };
};

type CompositePolicyStatus =
  | 'draft' | 'reviewed' | 'approved' | 'executing' | 'executed'
  | 'failed' | 'rolled_back' | 'partially_compensated' | 'stale' | 'cancelled';

function compositePlanDecision(input: {
  actorRole: WorkspaceRole;
  action: CompositePlanPolicyAction;
  status?: CompositePolicyStatus;
  actorUserId?: string;
  createdByUserId?: string;
  preflightAllowed?: boolean;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}): CompositePlanPolicyReason {
  const { actorRole, action, status } = input;
  if (action === 'view') return 'PLAN_POLICY_ALLOWED';
  if (action === 'create') {
    return EDITORS.includes(actorRole) ? 'PLAN_POLICY_ALLOWED' : 'PLAN_ROLE_NOT_ALLOWED';
  }
  if (action === 'review') {
    if (!EDITORS.includes(actorRole)) return 'PLAN_ROLE_NOT_ALLOWED';
    return status === 'draft' ? 'PLAN_POLICY_ALLOWED' : 'PLAN_STATUS_NOT_ALLOWED';
  }
  if (action === 'approve') {
    if (!ADMINS.includes(actorRole)) return 'PLAN_ROLE_NOT_ALLOWED';
    if (status !== 'reviewed') return status === 'draft' ? 'PLAN_REVIEW_REQUIRED' : 'PLAN_STATUS_NOT_ALLOWED';
    if (input.riskLevel === 'HIGH') return 'PLAN_HIGH_RISK_APPROVAL_DISABLED';
    if (input.preflightAllowed !== true) return 'PLAN_PREFLIGHT_BLOCKED';
    return 'PLAN_POLICY_ALLOWED';
  }
  if (action === 'execute') {
    if (!ADMINS.includes(actorRole)) return 'PLAN_ROLE_NOT_ALLOWED';
    if (status !== 'approved') return 'PLAN_STATUS_NOT_ALLOWED';
    if (input.riskLevel === 'HIGH') return 'PLAN_HIGH_RISK_APPROVAL_DISABLED';
    if (input.preflightAllowed !== true) return 'PLAN_PREFLIGHT_BLOCKED';
    return 'PLAN_POLICY_ALLOWED';
  }
  if (status === 'cancelled' || status === 'stale' || !status) return 'PLAN_STATUS_NOT_ALLOWED';
  if (ADMINS.includes(actorRole)) return 'PLAN_POLICY_ALLOWED';
  if (
    actorRole === 'editor'
    && status === 'draft'
    && cleanPolicyValue(input.actorUserId) === cleanPolicyValue(input.createdByUserId)
  ) return 'PLAN_POLICY_ALLOWED';
  return 'PLAN_ROLE_NOT_ALLOWED';
}

const cleanPolicyValue = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

export function evaluateCompositePlanPolicy(input: {
  actorRole: string;
  action: CompositePlanPolicyAction;
  status?: CompositePolicyStatus;
  actorUserId?: string;
  createdByUserId?: string;
  preflightAllowed?: boolean;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}): CompositePlanPolicyEvaluation {
  const actorRole = role(input.actorRole);
  const decide = (action: CompositePlanPolicyAction) => compositePlanDecision({
    ...input,
    actorRole,
    action,
  }) === 'PLAN_POLICY_ALLOWED';
  const reasonCode = compositePlanDecision({ ...input, actorRole });
  return {
    allowed: reasonCode === 'PLAN_POLICY_ALLOWED',
    reasonCode,
    policyVersion: OPERATION_POLICY_VERSION,
    capabilities: {
      canCreate: decide('create'),
      canReview: decide('review'),
      canApprove: decide('approve'),
      canCancel: decide('cancel'),
      canExecute: decide('execute'),
    },
  };
}

export function compositePlanPolicyMessage(reason: CompositePlanPolicyReason): string {
  const messages: Record<CompositePlanPolicyReason, string> = {
    PLAN_POLICY_ALLOWED: '政策允許此計畫操作。',
    PLAN_ROLE_NOT_ALLOWED: '目前角色不允許執行此計畫操作。',
    PLAN_REVIEW_REQUIRED: '執行計畫必須先完成檢視。',
    PLAN_PREFLIGHT_BLOCKED: '執行計畫的安全檢查尚未全部通過。',
    PLAN_HIGH_RISK_APPROVAL_DISABLED: '高風險執行計畫目前不可核准或執行。',
    PLAN_STATUS_NOT_ALLOWED: '此執行計畫目前不能執行該狀態操作。',
  };
  return messages[reason];
}
