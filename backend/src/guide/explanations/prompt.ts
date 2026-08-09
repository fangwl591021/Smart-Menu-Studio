import type { Recommendation } from '../recommendations/types.ts';
import type { BehaviorExplanationRecommendationInput, ExplanationRecommendationInput } from './types.ts';

export const RECOMMENDATION_EXPLANATION_SYSTEM_PROMPT = [
  '你是 Smart Menu Studio 的建議說明器，只能解釋已存在的確定性建議。',
  '使用繁體中文，只輸出 JSON，不得輸出 Markdown 或 HTML。',
  '不得新增、刪除、改寫建議，不得改變優先級、規則代碼、類別、證據或任何 Guide/Workflow 狀態。',
  '不得聲稱已修改、發布或執行任何操作，也不得猜測使用者的業務。',
  '只輸出 summary、whyItMatters、suggestedApproach 三個字串欄位；依序不超過 80、160、180 個字元。',
].join('\n');

const SAFE_BEHAVIOR_EVIDENCE_KEYS = new Set(['periodFrom', 'periodTo', 'periodDays', 'impressions', 'clicks', 'metricsThrough', 'areaLabel', 'areaClicks', 'shareOfClicks', 'combinedShare', 'areaCount', 'lowEngagementAreaCount', 'lowEngagementRatio', 'uriClicks', 'totalClicks', 'uriShare', 'postbackClicks', 'postbackShare', 'recentClicks', 'previousClicks', 'recentCtr', 'previousCtr']);
const primitive = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

export function sanitizeBehaviorRecommendationForAi(recommendation: Recommendation): BehaviorExplanationRecommendationInput {
  const evidence = recommendation.evidence.filter(item => SAFE_BEHAVIOR_EVIDENCE_KEYS.has(item.key) && primitive(item.value)).map(item => ({ key: item.key, value: item.value }));
  const value = (key: string) => evidence.find(item => item.key === key)?.value;
  return { ruleCode: recommendation.ruleCode, category: recommendation.category, priority: recommendation.priority, tone: recommendation.tone === 'positive' ? 'positive' : 'improvement', title: recommendation.title, message: recommendation.message, period: { from: typeof value('periodFrom') === 'string' ? value('periodFrom') : '', to: typeof value('periodTo') === 'string' ? value('periodTo') : '', days: typeof value('periodDays') === 'number' ? value('periodDays') : 0 }, evidence };
}

export function toExplanationInput(recommendation: Recommendation): ExplanationRecommendationInput | BehaviorExplanationRecommendationInput {
  if (recommendation.source === 'behavior') return sanitizeBehaviorRecommendationForAi(recommendation);
  return {
    ruleCode: recommendation.ruleCode,
    category: recommendation.category,
    priority: recommendation.priority,
    title: recommendation.title,
    message: recommendation.message,
    reason: recommendation.reason,
    evidence: recommendation.evidence.map(item => ({ key: item.key, value: item.value })),
  };
}

export function buildExplanationPrompt(recommendation: Recommendation): string {
  return JSON.stringify({
    task: '請解釋以下既有建議，讓使用者理解重要性與可採取的方向。不要增加新建議。',
    recommendation: toExplanationInput(recommendation),
  });
}
