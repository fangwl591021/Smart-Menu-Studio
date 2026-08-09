import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../src/line-intelligence/service.ts', import.meta.url);
const appPath = new URL('../src/index.ts', import.meta.url);
const migrationPath = new URL('../migrations/0018_line_oa_intelligence.sql', import.meta.url);

test('4F-1 stores only the scoped intelligence cache tables and indexes', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  for (const table of ['workspace_rich_menu_bindings', 'line_rich_menu_insight_daily', 'line_action_events', 'line_intelligence_daily']) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /UNIQUE \(workspace_id, line_rich_menu_id, metric_date, bounds_x, bounds_y, bounds_width, bounds_height\)/);
  assert.match(migration, /project_area_id TEXT NOT NULL DEFAULT ''/);
  assert.doesNotMatch(migration, /ALTER TABLE|DROP TABLE|DELETE FROM projects/i);
});

test('4F-1 parser and mapping use daily aggregates, exact bounds and privacy suppression', async () => {
  const service = await readFile(servicePath, 'utf8');
  assert.match(service, /parseLineDailyInsight/);
  assert.match(service, /if \(!root\.impression && !root\.clicks\).*privacySuppressed: true/s);
  assert.match(service, /count\(area\.x\) === count\(bounds\.x\).*count\(area\.height\) === count\(bounds\.height\)/s);
  assert.match(service, /rebuildLineIntelligenceDaily/);
  assert.match(service, /data_status === 'privacy_suppressed'/);
  assert.match(service, /LINE_INSIGHT_COOLDOWN_MS = 15 \* 60 \* 1000/);
});

test('4F-1 action analytics do not persist raw LINE UID, message, or postback content', async () => {
  const service = await readFile(servicePath, 'utf8');
  const insert = service.match(/INSERT INTO line_action_events[^`]+/s)?.[0] || '';
  assert.match(service, /hashLineUser/);
  assert.match(service, /actionFingerprint/);
  assert.match(insert, /action_fingerprint,source_user_hash/);
  assert.doesNotMatch(insert, /message_text|postback_data|user_id/i);
});

test('4F-1 routes are workspace scoped and never expose a global LINE token', async () => {
  const app = await readFile(appPath, 'utf8');
  const start = app.indexOf("app.get('/api/projects/:projectId/intelligence/summary'");
  const end = app.indexOf("app.post('/api/projects/:projectId/publish'", start);
  const routes = app.slice(start, end);
  assert.match(routes, /workspace_id=\?/);
  assert.match(routes, /requireRole\(c, 'admin'\)/);
  assert.match(routes, /requireSystemAdmin\(c\)/);
  assert.match(routes, /line_bot_channel_access_token/);
  assert.doesNotMatch(routes, /LINE_CHANNEL_ACCESS_TOKEN/);
  assert.match(app, /recordLineActionEvent\(c\.env\.smart_menu_db, \{ workspaceId, account, event \}\)\.catch/);
});

test('4F-1 has no Publish Engine, Gemini, or direct frontend LINE API integration', async () => {
  const [service, frontend] = await Promise.all([readFile(servicePath, 'utf8'), readFile(new URL('../../frontend/src/components/LineIntelligencePanel.jsx', import.meta.url), 'utf8')]);
  assert.doesNotMatch(service, /Gemini|requestGemini|ai_usage_ledger|LINE_CHANNEL_ACCESS_TOKEN/);
  assert.doesNotMatch(frontend, /api\.line\.me|line_bot_channel_access_token|LINE_CHANNEL_ACCESS_TOKEN/);
  assert.match(frontend, /intelligence\/summary/);
  assert.match(frontend, /intelligence\/daily/);
});
