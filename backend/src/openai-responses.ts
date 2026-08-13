export const OPENAI_RESPONSES_MODEL = 'gpt-5.6-terra';

type OpenAiResponsesOptions = {
  service?: Fetcher;
  apiKey?: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

export async function requestOpenAiResponses(options: OpenAiResponsesOptions): Promise<Response> {
  if (options.service) {
    return options.service.fetch('https://mlm.internal/api/internal/ai/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: options.body }),
      signal: options.signal,
    });
  }
  if (!options.apiKey) throw new Error('AI_PROVIDER_NOT_CONFIGURED');
  const fetcher = options.fetcher || fetch;
  return fetcher('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.body),
    signal: options.signal,
  });
}

export function openAiOutputText(payload: unknown): string {
  const root = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
  if (typeof root.output_text === 'string') return root.output_text;
  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    const part = content.find((entry: any) => entry?.type === 'output_text' && typeof entry.text === 'string');
    if (part) return part.text;
  }
  return '';
}

export function openAiUsage(payload: unknown) {
  const root = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
  const usage = root.usage && typeof root.usage === 'object' ? root.usage : {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
    cachedInputTokens: Number(usage.input_tokens_details?.cached_tokens || 0),
    reasoningTokens: Number(usage.output_tokens_details?.reasoning_tokens || 0),
  };
}

export function openAiJsonSchema(value: unknown): any {
  if (Array.isArray(value)) return value.map(openAiJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === 'nullable') continue;
    if (key === 'type' && typeof child === 'string') {
      const type = child.toLowerCase();
      result.type = source.nullable === true ? [type, 'null'] : type;
    } else {
      result[key] = openAiJsonSchema(child);
    }
  }
  return result;
}
