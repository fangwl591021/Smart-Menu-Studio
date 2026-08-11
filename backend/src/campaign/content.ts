export const CAMPAIGN_TEXT_MAX_LENGTH = 5000;
export const CAMPAIGN_TRACKED_LINK_MAX_COUNT = 10;
export const CAMPAIGN_TRACKED_LINK_TOKEN_MAX_LENGTH = 40;

const DESTINATION_URL_MAX_LENGTH = 2048;
const LINK_LABEL_MAX_LENGTH = 120;
const TRACKED_TOKEN_PREFIX = '{{link:';
const TRACKED_TOKEN_PATTERN = /^\{\{link:([A-Za-z0-9_-]{1,40})\}\}$/;
const TOKEN_NAME_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const RAW_IDENTITY_QUERY_KEYS = new Set([
  'uid', 'userid', 'lineuid', 'lineuserid', 'crmpersonid', 'recipientid', 'executionid', 'deliveryid',
]);

export type CampaignTrackedLinkDefinition = Readonly<{
  token: string;
  destinationUrl: string;
  label: string;
}>;

export type CampaignTextPayload = Readonly<{
  text: string;
  links: readonly CampaignTrackedLinkDefinition[];
}>;

export type CampaignTrackedLinkResolver = (
  link: CampaignTrackedLinkDefinition,
) => string | Promise<string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).sort().join(',') === [...allowed].sort().join(',');
}

function normalizedQueryKey(value: string) {
  return value.toLowerCase().replace(/[-_.]/g, '');
}

function validatedHttpsUrl(raw: unknown, errorCode: string) {
  if (typeof raw !== 'string' || !raw || Array.from(raw).length > DESTINATION_URL_MAX_LENGTH || raw !== raw.trim()) {
    throw new Error(errorCode);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(errorCode);
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error(errorCode);
  for (const key of url.searchParams.keys()) {
    if (RAW_IDENTITY_QUERY_KEYS.has(normalizedQueryKey(key))) throw new Error(errorCode);
  }
  return url.toString();
}

function trackedTokenUses(text: string, errorCode: string) {
  const uses: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(TRACKED_TOKEN_PREFIX, cursor);
    if (start < 0) break;
    const end = text.indexOf('}}', start + TRACKED_TOKEN_PREFIX.length);
    if (end < 0) throw new Error(errorCode);
    const expression = text.slice(start, end + 2);
    const match = TRACKED_TOKEN_PATTERN.exec(expression);
    if (!match) throw new Error(errorCode);
    uses.push(match[1]);
    cursor = end + 2;
  }
  return uses;
}

function normalizePayload(raw: unknown, errorPrefix: 'CAMPAIGN_CONTENT' | 'CAMPAIGN_EXECUTION_CONTENT'): CampaignTextPayload {
  const invalid = `${errorPrefix}_INVALID`;
  if (!isRecord(raw)) throw new Error(invalid);
  const hasLinks = Object.prototype.hasOwnProperty.call(raw, 'links');
  if (!exactKeys(raw, hasLinks ? ['text', 'links'] : ['text']) || typeof raw.text !== 'string') throw new Error(invalid);
  const text = raw.text;
  const textLength = Array.from(text).length;
  if (!text.trim() || textLength > CAMPAIGN_TEXT_MAX_LENGTH) {
    throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_TEXT_INVALID' : invalid);
  }
  if (!hasLinks) {
    const uses = trackedTokenUses(
      text,
      errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_TOKEN_INVALID' : invalid,
    );
    if (uses.length) {
      throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_TOKEN_UNDECLARED' : invalid);
    }
    return Object.freeze({ text, links: Object.freeze([]) });
  }
  if (!Array.isArray(raw.links) || raw.links.length > CAMPAIGN_TRACKED_LINK_MAX_COUNT) {
    throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINKS_INVALID' : invalid);
  }

  const links: CampaignTrackedLinkDefinition[] = [];
  const declared = new Set<string>();
  for (const item of raw.links) {
    if (!isRecord(item) || !exactKeys(item, ['token', 'destinationUrl', 'label'])) throw new Error(invalid);
    if (typeof item.token !== 'string' || !TOKEN_NAME_PATTERN.test(item.token)) {
      throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_TOKEN_INVALID' : invalid);
    }
    if (declared.has(item.token)) {
      throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_TOKEN_DUPLICATE' : invalid);
    }
    if (typeof item.label !== 'string' || item.label !== item.label.trim() || !item.label
      || Array.from(item.label).length > LINK_LABEL_MAX_LENGTH || CONTROL_CHARACTER_PATTERN.test(item.label)) {
      throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_LABEL_INVALID' : invalid);
    }
    const destinationUrl = validatedHttpsUrl(
      item.destinationUrl,
      errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_DESTINATION_INVALID' : invalid,
    );
    declared.add(item.token);
    links.push(Object.freeze({ token: item.token, destinationUrl, label: item.label }));
  }

  const tokenError = errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_TOKEN_INVALID' : invalid;
  const uses = trackedTokenUses(text, tokenError);
  const counts = new Map<string, number>();
  for (const token of uses) counts.set(token, (counts.get(token) || 0) + 1);
  for (const [token, count] of counts) {
    if (!declared.has(token)) {
      throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_TOKEN_UNDECLARED' : invalid);
    }
    if (count !== 1) {
      throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_TOKEN_REUSED' : invalid);
    }
  }
  for (const token of declared) {
    if (counts.get(token) !== 1) {
      throw new Error(errorPrefix === 'CAMPAIGN_CONTENT' ? 'CAMPAIGN_CONTENT_LINK_UNUSED' : invalid);
    }
  }

  links.sort((left, right) => left.token < right.token ? -1 : left.token > right.token ? 1 : 0);
  return Object.freeze({ text, links: Object.freeze(links) });
}

