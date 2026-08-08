import type { BuildGuideContextInput, GuideArea, GuideContext } from './types.ts';

const clean = (value: unknown) => String(value ?? '').trim();

const toGuideArea = (row: Record<string, unknown>): GuideArea => ({
  recordId: clean(row.id),
  id: clean(row.area_index),
  label: clean(row.label) || `區域 ${clean(row.area_index)}`,
  actionType: clean(row.action_type).toLowerCase(),
  uri: clean(row.action_uri),
  text: clean(row.action_text),
  data: clean(row.action_data),
  displayText: clean(row.action_display_text),
  targetPageId: clean(row.target_page_id),
});

const hasConfiguredType = (area: GuideArea) =>
  ['uri', 'message', 'postback', 'richmenuswitch'].includes(area.actionType);

const hasValidRequiredField = (area: GuideArea) => {
  if (!hasConfiguredType(area)) return false;
  if (area.actionType === 'uri') return Boolean(area.uri);
  if (area.actionType === 'message') return Boolean(area.text);
  if (area.actionType === 'postback') return Boolean(area.data);
  return Boolean(area.targetPageId);
};

export async function buildGuideContext(input: BuildGuideContextInput): Promise<GuideContext | null> {
  const { db, workspaceId, userId, route, entityId, selectedAreaId = '' } = input;

  const project = await db.prepare(`
    SELECT id, name, status, template_id, asset_id
    FROM projects
    WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
    LIMIT 1
  `).bind(entityId, workspaceId).first<Record<string, unknown>>();

  if (!project) return null;

  const [workspace, areaResult, lineAccount] = await Promise.all([
    db.prepare(`
      SELECT id, name
      FROM workspaces
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(workspaceId).first<Record<string, unknown>>(),
    db.prepare(`
      SELECT
        id, area_index, label, action_type, action_uri, action_text,
        action_data, action_display_text, target_page_id
      FROM project_areas
      WHERE project_id = ? AND workspace_id = ?
      ORDER BY area_index ASC
    `).bind(entityId, workspaceId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT
        id,
        webhook_enabled,
        CASE
          WHEN line_bot_channel_access_token IS NOT NULL
           AND trim(line_bot_channel_access_token) <> '' THEN 1 ELSE 0
        END AS has_bot_token,
        CASE
          WHEN line_bot_channel_secret IS NOT NULL
           AND trim(line_bot_channel_secret) <> '' THEN 1 ELSE 0
        END AS has_bot_secret
      FROM workspace_line_accounts
      WHERE workspace_id = ?
      LIMIT 1
    `).bind(workspaceId).first<Record<string, unknown>>(),
  ]);

  const areas = (areaResult.results || []).map(row => toGuideArea(row));
  const selectedArea = areas.find(area => area.id === clean(selectedAreaId)) || null;
  const allAreasConfigured = areas.length > 0 && areas.every(hasConfiguredType);
  const hasInvalidActions = areas.length === 0 || areas.some(area => !hasValidRequiredField(area));
  const accountExists = Boolean(lineAccount?.id);
  const hasBotToken = Number(lineAccount?.has_bot_token || 0) === 1;

  return {
    workspaceId,
    userId,
    route: clean(route) || `/projects/${entityId}`,
    page: {
      key: 'project_detail',
      title: 'Project Detail',
    },
    workspace: {
      id: clean(workspace?.id) || workspaceId,
      name: clean(workspace?.name),
    },
    project: {
      id: clean(project.id),
      name: clean(project.name),
      status: clean(project.status) || 'draft',
      templateId: clean(project.template_id) || null,
      assetId: clean(project.asset_id) || null,
      areaCount: areas.length,
    },
    selectedArea: selectedArea ? {
      id: selectedArea.id,
      label: selectedArea.label,
      actionType: selectedArea.actionType,
    } : null,
    areas,
    lineAccount: {
      exists: accountExists,
      hasBotToken,
      hasBotSecret: Number(lineAccount?.has_bot_secret || 0) === 1,
      webhookEnabled: accountExists && Number(lineAccount?.webhook_enabled || 0) === 1,
    },
    completeness: {
      projectHasImage: Boolean(clean(project.asset_id)),
      allAreasConfigured,
      lineAccountReady: accountExists && hasBotToken,
      hasInvalidActions,
    },
  };
}

const publicUriParts = (value: string) => {
  try {
    const url = new URL(value);
    return { uriHost: url.hostname.toLowerCase(), uriPath: `${url.origin}${url.pathname}` };
  } catch {
    return { uriHost: '', uriPath: '' };
  }
};

export function toPublicGuideContext(context: GuideContext) {
  return {
    ...context,
    areas: context.areas.map(area => ({
      id: area.id,
      label: area.label,
      actionType: area.actionType,
      hasUri: Boolean(area.uri),
      ...publicUriParts(area.uri),
      messageLength: area.text.length,
      hasPostbackData: Boolean(area.data),
      hasDisplayText: Boolean(area.displayText),
      targetPageId: area.targetPageId,
    })),
  };
}
