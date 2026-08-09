import type { GuideContext } from '../types.ts';
import type { ProposalAvailability } from '../proposals/types.ts';

export type RecommendationCategory =
  | 'engagement'
  | 'navigation'
  | 'conversion'
  | 'maintainability'
  | 'line-oa'
  | 'structure'
  | 'journey';

export type RecommendationSource = 'configuration' | 'behavior' | 'journey';
export type RecommendationTone = 'improvement' | 'positive';

export type RecommendationPriority = 'high' | 'medium' | 'low';

export type RecommendationEntityType = 'project' | 'project_area' | 'line_account';

export type RecommendationActionType = 'focus' | 'navigate' | 'open_tab' | 'review' | 'none';

export type RecommendationEvidence = {
  key: string;
  value: string | number | boolean | null;
};

export type Recommendation = {
  id: string;
  ruleCode: string;
  category: RecommendationCategory;
  priority: RecommendationPriority;
  title: string;
  message: string;
  reason: string;
  entityType?: RecommendationEntityType;
  entityId?: string;
  target?: string;
  suggestedAction?: {
    type: RecommendationActionType;
    target?: string;
  };
  evidence: RecommendationEvidence[];
  canGenerateProposal: boolean;
  proposal: ProposalAvailability;
  explanationSource: 'rule';
  source?: RecommendationSource;
  tone?: RecommendationTone;
  relatedRuleCodes?: string[];
  groupKey?: string;
  primaryRuleCode?: string;
};

export type RecommendationResult = {
  recommendations: Recommendation[];
  behaviorDataQuality?: { sufficient: boolean; reasonCode: string; mappedAreaRatio?: number; metricsThrough?: string; lastSyncAt?: string };
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  error?: string;
};

export type RecommendationCandidate = Omit<
  Recommendation,
  'id' | 'ruleCode' | 'canGenerateProposal' | 'proposal' | 'explanationSource'
> & {
  stableKey: string;
};

export type RecommendationRule = {
  code: string;
  order: number;
  evaluate: (context: GuideContext) => RecommendationCandidate[];
};
