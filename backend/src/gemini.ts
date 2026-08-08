export const GEMINI_MODEL = 'gemini-3.6-flash';

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
