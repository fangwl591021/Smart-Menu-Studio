const PROJECT_ACTION_TYPES = new Set(['uri', 'message', 'postback', 'richmenuswitch']);

const cleanText = (value) => String(value ?? '').trim();

export function normalizeRichMenuAliasId(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function richMenuAliasIdForProject(projectId) {
  return normalizeRichMenuAliasId(projectId);
}

export function switchDataForAlias(aliasId) {
  const normalized = normalizeRichMenuAliasId(aliasId);
  return normalized ? `switch:${normalized}` : '';
}

export function normalizeProjectAreaAction(areaOrAction, options = {}) {
  const source = areaOrAction?.action || areaOrAction || {};
  const requestedType = cleanText(source.type).toLowerCase();
  const type = PROJECT_ACTION_TYPES.has(requestedType) ? requestedType : 'uri';

  if (type === 'uri') {
    return { type, uri: cleanText(source.uri) };
  }

  if (type === 'message') {
    return { type, text: cleanText(source.text) };
  }

  if (type === 'postback') {
    const action = { type, data: cleanText(source.data) };
    const displayText = cleanText(source.displayText);
    if (displayText) action.displayText = displayText;
    return action;
  }

  const targetPageId = cleanText(source.targetPageId);
  const allowedTargetPageIds = options.allowedTargetPageIds;
  if (allowedTargetPageIds && !allowedTargetPageIds.has(targetPageId)) {
    throw new Error('INVALID_SWITCH_TARGET');
  }

  const richMenuAliasId = richMenuAliasIdForProject(targetPageId);
  return {
    type,
    targetPageId,
    richMenuAliasId,
    data: switchDataForAlias(richMenuAliasId),
  };
}

export function projectAreaActionFromRow(row) {
  return normalizeProjectAreaAction({
    type: row?.action_type,
    uri: row?.action_uri,
    text: row?.action_text,
    data: row?.action_data,
    displayText: row?.action_display_text,
    targetPageId: row?.target_page_id,
  });
}