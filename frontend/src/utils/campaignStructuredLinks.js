export const CAMPAIGN_TRACKED_LINK_MAX_COUNT = 10;
export const CAMPAIGN_TRACKED_LINK_TOKEN_MAX_LENGTH = 40;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const PLACEHOLDER_PATTERN = /\{\{link:([A-Za-z0-9_-]{1,40})\}\}/g;
const RAW_IDENTITY_QUERY_KEYS = new Set([
  'uid', 'userid', 'lineuid', 'lineuserid', 'crmpersonid', 'recipientid', 'executionid', 'deliveryid',
]);

const normalizedQueryKey = value => value.toLowerCase().replace(/[-_.]/g, '');

export const trackedLinkPlaceholder = token => `{{link:${token}}}`;

export function nextTrackedLinkToken(links = []) {
  const used = new Set(links.map(link => link.token));
  let index = 1;
  while (used.has(`link_${index}`)) index += 1;
  return `link_${index}`;
}

export function isValidTrackedLinkDestination(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || Array.from(value).length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return false;
    for (const key of url.searchParams.keys()) {
      if (RAW_IDENTITY_QUERY_KEYS.has(normalizedQueryKey(key))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function validateStructuredLinkDraft(text, links = []) {
  if (!Array.isArray(links) || links.length > CAMPAIGN_TRACKED_LINK_MAX_COUNT) return 'CAMPAIGN_CONTENT_LINKS_INVALID';

  const declared = new Set();
  for (const link of links) {
    if (!link || typeof link !== 'object' || !TOKEN_PATTERN.test(link.token || '')) return 'CAMPAIGN_CONTENT_LINK_TOKEN_INVALID';
    if (declared.has(link.token)) return 'CAMPAIGN_CONTENT_LINK_TOKEN_DUPLICATE';
    const labelCharacters = typeof link.label === 'string' ? Array.from(link.label) : [];
    const hasControlCharacter = labelCharacters.some(character => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
    if (typeof link.label !== 'string' || !link.label.trim() || link.label !== link.label.trim()
      || labelCharacters.length > 120 || hasControlCharacter) return 'CAMPAIGN_CONTENT_LINK_LABEL_INVALID';
    if (!isValidTrackedLinkDestination(link.destinationUrl)) return 'CAMPAIGN_CONTENT_LINK_DESTINATION_INVALID';
    declared.add(link.token);
  }

  const uses = new Map();
  const matchedText = String(text || '').replace(PLACEHOLDER_PATTERN, (_placeholder, token) => {
    uses.set(token, (uses.get(token) || 0) + 1);
    return '';
  });
  if (matchedText.includes('{{link:')) return 'CAMPAIGN_CONTENT_LINK_TOKEN_INVALID';
  for (const [token, count] of uses) {
    if (!declared.has(token)) return 'CAMPAIGN_CONTENT_LINK_TOKEN_UNDECLARED';
    if (count !== 1) return 'CAMPAIGN_CONTENT_LINK_TOKEN_REUSED';
  }
  for (const token of declared) {
    if (uses.get(token) !== 1) return 'CAMPAIGN_CONTENT_LINK_UNUSED';
  }
  return '';
}

export function createStructuredCampaignContent(text, links = []) {
  return links.length
    ? { contentType: 'TEXT', text, links: links.map(({ token, destinationUrl, label }) => ({ token, destinationUrl, label })) }
    : { contentType: 'TEXT', text };
}

export function removeTrackedLinkPlaceholder(text, token) {
  return String(text || '').split(trackedLinkPlaceholder(token)).join('');
}

export function humanizeTrackedLinkText(text, links = []) {
  let result = String(text || '');
  for (const link of links) {
    result = result.split(trackedLinkPlaceholder(link.token)).join(`[${link.label || '追蹤連結'}]`);
  }
  return result.replace(/\{\{link:[^}]*\}\}/g, '[無法顯示的追蹤連結]');
}
