import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/0021_conversion_sources.sql', import.meta.url), 'utf8');
const baseMigration = await readFile(new URL('../migrations/0019_conversion_journey_intelligence.sql', import.meta.url), 'utf8');
const registry = await readFile(new URL('../src/journey/conversion-sources.ts', import.meta.url), 'utf8');
const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const journeyUi = await readFile(new URL('../../frontend/src/components/JourneyIntelligencePanel.jsx', import.meta.url), 'utf8');
const keyUi = await readFile(new URL('../../frontend/src/components/ConversionApiKeyPanel.jsx', import.meta.url), 'utf8');

test('0021 is additive and conversion_source leaves existing rows NULL', () => {
  assert.match(migration, /ALTER TABLE line_conversion_events ADD COLUMN conversion_source TEXT/);
  assert.match(migration, /idx_conversion_source_health/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|DROP|CREATE TABLE)\b/i);
  assert.doesNotMatch(migration, /DEFAULT\s+['"]?(?:CUSTOM|UNKNOWN|PURCHASE)/i);
});

test('source registry contains the five approved server-to-server sources', () => {
  for (const code of ['LIFF_REGISTRATION', 'SIGNUP', 'BOOKING', 'PURCHASE', 'CUSTOM']) assert.match(registry, new RegExp(code));
  assert.match(registry, /integrationMode:\s*'server_to_server'/);
  assert.match(registry, /allowedConversionTypes/);
});

test('ingestion requires registry validation and preserves source/type separation', () => {
  assert.match(index, /conversionSource\(text\(body\.sourceCode\), text\(body\.conversionType\)\)/);
  assert.match(index, /INVALID_CONVERSION_SOURCE/);
  assert.match(index, /conversion_source/);
  assert.match(index, /VALUE_NOT_SUPPORTED_FOR_SOURCE/);
});

test('unknown source and invalid source/type combinations are rejected, not coerced to CUSTOM', () => {
  assert.match(index, /INVALID_CONVERSION_SOURCE_TYPE/);
  assert.doesNotMatch(index, /sourceCode[^\n]*\|\|[^\n]*CUSTOM/);
});

test('purchase value policy accepts integer zero and rejects negative/float', () => {
  assert.match(index, /Number\.isInteger\(value\)/);
  assert.match(index, /value < 0/);
  assert.match(index, /INVALID_CURRENCY/);
});

test('metadata sanitizer drops nested values and sensitive primitive keys', () => {
  assert.match(registry, /Array\.isArray\(value\)/);
  assert.match(registry, /sensitive/);
  for (const key of ['token', 'secret', 'password', 'authorization', 'cookie', 'uid', 'email', 'phone', 'address']) assert.match(registry, new RegExp(key));
  assert.match(index, /sanitizeConversionMetadata\(body\.metadata\)/);
});

test('attribution precedence is unchanged by sourceCode', () => {
  const route = index.slice(index.indexOf("app.post('/api/intelligence/conversions'"), index.indexOf("app.get('/api/projects/:projectId/intelligence/journey'"));
  assert.match(route, /lastObservedTouch\(sessionRows, occurredAt\)/);
  assert.match(route, /attributionToken/);
  assert.match(route, /const mapped = tracked[\s\S]*projectAreaId[\s\S]*touch/);
});

test('workspace API key remains the only conversion ingestion credential', () => {
  const route = index.slice(index.indexOf("app.post('/api/intelligence/conversions'"), index.indexOf("app.get('/api/projects/:projectId/intelligence/journey'"));
  assert.match(route, /authenticateConversionApiKey/);
  assert.match(route, /const workspaceId = credential\.workspaceId/);
  assert.doesNotMatch(route, /body\.workspaceId/);
});

test('external event idempotency is workspace scoped and source changes cannot duplicate', () => {
  assert.match(index, /workspace_id=\? AND external_event_id=\?/);
  assert.match(baseMigration, /UNIQUE\(workspace_id, external_event_id\)/);
});

test('tenant source health and source breakdown are implemented', () => {
  assert.match(index, /\/api\/intelligence\/conversions\/sources\/health/);
  assert.match(index, /conversionSourceHealthRows/);
  assert.match(index, /sourceBreakdown/);
  assert.match(journeyUi, /Conversion Source/);
  assert.match(journeyUi, /Legacy \/ 未記錄來源/);
});

test('source health exposes deterministic ACTIVE, NO_EVENTS and STALE states', () => {
  assert.match(registry, /'NO_EVENTS'/);
  assert.match(registry, /'STALE'/);
  assert.match(registry, /'ACTIVE'/);
  assert.match(registry, /'NOT_CONFIGURED'/);
  assert.match(index, /\/api\/system\/conversion-source-health/);
});

test('settings UI documents sourceCode without a real secret', () => {
  assert.match(keyUi, /SourceCode contract/);
  assert.match(keyUi, /smc_live_&lt;prefix&gt;_&lt;secret&gt;/);
  assert.doesNotMatch(keyUi, /smc_live_[a-f0-9]{12}_[A-Za-z0-9_-]{48}/i);
});
