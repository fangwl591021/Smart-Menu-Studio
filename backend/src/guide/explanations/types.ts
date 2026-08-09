import type { Recommendation } from '../recommendations/types.ts';

export type ExplanationContent = {
  summary: string;
  whyItMatters: string;
  suggestedApproach: string;
};

export type RecommendationExplanation = ExplanationContent & {
  source: 'gemini' | 'rule';
  status: 'generated' | 'fallback';
};

export type ExplanationRecommendationInput = Pick<
  Recommendation,
  'ruleCode' | 'category' | 'priority' | 'title' | 'message' | 'reason' | 'evidence'
>;

export type BehaviorExplanationRecommendationInput = {
  ruleCode: string;
  category: string;
  priority: string;
  tone: 'improvement' | 'positive';
  title: string;
  message: string;
  period: { from: string; to: string; days: number };
  evidence: Array<{ key: string; value: string | number | boolean }>;
};

export type ExplanationLogger = (event: {
  message: 'recommendation explanation';
  status: 'success' | 'timeout' | 'request_error' | 'parse_error' | 'missing_key';
  ruleCode: string;
}) => void;

export type ExplainRecommendationOptions = {
  apiKey?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  logger?: ExplanationLogger;
};
