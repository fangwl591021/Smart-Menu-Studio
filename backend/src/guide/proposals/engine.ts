import type { GuideArea, GuideContext } from '../types.ts';
import type { Recommendation } from '../recommendations/types.ts';
import { proposalAvailabilityForRule } from './availability.ts';
import type { Proposal, ProposalChange, ProposalType, ProposalWarning, SafeProposalValue } from './types.ts';

type BuildProposalInput = {
  context: GuideContext;
  recommendation: Recommendation;
};

const clean = (value: unknown) => String(value ?? '').trim();

function proposalId(recommendationId: string, type: ProposalType): string {
  return `prop:${recommendationId}:${type}`;
}

function baseProposal(
  context: GuideContext,
  recommendation: Recommendation,
  type: ProposalType,
  title: string,
  summary: string,
  changes: ProposalChange[],
  warnings: ProposalWarning[] = [],
): Proposal {
  return {
    id: proposalId(recommendation.id, type),
    recommendationId: recommendation.id,
    ruleCode: recommendation.ruleCode,
    workspaceId: context.workspaceId,
    projectId: context.project.id,
    status: 'preview',
    title,
    summary,
    changes,
    warnings,
    generatedBy: 'rule',
    canApply: false,
  };
}

function recommendationArea(context: GuideContext, recommendation: Recommendation): GuideArea | null {
  if (recommendation.entityType !== 'project_area' || !recommendation.entityId) return null;
  return context.areas.find(area => area.id === recommendation.entityId) || null;
}

function safeDisplayText(label: string): string {
  const value = clean(label).replace(/[\u0000-\u001f\u007f]/g, '');
  return value && value.length <= 20 ? value : '查看內容';
}

