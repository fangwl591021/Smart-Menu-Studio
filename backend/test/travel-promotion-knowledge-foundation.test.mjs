import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TRAVEL_PROMOTION_EXTRACT_SCHEMA,
  TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION,
  extractionToPromotionDraft,
  parsePromotionAiPayload,
  validatePromotionDraft,
} from '../src/travel/promotion.ts';

const file = relative => new URL(relative, import.meta.url);
const migration = await readFile(file('../migrations/0055_travel_promotion_knowledge.sql'), 'utf8');
const extractionMigration = await readFile(file('../migrations/0058_travel_promotion_extraction_json.sql'), 'utf8');
const promotion = await readFile(file('../src/travel/promotion.ts'), 'utf8');
const routes = await readFile(file('../src/travel/promotion-routes.ts'), 'utf8');
const routeRegistry = await readFile(file('../src/travel/routes.ts'), 'utf8');
const aiUsage = await readFile(file('../src/ai/usage.ts'), 'utf8');

const complete = overrides => ({
  title: '北海道五日', summary: '冬季旅遊方案', destination: '北海道', region: '日本', days: 5,
  departureLocation: '桃園機場', dateTexts: ['2027 年 1 月'], pricingTexts: ['依 DM 所示'],
  promotionTerms: ['實際內容以合約為準'], highlights: ['雪景'], keywords: ['北海道', '雪景'],
  faq: [{ question: '何時出發？', answer: '請參考 DM 日期。' }], replyTemplate: '歡迎洽詢。',
  socialCopy: '北海道冬季旅行', ...overrides,
});
const payload = value => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });
const extraction = overrides => ({
  title: '北海道賞楓', subtitle: '秋季限定', brand: '旅行社', theme: '賞楓', departurePlace: '台北',
  country: '日本', region: '北海道', travelDays: 5, departureMonthText: '10 月', departurePatternText: '每週二出發',
  price: { amount: 39900, currency: 'TWD', displayText: '每人 39,900 元起', priceNote: '含稅' },
  promotionHighlights: ['賞楓名所'], itinerarySummary: ['第一天抵達札幌'],
  transportation: { airline: '中華航空', outbound: { departureTime: '08:00', departureAirportOrCity: '桃園', arrivalTime: '12:00', arrivalAirportOrCity: '新千歲' }, return: { departureTime: '13:00', departureAirportOrCity: '新千歲', arrivalTime: '16:30', arrivalAirportOrCity: '桃園' }, notes: '' },
  contact: { phones: ['02-12345678'], lineId: '@travel', address: '台北市', licenses: ['旅行業執照 123'] },
  social: { instagram: '@travel', facebook: 'travel' }, rawOcrText: '北海道賞楓 每人 39,900 元起', warnings: [],
  confidence: { title: 0.98, price: 0.95, transportation: 0.8, contact: 0.9, social: 0.7 },
  ...overrides,
});

test('0055 is additive, workspace scoped, and creates only the four approved entities', () => {
  for (const table of ['travel_promotion_documents', 'travel_promotion_source_assets', 'travel_promotion_versions', 'travel_promotion_knowledge_entries']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /FOREIGN KEY\(workspace_id\)/);
  assert.match(migration, /FOREIGN KEY\(workspace_id,promotion_document_id,version_no\)/);
  assert.match(migration, /travel_promotion_source_asset_scope_insert[\s\S]*a\.workspace_id=NEW\.workspace_id/);
  assert.doesNotMatch(migration, /\b(?:DROP|ALTER|DELETE FROM|INSERT INTO\s+(?:travel_itineraries|travel_departures|commerce_products))\b/i);
  assert.doesNotMatch(migration, /\b(?:passport|national_id|line_user|uid_hash|provider_payload)\b/i);
  const sourceAssetTable = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS travel_promotion_source_assets'), migration.indexOf('CREATE INDEX IF NOT EXISTS idx_travel_promotion_source_assets_version'));
  assert.doesNotMatch(sourceAssetTable, /\bstorage_key\b/i);
});

