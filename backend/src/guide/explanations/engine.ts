import { requestGeminiContent } from '../../gemini.ts';
import type { Recommendation } from '../recommendations/types.ts';
import { buildExplanationPrompt, RECOMMENDATION_EXPLANATION_SYSTEM_PROMPT } from './prompt.ts';
import type {
  ExplainRecommendationOptions,
  ExplanationContent,
  RecommendationExplanation,
} from './types.ts';

const LIMITS: Record<keyof ExplanationContent, number> = {
  summary: 80,
  whyItMatters: 160,
  suggestedApproach: 180,
};

function fallback(recommendation: Recommendation): RecommendationExplanation {
  return {
    source: 'rule',
    status: 'fallback',
    summary: recommendation.message,
    whyItMatters: recommendation.reason,
    suggestedApproach: '',
  };
}

function validPlainText(value: unknown, maximum: number, allowEmpty = false): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > maximum) return false;
  return !trimmed.includes('```') && !/<\/?[a-z][^>]*>/i.test(trimmed);
}

export function parseExplanation(value: unknown): ExplanationContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!validPlainText(candidate.summary, LIMITS.summary)) return null;
  if (!validPlainText(candidate.whyItMatters, LIMITS.whyItMatters)) return null;
  if (!validPlainText(candidate.suggestedApproach, LIMITS.suggestedApproach, true)) return null;
  return {
    summary: candidate.summary.trim(),
    whyItMatters: candidate.whyItMatters.trim(),
    suggestedApproach: candidate.suggestedApproach.trim(),
  };
}

export function findRecommendationById(
  recommendations: Recommendation[],
  recommendationId: string,
): Recommendation | null {
  return recommendations.find(item => item.id === recommendationId) || null;
}

export async function explainRecommendation(
  recommendation: Recommendation,
  options: ExplainRecommendationOptions,
): Promise<RecommendationExplanation> {
  const log = (status: Parameters<NonNullable<typeof options.logger>>[0]['status']) =>
    options.logger?.({ message: 'recommendation explanation', status, ruleCode: recommendation.ruleCode });

  if (!options.apiKey) {
    log('missing_key');
    return fallback(recommendation);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  try {
    const response = await requestGeminiContent({
      apiKey: options.apiKey,
      fetcher: options.fetcher,
      signal: controller.signal,
      body: {
        systemInstruction: { parts: [{ text: RECOMMENDATION_EXPLANATION_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildExplanationPrompt(recommendation) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 512,
          responseSchema: {
            type: 'OBJECT',
            properties: {
              summary: { type: 'STRING', description: '繁體中文摘要，最多 80 個字元。' },
              whyItMatters: { type: 'STRING', description: '重要性說明，最多 160 個字元。' },
              suggestedApproach: { type: 'STRING', description: '可採取方向，最多 180 個字元，可為空字串。' },
            },
            required: ['summary', 'whyItMatters', 'suggestedApproach'],
          },
        },
      },
    });

    if (!response.ok) {
      log('request_error');
      return fallback(recommendation);
    }

    let result: Record<string, unknown>;
    try {
      result = await response.json() as Record<string, unknown>;
    } catch {
      log('parse_error');
      return fallback(recommendation);
    }
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const first = candidates[0] as Record<string, unknown> | undefined;
    const content = first?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const outputText = (parts[0] as Record<string, unknown> | undefined)?.text;
    if (typeof outputText !== 'string') {
      log('parse_error');
      return fallback(recommendation);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      log('parse_error');
      return fallback(recommendation);
    }

    const explanation = parseExplanation(parsed);
    if (!explanation) {
      log('parse_error');
      return fallback(recommendation);
    }

    log('success');
    return { source: 'gemini', status: 'generated', ...explanation };
  } catch (error) {
    log(controller.signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'timeout' : 'request_error');
    return fallback(recommendation);
  } finally {
    clearTimeout(timeout);
  }
}
