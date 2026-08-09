type Db = D1Database;
type Row = Record<string, unknown>;
const clean = (value: unknown, max = 160) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const count = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const now = () => new Date().toISOString();
const dateValue = (value: unknown) => /^\d{8}$/.test(String(value)) ? `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)}` : clean(value, 10);

export const LINE_INSIGHT_COOLDOWN_MS = 15 * 60 * 1000;
export type LineDaily = { date: string; impressions: number | null; uniqueViewers: number | null; clicks: Array<{ x: number; y: number; width: number; height: number; count: number; uniqueUsers: number }>; privacySuppressed: boolean };

export function parseLineDailyInsight(payload: unknown): LineDaily[] {
  const root = payload && typeof payload === 'object' ? payload as Row : {};
  if (!root.impression && !root.clicks) return [{ date: dateValue(root.metricsFrom), impressions: null, uniqueViewers: null, clicks: [], privacySuppressed: true }];
  const result = new Map<string, LineDaily>();
  for (const metric of Array.isArray((root.impression as Row)?.metrics) ? (root.impression as Row).metrics as unknown[] : []) {
    const item = metric as Row; const date = dateValue(item.date);
    if (date) result.set(date, { date, impressions: count(item.count), uniqueViewers: count(item.uniqueUsers), clicks: [], privacySuppressed: false });
  }
  for (const click of Array.isArray(root.clicks) ? root.clicks as unknown[] : []) {
    const item = click as Row; const bounds = (item.bounds || {}) as Row;
    for (const metric of Array.isArray(item.metrics) ? item.metrics as unknown[] : []) {
      const value = metric as Row; const date = dateValue(value.date); if (!date) continue;
      const entry = result.get(date) || { date, impressions: null, uniqueViewers: null, clicks: [], privacySuppressed: false };
      entry.clicks.push({ x: count(bounds.x), y: count(bounds.y), width: count(bounds.width), height: count(bounds.height), count: count(value.count), uniqueUsers: count(value.uniqueUsers) });
      result.set(date, entry);
    }
  }
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function exactArea(areas: Row[], bounds: Row) { return areas.find(area => count(area.x) === count(bounds.x) && count(area.y) === count(bounds.y) && count(area.width) === count(bounds.width) && count(area.height) === count(bounds.height)) || null; }
export async function hashLineUser(secret: string, userId: string) { if (!secret || !userId) return null; const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId)); return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function actionFingerprint(value: string) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

