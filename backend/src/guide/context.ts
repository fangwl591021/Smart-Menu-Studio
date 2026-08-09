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
  const today = new Date().toISOString().slice(0,10); const from = new Date(Date.now()-29*86400000).toISOString().slice(0,10);
  const [binding, metricsResult, areaMetricsResult, dailyResult, mappingResult] = await Promise.all([
    db.prepare(`SELECT last_synced_at FROM workspace_rich_menu_bindings WHERE workspace_id=? AND project_id=? AND status='active' LIMIT 1`).bind(workspaceId, entityId).first<Record<string, unknown>>(),
    db.prepare(`SELECT SUM(impressions) impressions,SUM(clicks) clicks,MAX(metric_date) metrics_through,MAX(data_status) data_status FROM line_intelligence_daily WHERE workspace_id=? AND project_id=? AND project_area_id='' AND metric_date>=? AND metric_date<=?`).bind(workspaceId,entityId,from,today).first<Record<string, unknown>>(),
    db.prepare(`SELECT d.project_area_id id,pa.label,pa.action_type,SUM(d.clicks) clicks FROM line_intelligence_daily d JOIN project_areas pa ON pa.id=d.project_area_id AND pa.workspace_id=d.workspace_id WHERE d.workspace_id=? AND d.project_id=? AND d.project_area_id<>'' AND d.metric_date>=? GROUP BY d.project_area_id`).bind(workspaceId,entityId,from).all<Record<string, unknown>>(),
    db.prepare(`SELECT metric_date date,impressions,clicks FROM line_intelligence_daily WHERE workspace_id=? AND project_id=? AND project_area_id='' AND metric_date>=? ORDER BY metric_date`).bind(workspaceId,entityId,new Date(Date.now()-13*86400000).toISOString().slice(0,10)).all<Record<string, unknown>>(),
    db.prepare(`SELECT SUM(CASE WHEN project_area_id IS NOT NULL AND project_area_id<>'' THEN 1 ELSE 0 END) mapped,COUNT(*) total FROM line_rich_menu_insight_daily WHERE workspace_id=? AND project_id=? AND click_count IS NOT NULL AND bounds_width>=0 AND bounds_height>=0 AND metric_date>=?`).bind(workspaceId,entityId,from).first<Record<string, unknown>>(),
  ]);
  const impressions=Number(metricsResult?.impressions||0), clicks=Number(metricsResult?.clicks||0), metricsThrough=clean(metricsResult?.metrics_through), lastSyncAt=clean(binding?.last_synced_at); const freshness=metricsThrough ? Math.floor((Date.now()-Date.parse(metricsThrough+'T00:00:00Z'))/86400000) : Infinity;
  const mappedAreaRatio=Number(mappingResult?.total||0)?Number(mappingResult?.mapped||0)/Number(mappingResult?.total||0):0;
  const behavior:any={ period:{from,to:today,days:30}, project:{impressions,clicks}, areas:(areaMetricsResult.results||[]).map(row=>({id:clean(row.id),label:clean(row.label),actionType:clean(row.action_type),clicks:Number(row.clicks||0)})), daily:dailyResult.results||[], dataQuality:{sufficient:Boolean(binding)&&impressions>=100&&freshness<=3&&mappedAreaRatio>=.8&&metricsResult?.data_status!=='privacy_suppressed',reasonCode:!binding?'NO_BINDING':!metricsThrough?'NO_SYNC':metricsResult?.data_status==='privacy_suppressed'?'PRIVACY_SUPPRESSED':impressions<100?'INSUFFICIENT_IMPRESSIONS':freshness>3?'STALE_DATA':mappedAreaRatio<.8?'MAPPING_INCOMPLETE':'OK',metricsThrough,lastSyncAt,mappedAreaRatio} };
  const [journeySummary, journeyAreas, conversionKey, journeyMapping] = await Promise.all([
    db.prepare(`SELECT SUM(observed_sessions) observed_sessions,SUM(message_actions)+SUM(postback_actions)+SUM(switch_actions) observed_actions,SUM(keyword_matches) keyword_matches,SUM(webhook_routes) webhook_routes,SUM(webhook_successes) webhook_successes,SUM(webhook_failures) webhook_failures,SUM(conversions) conversions,SUM(conversion_value_minor) conversion_value_minor,MAX(metric_date) metrics_through FROM line_journey_daily WHERE workspace_id=? AND project_id=? AND project_area_id='' AND metric_date>=? AND metric_date<=?`).bind(workspaceId,entityId,from,today).first<Record<string,unknown>>(),
    db.prepare(`SELECT d.project_area_id area_id,pa.label,pa.action_type,SUM(d.observed_sessions) sessions,SUM(d.message_actions)+SUM(d.postback_actions)+SUM(d.switch_actions) observed_actions,SUM(d.keyword_matches) keyword_matches,SUM(d.webhook_successes) webhook_successes,SUM(d.conversions) conversions,SUM(d.conversion_value_minor) conversion_value_minor,SUM(i.clicks) aggregate_clicks FROM line_journey_daily d LEFT JOIN project_areas pa ON pa.id=d.project_area_id AND pa.workspace_id=d.workspace_id LEFT JOIN line_intelligence_daily i ON i.workspace_id=d.workspace_id AND i.project_id=d.project_id AND i.project_area_id=d.project_area_id AND i.metric_date=d.metric_date WHERE d.workspace_id=? AND d.project_id=? AND d.project_area_id<>'' AND d.metric_date>=? AND d.metric_date<=? GROUP BY d.project_area_id`).bind(workspaceId,entityId,from,today).all<Record<string,unknown>>(),
    db.prepare(`SELECT id FROM workspace_conversion_api_keys WHERE workspace_id=? AND status='active' LIMIT 1`).bind(workspaceId).first<Record<string,unknown>>(),
    db.prepare(`SELECT SUM(CASE WHEN project_area_id IS NOT NULL AND project_area_id<>'' THEN 1 ELSE 0 END) mapped,COUNT(*) total FROM line_journey_events WHERE workspace_id=? AND project_id=? AND occurred_at>=?`).bind(workspaceId,entityId,from+'T00:00:00.000Z').first<Record<string,unknown>>(),
  ]);
  const jq:any=journeySummary||{}; const observedSessions=Number(jq.observed_sessions||0), observedActions=Number(jq.observed_actions||0), webhookRoutes=Number(jq.webhook_routes||0), conversions=Number(jq.conversions||0), journeyMetricsThrough=clean(jq.metrics_through); const journeyFreshness=journeyMetricsThrough?Math.floor((Date.now()-Date.parse(journeyMetricsThrough+'T00:00:00Z'))/86400000):Infinity; const journeyMappingRatio=Number(journeyMapping?.total||0)?Number(journeyMapping?.mapped||0)/Number(journeyMapping?.total||0):0; const integrationAvailable=Boolean(conversionKey?.id); const reasonCodes:string[]=[]; if(!observedActions)reasonCodes.push('NO_JOURNEY_DATA'); if(observedSessions<30)reasonCodes.push('INSUFFICIENT_OBSERVED_SESSIONS'); if(webhookRoutes<20)reasonCodes.push('INSUFFICIENT_WEBHOOK_SAMPLES'); if(integrationAvailable&&conversions<10)reasonCodes.push('INSUFFICIENT_CONVERSION_SAMPLES'); if(journeyFreshness>3)reasonCodes.push('STALE_DATA'); if(Number(journeyMapping?.total||0)>0&&journeyMappingRatio<.8)reasonCodes.push('MAPPING_INCOMPLETE'); if(!integrationAvailable)reasonCodes.push('NO_CONVERSION_INTEGRATION'); const journey:any={period:{from,to:today,days:30},project:{observedActions,aggregateClicks:clicks,keywordMatches:Number(jq.keyword_matches||0),webhookRoutes,webhookSuccesses:Number(jq.webhook_successes||0),webhookFailures:Number(jq.webhook_failures||0),conversions,conversionValueMinor:Number(jq.conversion_value_minor||0)},areas:(journeyAreas.results||[]).map((row:any)=>({areaId:clean(row.area_id),label:clean(row.label),actionType:clean(row.action_type),sessions:Number(row.sessions||0),observedActions:Number(row.observed_actions||0),keywordMatches:Number(row.keyword_matches||0),webhookSuccesses:Number(row.webhook_successes||0),conversions:Number(row.conversions||0),conversionValueMinor:Number(row.conversion_value_minor||0),aggregateClicks:Number(row.aggregate_clicks||0),observedConversionRate:Number(row.observed_actions||0)?Number(row.conversions||0)/Number(row.observed_actions||0):null})),dataQuality:{ready:reasonCodes.filter(x=>x!=='NO_CONVERSION_INTEGRATION').length===0,reasonCodes,observedSessions,webhookSamples:webhookRoutes,conversionSamples:conversions,freshnessDays:journeyFreshness,mappingRatio:journeyMappingRatio,conversionIntegrationAvailable:integrationAvailable}};  const accountExists = Boolean(lineAccount?.id);
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
    behavior,
    journey,
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

export function mappedMappableClickBoundsRatio(rows: Array<{ project_area_id?: unknown; bounds_width?: unknown; bounds_height?: unknown }>): number {
  const mappable = rows.filter(row => Number(row.bounds_width) >= 0 && Number(row.bounds_height) >= 0);
  if (!mappable.length) return 0;
  return mappable.filter(row => clean(row.project_area_id)).length / mappable.length;
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
    behavior: context.behavior ? { period: context.behavior.period, project: context.behavior.project, areas: context.behavior.areas, dataQuality: context.behavior.dataQuality } : undefined,
    journey: (context as any).journey ? { period:(context as any).journey.period, project:(context as any).journey.project, areas:(context as any).journey.areas, dataQuality:(context as any).journey.dataQuality } : undefined,
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