export function validateCampaignContent(raw: unknown) {
  if (!isRecord(raw)) throw new Error('CAMPAIGN_CONTENT_INVALID');
  const hasLinks = Object.prototype.hasOwnProperty.call(raw, 'links');
  if (!exactKeys(raw, hasLinks ? ['contentType', 'text', 'links'] : ['contentType', 'text']) || raw.contentType !== 'TEXT') {
    throw new Error('CAMPAIGN_CONTENT_INVALID');
  }
  const payload = normalizePayload(
    hasLinks ? { text: raw.text, links: raw.links } : { text: raw.text },
    'CAMPAIGN_CONTENT',
  );
  const storedPayload = payload.links.length ? { text: payload.text, links: payload.links } : { text: payload.text };
  return {
    contentType: 'TEXT' as const,
    text: payload.text,
    links: payload.links,
    textLength: Array.from(payload.text).length,
    payloadJson: JSON.stringify(storedPayload),
  };
}

export function parseCampaignTextContent(contentType: unknown, payloadJson: unknown): CampaignTextPayload {
  if (String(contentType) !== 'TEXT') throw new Error('CAMPAIGN_EXECUTION_CONTENT_INVALID');
  let payload: unknown;
  try {
    payload = JSON.parse(String(payloadJson || ''));
  } catch {
    throw new Error('CAMPAIGN_EXECUTION_CONTENT_INVALID');
  }
  return normalizePayload(payload, 'CAMPAIGN_EXECUTION_CONTENT');
}

export function publicCampaignTextContent(contentType: unknown, payloadJson: unknown) {
  const content = parseCampaignTextContent(contentType, payloadJson);
  return {
    text: content.text,
    ...(content.links.length ? { links: content.links.map(link => ({ ...link })) } : {}),
  };
}

export async function renderCampaignTextContent(input: {
  contentType: unknown;
  payloadJson: unknown;
  resolveTrackedLink?: CampaignTrackedLinkResolver;
}) {
  const content = parseCampaignTextContent(input.contentType, input.payloadJson);
  if (!content.links.length) return content.text;
  if (!input.resolveTrackedLink) throw new Error('CAMPAIGN_TRACKED_LINK_RESOLVER_REQUIRED');

  let rendered = content.text;
  for (const link of content.links) {
    // Future 7C may bind execution and delivery context in the resolver closure. The resolver contract itself
    // intentionally receives only the frozen definition; it exposes no execution, delivery, Person, or LINE IDs.
    const resolved = await input.resolveTrackedLink(link);
    const opaqueUrl = validatedHttpsUrl(resolved, 'CAMPAIGN_TRACKED_LINK_RESOLUTION_INVALID');
    rendered = rendered.replace(`{{link:${link.token}}}`, opaqueUrl);
  }
  if (Array.from(rendered).length > CAMPAIGN_TEXT_MAX_LENGTH) throw new Error('CAMPAIGN_RENDERED_TEXT_TOO_LONG');
  return rendered;
}

// Architecture lock: a future click by an already-known CRM Person is engagement, never acquisition.
// 7C-A intentionally creates no click event, redirect route, or crm_acquisition_events mutation.
