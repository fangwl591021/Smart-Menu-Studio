const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
export const LINE_PUSH_TIMEOUT_MS = 10_000;

export type LinePushResult = {
  accepted: boolean;
  providerStatusCode: number | null;
  safeErrorCode: string | null;
  retryable: boolean;
  alreadyAccepted: boolean;
};

export type LineCampaignPreflightResult = {
  ready: boolean;
  safeErrorCode: string | null;
};

async function boundedJson(response: Response) {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function preflightLineCampaignSend(input: {
  channelAccessToken: string;
  recipientCount: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<LineCampaignPreflightResult> {
  const fetcher = input.fetcher || fetch;
  const headers = { Authorization: `Bearer ${input.channelAccessToken}` };
  const request = async (url: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('LINE_TIMEOUT'), input.timeoutMs || LINE_PUSH_TIMEOUT_MS);
    try {
      return await fetcher(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    const bot = await request('https://api.line.me/v2/bot/info');
    if (bot.status === 401 || bot.status === 403) return { ready: false, safeErrorCode: 'LINE_INVALID_CREDENTIAL' };
    if (!bot.ok) return { ready: false, safeErrorCode: 'LINE_CREDENTIAL_PREFLIGHT_FAILED' };
    const quota = await request('https://api.line.me/v2/bot/message/quota');
    const consumption = await request('https://api.line.me/v2/bot/message/quota/consumption');
    if (!quota.ok || !consumption.ok) return { ready: false, safeErrorCode: 'LINE_QUOTA_PREFLIGHT_FAILED' };
    const [quotaBody, consumptionBody] = await Promise.all([boundedJson(quota), boundedJson(consumption)]);
    if (quotaBody.type === 'limited') {
      const limit = Number(quotaBody.value);
      const used = Number(consumptionBody.totalUsage);
      if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(used) || limit < 0 || used < 0) {
        return { ready: false, safeErrorCode: 'LINE_QUOTA_PREFLIGHT_FAILED' };
      }
      if (limit - used < input.recipientCount) return { ready: false, safeErrorCode: 'LINE_QUOTA_INSUFFICIENT' };
    } else if (quotaBody.type !== 'none') {
      return { ready: false, safeErrorCode: 'LINE_QUOTA_PREFLIGHT_FAILED' };
    }
    return { ready: true, safeErrorCode: null };
  } catch {
    return { ready: false, safeErrorCode: 'LINE_CREDENTIAL_PREFLIGHT_FAILED' };
  }
}
export function classifyLinePushStatus(status: number, acceptedRequestId = ''): LinePushResult {
  if (status >= 200 && status < 300) {
    return { accepted: true, providerStatusCode: status, safeErrorCode: null, retryable: false, alreadyAccepted: false };
  }
  if (status === 409 && acceptedRequestId) {
    return { accepted: true, providerStatusCode: status, safeErrorCode: null, retryable: false, alreadyAccepted: true };
  }
  if (status === 429) {
    return { accepted: false, providerStatusCode: status, safeErrorCode: 'LINE_RATE_LIMITED', retryable: true, alreadyAccepted: false };
  }
  if (status >= 500) {
    return { accepted: false, providerStatusCode: status, safeErrorCode: 'LINE_SERVER_ERROR', retryable: true, alreadyAccepted: false };
  }
  if (status === 401 || status === 403) {
    return { accepted: false, providerStatusCode: status, safeErrorCode: 'LINE_INVALID_CREDENTIAL', retryable: false, alreadyAccepted: false };
  }
  if (status === 400 || status === 422) {
    return { accepted: false, providerStatusCode: status, safeErrorCode: 'LINE_PROVIDER_REJECTED', retryable: false, alreadyAccepted: false };
  }
  return { accepted: false, providerStatusCode: status, safeErrorCode: 'LINE_PROVIDER_REJECTED', retryable: false, alreadyAccepted: false };
}

export async function sendLineTextPush(input: {
  channelAccessToken: string;
  providerRecipientId: string;
  text: string;
  retryKey: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<LinePushResult> {
  const fetcher = input.fetcher || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('LINE_TIMEOUT'), input.timeoutMs || LINE_PUSH_TIMEOUT_MS);
  try {
    const response = await fetcher(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.channelAccessToken}`,
        'Content-Type': 'application/json',
        'X-Line-Retry-Key': input.retryKey,
      },
      body: JSON.stringify({
        to: input.providerRecipientId,
        messages: [{ type: 'text', text: input.text }],
      }),
      signal: controller.signal,
    });
    return classifyLinePushStatus(response.status, response.headers.get('x-line-accepted-request-id') || '');
  } catch {
    return {
      accepted: false,
      providerStatusCode: null,
      safeErrorCode: 'LINE_TIMEOUT',
      retryable: true,
      alreadyAccepted: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}
