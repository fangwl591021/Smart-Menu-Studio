import type { GuideContext } from '../types.ts';
import { RECOMMENDATION_RULES } from './rules.ts';
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
  const rules = [...RECOMMENDATION_RULES].sort((left, right) => left.order - right.order);
  const orderByCode = new Map(rules.map(rule => [rule.code, rule.order]));
  const deduplicated = new Map<string, Recommendation>();

  for (const rule of rules) {
    for (const candidate of rule.evaluate(context)) {
      const { stableKey, ...fields } = candidate;
      const id = `rec:${rule.code}:${context.project.id}:${stableFingerprint(stableKey)}`;
      if (deduplicated.has(id)) continue;
      const proposal = proposalAvailabilityForRule(rule.code);
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

  const recommendations = [...deduplicated.values()].sort((left, right) =>
    PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || (orderByCode.get(left.ruleCode) || 0) - (orderByCode.get(right.ruleCode) || 0)
    || left.id.localeCompare(right.id));

  return {
    recommendations,
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