test('0058 persists normalized extraction JSON without changing promotion lifecycle', () => {
  assert.match(extractionMigration, /ALTER TABLE travel_promotion_versions/);
  assert.match(extractionMigration, /ADD COLUMN extraction_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(extractionMigration, /CHECK\(json_valid\(extraction_json\)\)/);
  assert.doesNotMatch(extractionMigration, /status|version_status|ACTIVE|APPROVED/i);
});

test('approved versions, approved evidence, and knowledge entries are immutable with sequence protection', () => {
  assert.match(migration, /travel_promotion_version_sequence_guard[\s\S]*TRAVEL_PROMOTION_VERSION_CONFLICT/);
  assert.match(migration, /travel_promotion_versions_approved_no_update[\s\S]*TRAVEL_PROMOTION_APPROVED_VERSION_IMMUTABLE/);
  assert.match(migration, /travel_promotion_versions_no_delete[\s\S]*TRAVEL_PROMOTION_VERSION_IMMUTABLE/);
  assert.match(migration, /travel_promotion_source_assets_approved_no_update[\s\S]*TRAVEL_PROMOTION_SOURCE_EVIDENCE_IMMUTABLE/);
  assert.match(migration, /travel_promotion_knowledge_entries_no_update[\s\S]*travel_promotion_knowledge_entries_no_delete/);
  assert.match(migration, /travel_promotion_documents_no_delete[\s\S]*TRAVEL_PROMOTION_ARCHIVE_REQUIRED/);
});

test('strict extraction schema normalizes the fixed DM JSON and preserves a compatible draft projection', () => {
  assert.equal(TRAVEL_PROMOTION_EXTRACT_SCHEMA.additionalProperties, false);
  assert.equal(TRAVEL_PROMOTION_EXTRACT_SCHEMA.properties.title.maxLength, 120);
  assert.equal(TRAVEL_PROMOTION_EXTRACT_SCHEMA.properties.promotionHighlights.maxItems, 20);
  assert.equal(TRAVEL_PROMOTION_EXTRACT_SCHEMA.properties.itinerarySummary.maxItems, 30);
  assert.deepEqual(TRAVEL_PROMOTION_EXTRACT_SCHEMA.properties.price.properties.currency.enum, ['TWD']);
  assert.deepEqual(parsePromotionAiPayload(payload(extraction())), extraction());
  assert.equal(extractionToPromotionDraft(extraction()).pricingTexts[0], '每人 39,900 元起');
  assert.throws(() => parsePromotionAiPayload(payload(extraction({ injected: true }))), /TRAVEL_PROMOTION_AI_OUTPUT_INVALID/);
  assert.throws(() => parsePromotionAiPayload(payload(extraction({ price: { amount: 1, currency: 'USD', displayText: '$1', priceNote: '' } }))), /TRAVEL_PROMOTION_AI_OUTPUT_INVALID/);
  assert.throws(() => parsePromotionAiPayload({ candidates: [{ content: { parts: [{ text: '{bad' }] } }] }), /TRAVEL_PROMOTION_AI_OUTPUT_INVALID/);
  assert.throws(() => validatePromotionDraft(complete({ title: 'x'.repeat(121) })), /TRAVEL_PROMOTION_INPUT_INVALID/);
});

test('prompt injection is isolated and unknown image facts remain empty-capable', () => {
  assert.match(TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION, /untrusted document content/i);
  assert.match(TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION, /DM images as the primary source/i);
  assert.match(TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION, /Supplemental source text is secondary/i);
  assert.match(TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION, /Never invent dates, prices, capacity, remaining seats/i);
  assert.match(TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION, /empty strings, empty arrays, or null/i);
  const empty = extraction({ country: '', region: '', travelDays: null, promotionHighlights: [], itinerarySummary: [], rawOcrText: '' });
  assert.deepEqual(parsePromotionAiPayload(payload(empty)), empty);
  assert.throws(() => validatePromotionDraft(complete({ summary: '護照號碼 A123456789' })), /TRAVEL_PROMOTION_HIGH_RISK_CONTENT/);
});
test('Tenant routes require viewer reads and admin mutations, with AI entitlement only on extract', () => {
  assert.match(routeRegistry, /registerTravelPromotionRoutes\(app,deps,fail\)/);
  for (const route of ["app.get('/api/travel/promotions'", "app.get('/api/travel/promotions/:safePromotionReference'"]) {
    const start = routes.indexOf(route); assert.ok(start >= 0); assert.match(routes.slice(start, start + 250), /requireRole\(c,'viewer'\)/);
  }
  for (const route of ["app.post('/api/travel/promotions'", "app.patch('/api/travel/promotions/:safePromotionReference/draft'", "app.post('/api/travel/promotions/:safePromotionReference/extract'", "app.post('/api/travel/promotions/:safePromotionReference/activate'", "app.post('/api/travel/promotions/:safePromotionReference/archive'"]) {
    const start = routes.indexOf(route); assert.ok(start >= 0); assert.match(routes.slice(start, start + 300), /requireRole\(c,'admin'\)/);
  }
  assert.equal((routes.match(/moduleKey:'AI'/g) || []).length, 1);
  assert.match(routes, /TRAVEL_PROMOTION_AI_DISABLED/);
  assert.doesNotMatch(routes.slice(0, routes.indexOf("app.post('/api/travel/promotions/:safePromotionReference/extract'")), /moduleKey:'AI'/);
});

test('AI extraction uses the platform provider and canonical metering without auto activation', () => {
  assert.match(aiUsage, /'travel_promotion_extract'/);
  assert.match(routes, /executeMeteredAiCall\(/);
  assert.match(routes, /featureCode:'travel_promotion_extract'/);
  assert.match(routes, /provider:'google',model:GEMINI_MODEL/);
  assert.match(routes, /requestGeminiContent\(/);
  assert.match(routes, /extractGeminiUsageMetadata\(payload\)/);
  const extract = routes.slice(routes.indexOf("app.post('/api/travel/promotions/:safePromotionReference/extract'"), routes.indexOf("app.post('/api/travel/promotions/:safePromotionReference/activate'"));
  assert.doesNotMatch(extract, /activatePromotion|travel_promotion_knowledge_entries/);
  assert.match(extract, /inline_data/);
  assert.ok(extract.indexOf('inline_data') < extract.indexOf('Supplemental untrusted source text'));
  assert.match(extract, /saveExtractedDraft[\s\S]*draft,extraction/);
  assert.match(promotion, /saveExtractedDraft[\s\S]*version_status='DRAFT'/);
  assert.doesNotMatch(routes, /tenant.*(?:api.?key|gemini)/i);
});

test('manual draft, source revision guard, next draft, activation batch, and deterministic entries are explicit', () => {
  assert.match(promotion, /updatePromotionDraft[\s\S]*expectedVersionNo[\s\S]*expectedSourceRevision/);
  assert.match(promotion, /ensureDraft[\s\S]*version_status === 'DRAFT'[\s\S]*const next = Number\(current\.version_no\) \+ 1/);
  assert.match(promotion, /extractionSource[\s\S]*expectedSourceRevision[\s\S]*TRAVEL_PROMOTION_VERSION_CONFLICT/);
  assert.match(promotion, /saveExtractedDraft[\s\S]*version_status='DRAFT' AND source_revision=\?/);
  const activation = promotion.slice(promotion.indexOf('export async function activatePromotion'), promotion.indexOf('export async function archivePromotion'));
  assert.match(activation, /entry_type/);
  assert.match(activation, /await db\.batch\(\[[\s\S]*version_status='APPROVED'[\s\S]*status='ACTIVE'/);
  assert.match(promotion, /'MAIN'/);
  assert.match(promotion, /draft\.faq\.map/);
  assert.match(promotion, /searchText\(draft/);
});

test('safe projections expose references and URLs but not workspace, internal IDs, R2 keys, or provider payloads', () => {
  const projection = promotion.slice(promotion.indexOf('async function publicPromotion'), promotion.indexOf('export async function createPromotion'));
  assert.match(projection, /safePromotionReference/);
  assert.match(projection, /safeAssetReference/);
  assert.match(projection, /assetUrl/);
  assert.doesNotMatch(projection, /workspaceId|documentId|assetInternalId|storage_key|provider/);
});

test('promotion foundation cannot mutate formal Travel, Commerce, Campaign, CRM, economy, or LINE domains', () => {
  const combined = `${promotion}\n${routes}`;
  for (const forbidden of [
    'INSERT INTO travel_itineraries', 'UPDATE travel_itineraries', 'INSERT INTO travel_departures',
    'UPDATE travel_departures', 'INSERT INTO commerce_products', 'INSERT INTO commerce_orders',
    'INSERT INTO travel_booking_extensions', 'INSERT INTO commerce_payment', 'INSERT INTO campaigns',
    'INSERT INTO crm_', 'INSERT INTO member_point', 'INSERT INTO commission_', 'INSERT INTO settlement',
    '/v2/bot/message', 'pushMessage', 'multicast', 'narrowcast', 'broadcast',
  ]) assert.equal(combined.includes(forbidden), false, forbidden);
  assert.doesNotMatch(combined, /TravelKeeper|embedding|vector|pdf/i);
});
