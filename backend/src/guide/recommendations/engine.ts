import type { GuideContext } from '../types.ts';
import { RECOMMENDATION_RULES } from './rules.ts';
import { BEHAVIOR_RECOMMENDATION_RULES } from './behavioralRules.ts';
import { JOURNEY_RECOMMENDATION_RULES } from '../../journey/recommendations.ts';
import { OPTIMIZATION_RECOMMENDATION_RULES } from '../../optimization/recommendations.ts';
import { proposalAvailabilityForRule } from '../proposals/availability.ts';
import type {
  Recommendation,
  RecommendationPriority,
  RecommendationResult,
} from './types.ts';

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// Deterministic non-cryptographic fingerprint for stable IDs; never used as a security token.
function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function evaluateRecommendations(context: GuideContext): RecommendationResult {
  const rules = [...RECOMMENDATION_RULES, ...BEHAVIOR_RECOMMENDATION_RULES, ...JOURNEY_RECOMMENDATION_RULES, ...OPTIMIZATION_RECOMMENDATION_RULES].sort((left, right) => left.order - right.order);
  const orderByCode = new Map(rules.map(rule => [rule.code, rule.order]));
  const deduplicated = new Map<string, Recommendation>();

  for (const rule of rules) {
    for (const candidate of rule.evaluate(context)) {
      const { stableKey, ...fields } = candidate;
      const id = `rec:${rule.code}:${context.project.id}:${stableFingerprint(stableKey)}`;
      if (deduplicated.has(id)) continue;
      const proposal = (fields.source === 'behavior' || fields.source === 'journey' || fields.source === 'optimization') ? { available: false, type: null, reason: 'PROPOSAL_NOT_AVAILABLE' } as any : proposalAvailabilityForRule(rule.code);
      deduplicated.set(id, {
        id,
        ruleCode: rule.code,
        ...fields,
        canGenerateProposal: proposal.available,
        proposal,
        explanationSource: 'rule',
      });
    }
  }

  const raw = [...deduplicated.values()];
  const present = new Set(raw.map(item => item.ruleCode));
  const groupFor = (item: Recommendation): { groupKey?: string; primaryRuleCode?: string; relatedRuleCodes?: string[]; suppress?: boolean } => {
    if (item.ruleCode === 'R109' && present.has('R110')) return { suppress: true };
    if (['R101','R202','R303'].includes(item.ruleCode) && (present.has('R202') || present.has('R303'))) return { groupKey:'usage-vs-conversion-quality', primaryRuleCode:present.has('R303')?'R303':'R202', relatedRuleCodes:['R101','R202','R303'].filter(code=>present.has(code)) };
    if (['R201','R302'].includes(item.ruleCode) && present.has('R302')) return { groupKey:'tracked-conversion-quality', primaryRuleCode:'R302', relatedRuleCodes:['R201','R302'].filter(code=>present.has(code)) };
    if (['R301','R305'].includes(item.ruleCode) && (present.has('R301') || present.has('R305'))) return { groupKey:'optimization-observability', primaryRuleCode:present.has('R301')?'R301':'R305', relatedRuleCodes:['R301','R305'].filter(code=>present.has(code)), suppress:item.ruleCode==='R305' && present.has('R301') };
    if (item.ruleCode === 'R104' || item.ruleCode === 'R003') return { groupKey:'structure-optimization' };
    if (item.ruleCode === 'R107' || item.ruleCode === 'R001' || item.ruleCode === 'R002') return { groupKey:'external-uri-usage' };
    if (item.ruleCode === 'R110') return { groupKey:'click-trend', primaryRuleCode:'R110', relatedRuleCodes:present.has('R109')?['R109','R110']:undefined };
    return {};
  };
  const recommendations = raw.map(item => ({ item, group: groupFor(item) })).filter(({group})=>!group.suppress).map(({item,group})=>({ ...item, ...group })).sort((left, right) =>
    PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || (orderByCode.get(left.ruleCode) || 0) - (orderByCode.get(right.ruleCode) || 0)
    || left.id.localeCompare(right.id));
  return {
    recommendations,
    ...(context.behavior?.dataQuality ? { behaviorDataQuality: { sufficient: Boolean(context.behavior.dataQuality.sufficient), reasonCode: String(context.behavior.dataQuality.reasonCode || 'NO_SYNC'), mappedAreaRatio: Number(context.behavior.dataQuality.mappedAreaRatio || 0), metricsThrough: context.behavior.dataQuality.metricsThrough || undefined, lastSyncAt: context.behavior.dataQuality.lastSyncAt || undefined } } : {}),
    summary: {
      total: recommendations.length,
      high: recommendations.filter(item => item.priority === 'high').length,
      medium: recommendations.filter(item => item.priority === 'medium').length,
      low: recommendations.filter(item => item.priority === 'low').length,
    },
  };
}

export function emptyRecommendationResult(error?: string): RecommendationResult {
  return {
    recommendations: [],
    summary: { total: 0, high: 0, medium: 0, low: 0 },
    ...(error ? { error } : {}),
  };
}
