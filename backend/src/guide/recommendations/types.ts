import type { GuideContext } from '../types.ts';

export type RecommendationCategory =
  | 'engagement'
  | 'navigation'
  | 'conversion'
  | 'maintainability'
  | 'line-oa'
  | 'structure';

export type RecommendationPriority = 'high' | 'medium' | 'low';

export type RecommendationEntityType = 'project' | 'project_area' | 'line_account';

export type RecommendationActionType = 'focus' | 'navigate' | 'open_tab' | 'review' | 'none';

export type RecommendationEvidence = {
  key: string;
  value: string | number | boolean;
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
  canGenerateProposal: false;
  explanationSource: 'rule';
};

export type RecommendationResult = {
  recommendations: Recommendation[];
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
  'id' | 'ruleCode' | 'canGenerateProposal' | 'explanationSource'
> & {
  stableKey: string;
};

export type RecommendationRule = {
  code: string;
  order: number;
  evaluate: (context: GuideContext) => RecommendationCandidate[];
};
