export const MAX_REQUEST_BYTES = 2_900_000;
export const MAX_RESPONSE_BYTES = 512 * 1024;

export const unavailable = () => Response.json({ code: 500, data: 'OCR_UNAVAILABLE' },
  { status: 503, headers: { 'Cache-Control': 'no-store' } });
export const busy = () => Response.json({ code: 850, data: 'OCR_BUSY' },
  { status: 503, headers: { 'Cache-Control': 'no-store' } });

export function allowed(request: Request) {
  const url = new URL(request.url);
  return request.method === 'POST' && url.pathname === '/api/ocr' && !url.search
    && request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json'
    && !request.headers.has('Content-Encoding');
}

// Bound actual streamed bytes; don't trust the client's Content-Length.
export async function boundedText(stream: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!stream || signal.aborted) throw new Error('OCR_UNAVAILABLE');
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let total = 0, text = '';
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new Error('OCR_UNAVAILABLE');
      if (chunk.done) return text + decoder.decode();
      total += chunk.value.byteLength;
      if (total > limit) throw new Error('OCR_UNAVAILABLE');
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function cleanRequest(request: Request, signal: AbortSignal) {
  if (!allowed(request)) throw new Error('OCR_INPUT_INVALID');
  const body = await boundedText(request.body, MAX_REQUEST_BYTES, signal);
  const input = JSON.parse(body);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => key !== 'base64' && key !== 'options')
    || typeof input.base64 !== 'string' || input.base64.length > 2_796_204
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw new Error('OCR_INPUT_INVALID');
  // Re-encode, so no cookies, authorization, LINE identifiers, arbitrary headers
  // or user-controlled host/redirect target can enter the native service.
  return new Request('http://container/api/ocr', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), redirect: 'manual' });
}

export async function cleanResponse(response: Response, signal: AbortSignal) {
  if (!response.ok) { await response.body?.cancel(); return unavailable(); }
  const input = JSON.parse(await boundedText(response.body, MAX_RESPONSE_BYTES, signal));
  if (input.code === 101) return Response.json({ code: 101, data: [] }, { headers: { 'Cache-Control': 'no-store' } });
  if (input.code !== 100 || !Array.isArray(input.data)) return unavailable();
  // Fine-grained score/text/box validation remains in the existing hybrid adapter.
  return Response.json({ code: 100, data: input.data }, { headers: { 'Cache-Control': 'no-store' } });
}
