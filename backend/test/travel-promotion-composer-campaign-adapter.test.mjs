import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  composeTravelPromotions,
  validatePromotionCompositionRequest,
  validateStructuredTravelEnvelope,
} from '../src/travel/promotion-composer.ts';

const file = relative => new URL(relative, import.meta.url);
const [migration, composerSource, campaignSource, executionSource, lineSource, routesSource] = await Promise.all([
  readFile(file('../migrations/0057_campaign_structured_content_extension.sql'), 'utf8'),
  readFile(file('../src/travel/promotion-composer.ts'), 'utf8'),
  readFile(file('../src/campaign/campaigns.ts'), 'utf8'),
  readFile(file('../src/campaign/executions.ts'), 'utf8'),
  readFile(file('../src/campaign/line-push.ts'), 'utf8'),
  readFile(file('../src/campaign/campaign-routes.ts'), 'utf8'),
]);

const ref = number => `promotion_0000000${number}-0000-1000-8000-00000000000${number}`;
const body = (format, count) => ({ format, safePromotionReferences: Array.from({ length: count }, (_, index) => ref(index + 1)) });

test('composer enforces all five exact selection count contracts', () => {
  for (const [format, count] of [['SINGLE',1],['CAROUSEL',2],['LIST',2],['TRAVEL_4_GRID',4],['TRAVEL_6_GRID',6]]) {
    assert.equal(validatePromotionCompositionRequest(body(format, count)).format, format);
  }
  for (const invalid of [body('SINGLE',2),body('CAROUSEL',1),body('LIST',11),body('TRAVEL_4_GRID',3),body('TRAVEL_6_GRID',5)]) {
    assert.throws(() => validatePromotionCompositionRequest(invalid), /TRAVEL_PROMOTION_COMPOSE_COUNT_INVALID/);
  }
});

test('composer accepts only safe references and bounded options, never raw Flex or URI authority', () => {
  assert.throws(() => validatePromotionCompositionRequest({ ...body('SINGLE',1), flex: {} }), /TRAVEL_PROMOTION_COMPOSITION_INVALID/);
  assert.throws(() => validatePromotionCompositionRequest({ ...body('SINGLE',1), safePromotionReferences: ['internal-db-id'] }), /TRAVEL_PROMOTION_SELECTION_INVALID/);
  assert.throws(() => validatePromotionCompositionRequest({ ...body('SINGLE',1), options: { ctaUri: 'javascript:alert(1)' } }), /TRAVEL_PROMOTION_OPTIONS_INVALID/);
  assert.throws(() => validatePromotionCompositionRequest({ ...body('SINGLE',1), options: { headline: 'x'.repeat(81) } }), /TRAVEL_PROMOTION_OPTIONS_INVALID/);
});

test('trusted composer preserves input order and returns TEXT fallback plus one validated LINE message', async () => {
  const rows = [2,1].map(number => ({ id: `doc-${number}`, public_ref: ref(number), display_label: `旅遊 ${number}`, active_version_no: 1,
    title: `行程 ${number}`, summary: `摘要 ${number}`, date_texts_json: '[]', pricing_texts_json: '[]', asset_id: 'asset-safe-' + number }));
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() { return { results: rows }; },
            async first() { return sql.includes('travel_promotion_formal_links') ? null : null; },
          };
        },
      };
    },
  };
  const result = await composeTravelPromotions(db, {
    workspaceId: 'ws-1', body: { format: 'CAROUSEL', safePromotionReferences: [ref(1),ref(2)] },
    publicBaseUrl: 'https://example.com', now: new Date('2026-08-12T00:00:00.000Z'),
  });
  assert.match(result.fallbackText, /1\. 行程 1[^]*2\. 行程 2/);
  assert.equal(result.structuredContent.messages.length, 1);
  assert.deepEqual(result.structuredContent.selectedPromotions.map(item => item.safePromotionReference), [ref(1),ref(2)]);
  assert.doesNotMatch(result.payloadJson, /storage_key|lineUserId|workspaceId|campaignId/);
  assert.match(result.payloadJson, /https:\/\/example\.com\/api\/assets\/asset-safe-1/);
});

