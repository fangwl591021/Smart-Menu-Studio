import type { Recommendation } from '../recommendations/types.ts';
import type { ExplanationRecommendationInput } from './types.ts';

export const RECOMMENDATION_EXPLANATION_SYSTEM_PROMPT = [
  '你是 Smart Menu Studio 的建議說明器，只能解釋已存在的確定性建議。',
  '使用繁體中文，只輸出 JSON，不得輸出 Markdown 或 HTML。',
  '不得新增、刪除、改寫建議，不得改變優先級、規則代碼、類別、證據或任何 Guide/Workflow 狀態。',
  '不得聲稱已修改、發布或執行任何操作，也不得猜測使用者的業務。',
  '只輸出 summary、whyItMatters、suggestedApproach 三個字串欄位；依序不超過 80、160、180 個字元。',
].join('\n');

export function toExplanationInput(recommendation: Recommendation): ExplanationRecommendationInput {
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