export async function recordLineActionEvent(db: Db, input: { workspaceId: string; account: Row; event: Row }) {
  const type = clean(input.event.type); const rawPostback = clean((input.event.postback as Row)?.data, 1000);
  const actionType = type === 'message' ? 'message' : type === 'postback' ? (rawPostback.startsWith('switch:') ? 'richmenuswitch' : 'postback') : '';
  const rawAction = actionType === 'message' ? clean((input.event.message as Row)?.text, 1000) : rawPostback;
  if (!actionType || !rawAction) return;
  const areas = (await db.prepare('SELECT pa.id area_id, pa.project_id, pa.action_text, pa.action_data FROM project_areas pa WHERE pa.workspace_id=?').bind(input.workspaceId).all<Row>()).results || [];
  const matches = areas.filter(area => actionType === 'message' ? clean(area.action_text, 1000) === rawAction : clean(area.action_data, 1000) === rawAction);
  const match = matches.length === 1 ? matches[0] : null;
  const sourceUserHash = await hashLineUser(clean(input.account.line_bot_channel_secret, 1000), clean((input.event.source as Row)?.userId, 200));
  const timestamp = Number(input.event.timestamp); const eventAt = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : now();
  await db.prepare('INSERT INTO line_action_events (id,workspace_id,line_account_id,project_id,project_area_id,line_rich_menu_id,event_type,action_type,action_fingerprint,source_user_hash,event_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(`lae_${crypto.randomUUID()}`, input.workspaceId, clean(input.account.id), match?.project_id || null, match?.area_id || null, null, actionType === 'richmenuswitch' ? 'richmenu_switch' : type, actionType, await actionFingerprint(`${actionType}:${rawAction}`), sourceUserHash, eventAt).run();
}

export async function rebuildLineIntelligenceDaily(db: Db, workspaceId: string, projectId: string, from: string, to: string) {
  await db.prepare('DELETE FROM line_intelligence_daily WHERE workspace_id=? AND project_id=? AND metric_date>=? AND metric_date<=?').bind(workspaceId, projectId, from, to).run();
  const insights = (await db.prepare('SELECT * FROM line_rich_menu_insight_daily WHERE workspace_id=? AND project_id=? AND metric_date>=? AND metric_date<=?').bind(workspaceId, projectId, from, to).all<Row>()).results || [];
  const events = (await db.prepare("SELECT substr(event_at,1,10) metric_date, project_area_id, action_type, COUNT(*) count FROM line_action_events WHERE workspace_id=? AND project_id=? AND substr(event_at,1,10)>=? AND substr(event_at,1,10)<=? GROUP BY substr(event_at,1,10), project_area_id, action_type").bind(workspaceId, projectId, from, to).all<Row>()).results || [];
  const dates = new Set<string>([...insights.map(item => clean(item.metric_date, 10)), ...events.map(item => clean(item.metric_date, 10))].filter(Boolean));
  const statements: D1PreparedStatement[] = [];
  for (const metricDate of dates) {
    const dateInsights = insights.filter(item => clean(item.metric_date, 10) === metricDate);
    const isPrivate = dateInsights.some(item => item.data_status === 'privacy_suppressed');
    const eventFor = (areaId: string, type: string) => events.filter(item => clean(item.metric_date, 10) === metricDate && clean(item.project_area_id) === areaId && clean(item.action_type) === type).reduce((total, item) => total + count(item.count), 0);
    const add = (areaId: string, rows: Row[]) => {
      const impressions = rows.filter(item => Number(item.bounds_x) === -1).reduce((total, item) => total + count(item.impression_count), 0);
      const uniqueViewers = rows.filter(item => Number(item.bounds_x) === -1).reduce((total, item) => total + count(item.impression_unique_users), 0);
      const clicks = rows.reduce((total, item) => total + count(item.click_count), 0);
      const uniqueClickers = rows.reduce((total, item) => total + count(item.click_unique_users), 0);
      const status = isPrivate ? 'privacy_suppressed' : rows.some(item => item.data_status === 'mapping_unmatched') ? 'mapping_unmatched' : rows.length ? 'available' : 'unavailable';
      statements.push(db.prepare('INSERT INTO line_intelligence_daily (workspace_id,project_id,project_area_id,metric_date,impressions,impression_unique_users,clicks,click_unique_users,message_actions,postback_actions,switch_actions,click_through_rate,data_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(workspaceId, projectId, areaId, metricDate, status === 'privacy_suppressed' ? null : impressions, status === 'privacy_suppressed' ? null : uniqueViewers, status === 'privacy_suppressed' ? null : clicks, status === 'privacy_suppressed' ? null : uniqueClickers, eventFor(areaId, 'message'), eventFor(areaId, 'postback'), eventFor(areaId, 'richmenuswitch'), status === 'privacy_suppressed' || !impressions ? null : clicks / impressions, status));
    };
    add('', dateInsights); for (const areaId of new Set(dateInsights.map(item => clean(item.project_area_id)).filter(Boolean))) add(areaId, dateInsights.filter(item => clean(item.project_area_id) === areaId));
  }
  if (statements.length) await db.batch(statements);
}

export async function syncLineRichMenuInsights(input: { db: Db; workspaceId: string; projectId: string; binding: Row; account: Row; fetcher?: typeof fetch; from: string; to: string }) {
  const token = clean(input.account.line_bot_channel_access_token, 2000); if (!token) throw new Error('LINE_ACCOUNT_TOKEN_MISSING');
  const lastSync = clean(input.binding.last_synced_at); if (lastSync && Date.now() - Date.parse(lastSync) < LINE_INSIGHT_COOLDOWN_MS) throw new Error('LINE_SYNC_COOLDOWN');
  const richMenuId = clean(input.binding.line_rich_menu_id); const fetcher = input.fetcher || fetch;
  const response = await fetcher(`https://api.line.me/v2/bot/insight/richmenu/${encodeURIComponent(richMenuId)}/daily?from=${input.from.replace(/-/g, '')}&to=${input.to.replace(/-/g, '')}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) { await input.db.prepare("UPDATE workspace_rich_menu_bindings SET status=CASE WHEN ?=404 THEN 'unavailable' ELSE status END,last_sync_status='error',last_sync_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(response.status, `LINE_${response.status}`, input.binding.id, input.workspaceId).run(); throw new Error(response.status === 404 ? 'LINE_RICH_MENU_UNAVAILABLE' : 'LINE_INSIGHT_UNAVAILABLE'); }
  const rows = parseLineDailyInsight(await response.json()); const areas = (await input.db.prepare('SELECT id,x,y,width,height FROM project_areas WHERE workspace_id=? AND project_id=?').bind(input.workspaceId, input.projectId).all<Row>()).results || []; const syncedAt = now(); const writes: D1PreparedStatement[] = [];
  for (const row of rows) {
    if (row.privacySuppressed) { writes.push(input.db.prepare("INSERT INTO line_rich_menu_insight_daily (id,workspace_id,line_account_id,project_id,line_rich_menu_id,metric_date,data_status,synced_at) VALUES (?,?,?,?,?,?, 'privacy_suppressed', ?) ON CONFLICT(workspace_id,line_rich_menu_id,metric_date,bounds_x,bounds_y,bounds_width,bounds_height) DO UPDATE SET data_status='privacy_suppressed',synced_at=excluded.synced_at,updated_at=CURRENT_TIMESTAMP").bind(`lri_${crypto.randomUUID()}`, input.workspaceId, input.account.id, input.projectId, richMenuId, row.date, syncedAt)); continue; }
    writes.push(input.db.prepare("INSERT INTO line_rich_menu_insight_daily (id,workspace_id,line_account_id,project_id,line_rich_menu_id,metric_date,impression_count,impression_unique_users,data_status,synced_at) VALUES (?,?,?,?,?,?,?,?, 'available', ?) ON CONFLICT(workspace_id,line_rich_menu_id,metric_date,bounds_x,bounds_y,bounds_width,bounds_height) DO UPDATE SET impression_count=excluded.impression_count,impression_unique_users=excluded.impression_unique_users,data_status='available',synced_at=excluded.synced_at,updated_at=CURRENT_TIMESTAMP").bind(`lri_${crypto.randomUUID()}`, input.workspaceId, input.account.id, input.projectId, richMenuId, row.date, row.impressions, row.uniqueViewers, syncedAt));
    for (const click of row.clicks) { const area = exactArea(areas, click); writes.push(input.db.prepare('INSERT INTO line_rich_menu_insight_daily (id,workspace_id,line_account_id,project_id,project_area_id,line_rich_menu_id,metric_date,click_count,click_unique_users,bounds_x,bounds_y,bounds_width,bounds_height,data_status,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,line_rich_menu_id,metric_date,bounds_x,bounds_y,bounds_width,bounds_height) DO UPDATE SET project_area_id=excluded.project_area_id,click_count=excluded.click_count,click_unique_users=excluded.click_unique_users,data_status=excluded.data_status,synced_at=excluded.synced_at,updated_at=CURRENT_TIMESTAMP').bind(`lri_${crypto.randomUUID()}`, input.workspaceId, input.account.id, input.projectId, area?.id || null, richMenuId, row.date, click.count, click.uniqueUsers, click.x, click.y, click.width, click.height, area ? 'available' : 'mapping_unmatched', syncedAt)); }
  }
  if (writes.length) await input.db.batch(writes); await rebuildLineIntelligenceDaily(input.db, input.workspaceId, input.projectId, input.from, input.to); await input.db.prepare("UPDATE workspace_rich_menu_bindings SET last_synced_at=?,last_sync_status='success',last_sync_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(syncedAt, input.binding.id, input.workspaceId).run(); return { synced: rows.length, privacySuppressed: rows.some(row => row.privacySuppressed) };
}