test('structured envelope rejects unknown fields, malformed selection, and oversized payload', () => {
  const valid = {
    schemaVersion: 1, messageType: 'TRAVEL_PROMOTION', format: 'SINGLE',
    messages: [{ type: 'flex', altText: '旅遊精選', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [{ type: 'text', text: '旅遊精選', size: 'sm', wrap: true }] } } }],
    selectedPromotions: [{ safePromotionReference: ref(1), safeDepartureReference: null, bookableAtCompose: false }],
  };
  assert.equal(validateStructuredTravelEnvelope(valid).envelope.format, 'SINGLE');
  assert.throws(() => validateStructuredTravelEnvelope({ ...valid, rawFlexJson: {} }), /CAMPAIGN_STRUCTURED_CONTENT_INVALID/);
  assert.throws(() => validateStructuredTravelEnvelope({ ...valid, selectedPromotions: [{ ...valid.selectedPromotions[0], internalId: 'x' }] }), /CAMPAIGN_STRUCTURED_CONTENT_INVALID/);
  const unsafeUri = structuredClone(valid);
  unsafeUri.messages[0].contents = { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
    { type: 'button', style: 'primary', action: { type: 'uri', label: '查看', uri: 'javascript:alert(1)' } },
  ] } };
  assert.throws(() => validateStructuredTravelEnvelope(unsafeUri), /CAMPAIGN_STRUCTURED_CONTENT_INVALID/);
  assert.throws(() => validateStructuredTravelEnvelope({ ...valid, messages: [{ ...valid.messages[0], altText: 'x'.repeat(400), contents: { type: 'bubble', body: { text: 'x'.repeat(51000) } } }] }), /TRAVEL_PROMOTION_COMPOSE_PAYLOAD_TOO_LARGE/);
});

test('0057 is additive, version-scoped, fallback-bound, and immutable', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS campaign_structured_content_extensions/);
  assert.match(migration, /UNIQUE\(workspace_id,campaign_id,content_version_no\)/);
  assert.match(migration, /REFERENCES campaign_content_versions\(workspace_id,campaign_id,version_no\)/);
  assert.match(migration, /v\.content_type='TEXT'/);
  assert.match(migration, /json_extract\(v\.payload_json,'\$\.text'\)=NEW\.fallback_text/);
  assert.match(migration, /BEFORE UPDATE ON campaign_structured_content_extensions/);
  assert.match(migration, /BEFORE DELETE ON campaign_structured_content_extensions/);
  assert.doesNotMatch(migration, /\b(?:ALTER TABLE|DROP TABLE|UPDATE\s+(?!ON)|DELETE FROM|INSERT INTO\s+(?:campaigns|travel_promotion_documents))\b/i);
});

test('Campaign adapter atomically stores TEXT fallback and extension while preserving old TEXT contract', () => {
  assert.match(campaignSource, /contentType === 'TRAVEL_PROMOTION'/);
  assert.match(campaignSource, /validateCampaignContent\(\{ contentType: 'TEXT', text: composed\.fallbackText \}\)/);
  assert.match(campaignSource, /db\.batch\(statements\)/);
  assert.match(campaignSource, /INSERT INTO campaign_structured_content_extensions/);
  assert.match(campaignSource, /LEFT JOIN campaign_structured_content_extensions/);
  assert.match(routesSource, /moduleKey: 'CAMPAIGN'/);
  assert.match(routesSource, /moduleKey: 'TRAVEL'/);
});

test('execution binds exact frozen extension and preserves the existing delivery loop and push authority', () => {
  assert.match(executionSource, /prepared_content_version_no/);
  assert.match(executionSource, /FROM campaign_structured_content_extensions/);
  assert.match(executionSource, /messages: input\.context\.messages/);
  assert.match(executionSource, /sendLineMessagesPush/);
  assert.match(executionSource, /provider_retry_key/);
  assert.match(executionSource, /resumeCampaignExecution/);
  assert.match(executionSource, /cancelCampaignExecution/);
  assert.doesNotMatch(executionSource, /travel_promotion_documents|composeTravelPromotions|requestGeminiContent/);
  assert.match(lineSource, /https:\/\/api\.line\.me\/v2\/bot\/message\/push/);
  assert.doesNotMatch(lineSource, /broadcast|multicast|narrowcast/);
});

test('fresh composition and frozen execution keep live safety distinct without payload rewriting', () => {
  assert.match(composerSource, /DM 快照｜/);
  assert.match(composerSource, /即時資訊｜/);
  assert.match(composerSource, /live\.departure\.status === 'CANCELLED'/);
  assert.match(composerSource, /live\.soldOut/);
  assert.match(executionSource, /CAMPAIGN_STRUCTURED_TRAVEL_NOT_AVAILABLE/);
  assert.match(executionSource, /SELECT d\.status,d\.booking_opens_at/);
  assert.doesNotMatch(executionSource, /UPDATE\s+campaign_structured_content_extensions/i);
});
