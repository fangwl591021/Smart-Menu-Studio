export const GEMINI_MODEL = 'gemini-3.6-flash';

export const AI_PROVIDER_NOT_CONFIGURED = 'AI_PROVIDER_NOT_CONFIGURED';
export const AI_PROVIDER_NOT_CONFIGURED_MESSAGE = 'AI 服務目前尚未完成平台設定，請聯絡系統管理員。';

export function geminiProviderNotConfiguredResponse() {
  return {
    success: false as const,
    code: AI_PROVIDER_NOT_CONFIGURED,
    error: AI_PROVIDER_NOT_CONFIGURED_MESSAGE,
  };
}

export type GeminiRequestOptions = {
  apiKey: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

export async function requestGeminiContent(options: GeminiRequestOptions): Promise<Response> {
  const fetcher = options.fetcher || fetch;
  return fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': options.apiKey,
      },
      body: JSON.stringify(options.body),
      signal: options.signal,
    },
  );
}
