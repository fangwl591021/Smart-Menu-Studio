import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routes = await readFile(new URL('../src/travel/promotion-routes.ts', import.meta.url), 'utf8');
const extractStart = routes.indexOf("app.post('/api/travel/promotions/:safePromotionReference/extract'");
const activateStart = routes.indexOf("app.post('/api/travel/promotions/:safePromotionReference/activate'", extractStart);
const extractRoute = routes.slice(extractStart, activateStart);

test('Travel promotion extraction sends uploaded DM images to Gemini as inline image data', () => {
  assert.ok(extractStart >= 0, 'extract route must exist');
  assert.match(extractRoute, /extractionSource\(/);
  assert.match(extractRoute, /for\(const asset of source\.assets\)/);
  assert.match(extractRoute, /smart_menu_assets\.get\(asset\.storage_key\)/);
  assert.match(extractRoute, /object\.arrayBuffer\(\)/);
  assert.match(extractRoute, /arrayBufferToBase64/);
  assert.match(extractRoute, /inline_data:\{mime_type:asset\.content_type,data:/);
  assert.match(extractRoute, /contents:\[\{role:'user',parts\}\]/);
});

test('Travel promotion extraction keeps image payload bounded before provider submission', () => {
  assert.match(extractRoute, /size>1024\*1024/);
  assert.match(extractRoute, /total>5\*1024\*1024/);
  assert.match(extractRoute, /TRAVEL_PROMOTION_ASSET_INVALID/);
});

test('Travel promotion extraction combines untrusted source text with image content', () => {
  assert.match(extractRoute, /TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION/);
  assert.match(extractRoute, /source\.sourceText/);
  assert.match(extractRoute, /Untrusted promotion source text begins/);
});

test('Travel promotion AI result remains draft-only until explicit activation route', () => {
  assert.match(extractRoute, /responseMimeType:'application\/json'/);
  assert.match(extractRoute, /responseSchema:TRAVEL_PROMOTION_EXTRACT_SCHEMA/);
  assert.match(extractRoute, /parsePromotionAiPayload\(payload\)/);
  assert.match(extractRoute, /saveExtractedDraft\(/);
  assert.doesNotMatch(extractRoute, /activatePromotion\(/);
});