function safeUri(value: string, protocol?: 'http:' | 'https:'): string | null {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.protocol = protocol || parsed.protocol;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function duplicateAreas(
  context: GuideContext,
  anchor: GuideArea,
  valueOf: (area: GuideArea) => string,
): GuideArea[] {
  const anchorValue = clean(valueOf(anchor));
  if (!anchorValue) return [];
  return context.areas.filter(area => clean(valueOf(area)) === anchorValue);
}

function labels(areas: GuideArea[]): string {
  return areas.map(area => `「${clean(area.label) || `區域 ${area.id}`}」`).join('、');
}

function buildP001(context: GuideContext, recommendation: Recommendation): Proposal | null {
  const area = recommendationArea(context, recommendation);
  if (!area || area.actionType !== 'postback' || !area.data || area.displayText) return null;
  const type = 'postback-display-text';
  const after = safeDisplayText(area.label);
  return baseProposal(
    context,
    recommendation,
    type,
    '為 Postback 加入顯示文字',
    '讓使用者點擊後能在聊天室看到清楚的操作文字。',
    [{
      id: `chg:${area.id}:action-display-text`,
      entityType: 'project_area',
      entityId: area.id,
      field: 'action_display_text',
      operation: 'set',
      before: '',
      after,
      reason: '使用既有區域標籤作為顯示文字，不改動 Postback Data。',
    }],
  );
}

function buildP002(context: GuideContext, recommendation: Recommendation): Proposal | null {
  const area = recommendationArea(context, recommendation);
  if (!area || area.actionType !== 'uri') return null;
  const before = safeUri(area.uri);
  if (!before || !before.startsWith('http://')) return null;
  const after = safeUri(area.uri, 'https:');
  if (!after) return null;
  return baseProposal(
    context,
    recommendation,
    'https-upgrade-candidate',
    '檢查 HTTPS 升級候選網址',
    '以下網址僅為 HTTPS 候選預覽，必須先人工確認服務確實支援。',
    [{
      id: `chg:${area.id}:action-uri-https-candidate`,
      entityType: 'project_area',
      entityId: area.id,
      field: 'action_uri',
      operation: 'replace',
      before,
      after,
      reason: '移除敏感 query 與 fragment 後，將協定改為 HTTPS 作為人工驗證候選。',
    }],
    [{
      code: 'HTTPS_SUPPORT_NOT_VERIFIED',
      message: '尚未驗證目標服務是否支援 HTTPS，不能直接套用。',
    }],
  );
}

function buildReviewProposal(
  context: GuideContext,
  recommendation: Recommendation,
  type: 'duplicate-message-review' | 'duplicate-postback-review',
): Proposal | null {
  const anchor = recommendationArea(context, recommendation);
  if (!anchor) return null;
  const duplicate = type === 'duplicate-message-review'
    ? duplicateAreas(context, anchor, area => area.actionType === 'message' ? area.text : '')
    : duplicateAreas(context, anchor, area => area.actionType === 'postback' ? area.data : '');
  if (duplicate.length < 2) return null;
  const subject = type === 'duplicate-message-review' ? '相同文字' : '相同 Postback Data';
  return baseProposal(
    context,
    recommendation,
    type,
    type === 'duplicate-message-review' ? '檢查重複的訊息入口' : '檢查重複的 Postback 入口',
    `${labels(duplicate)}目前使用${subject}，建議人工確認是否需要區分。`,
    [],
    [{
      code: 'MANUAL_REVIEW_REQUIRED',
      message: '此建議需要人工判斷，因此沒有自動修改內容。',
    }],
  );
}

function buildP005(context: GuideContext, recommendation: Recommendation): Proposal {
  const areaCount = context.areas.length;
  const candidateCount = Math.min(4, Math.max(2, areaCount - 4));
  return baseProposal(
    context,
    recommendation,
    'multi-page-structure-draft',
    '規劃多頁選單結構',
    `目前有 ${areaCount} 個區域，建議人工選擇 ${candidateCount} 個次要入口移至第二頁。`,
    [],
    [{
      code: 'STRUCTURE_REVIEW_REQUIRED',
      message: '系統不會猜測功能重要性，也不會建立頁面或修改切換頁 Action。',
    }],
  );
}

const ALLOWED_CHANGE_FIELDS = new Set(['action_display_text', 'action_uri']);

function sanitizeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function sanitizeValue(field: string, value: SafeProposalValue): SafeProposalValue | undefined {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (field === 'action_uri') return safeUri(value) || undefined;
  return sanitizeText(value);
}

export function sanitizeProposal(proposal: Proposal | null): Proposal | null {
  if (!proposal || proposal.status !== 'preview' || proposal.canApply !== false) return null;
  const changes: ProposalChange[] = [];
  for (const change of proposal.changes) {
    if (!['project', 'project_area'].includes(change.entityType)) return null;
    if (!ALLOWED_CHANGE_FIELDS.has(change.field)) return null;
    const before = sanitizeValue(change.field, change.before);
    const after = sanitizeValue(change.field, change.after);
    if (before === undefined || after === undefined) return null;
    changes.push({
      id: sanitizeText(change.id),
      entityType: change.entityType,
      entityId: sanitizeText(change.entityId),
      field: change.field,
      operation: change.operation,
      before,
      after,
      reason: sanitizeText(change.reason),
    });
  }

  return {
    id: sanitizeText(proposal.id),
    recommendationId: sanitizeText(proposal.recommendationId),
    ruleCode: sanitizeText(proposal.ruleCode),
    workspaceId: sanitizeText(proposal.workspaceId),
    projectId: sanitizeText(proposal.projectId),
    status: 'preview',
    title: sanitizeText(proposal.title),
    summary: sanitizeText(proposal.summary),
    changes,
    warnings: proposal.warnings.map(warning => ({
      code: sanitizeText(warning.code),
      message: sanitizeText(warning.message),
    })),
    generatedBy: 'rule',
    canApply: false,
  };
}
export function buildProposal(input: BuildProposalInput): Proposal | null {
  const { context, recommendation } = input;
  if (recommendation.id.includes(`:${context.project.id}:`) === false) return null;
  const availability = proposalAvailabilityForRule(recommendation.ruleCode);
  if (!availability.available || !availability.type) return null;

  if (availability.type === 'postback-display-text') return buildP001(context, recommendation);
  if (availability.type === 'https-upgrade-candidate') return buildP002(context, recommendation);
  if (availability.type === 'duplicate-message-review' || availability.type === 'duplicate-postback-review') {
    return buildReviewProposal(context, recommendation, availability.type);
  }
  return buildP005(context, recommendation);
}
