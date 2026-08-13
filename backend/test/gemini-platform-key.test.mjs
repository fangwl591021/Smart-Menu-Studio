import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backendIndex = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const geminiAdapter = await readFile(new URL('../src/gemini.ts', import.meta.url), 'utf8');
const responsesAdapter = await readFile(new URL('../src/openai-responses.ts', import.meta.url), 'utf8');
const frontendApp = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const frontendWorker = await readFile(new URL('../../frontend/src/index.ts', import.meta.url), 'utf8');
const wranglerConfig = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

const detectLayoutRoute = backendIndex.slice(
  backendIndex.indexOf("app.post('/api/detect-layout'"),
  backendIndex.indexOf("app.post('/api/templates/upload-image'"),
);

test('AI credentials and service binding remain server-side Worker authorities', () => {
  assert.match(backendIndex, /MLM_WORKER\?:\s*Fetcher/);
  assert.match(backendIndex, /OPENAI_API_KEY\?:\s*string/);
  assert.match(detectLayoutRoute, /c\.env\.MLM_WORKER/);
  assert.match(detectLayoutRoute, /c\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(frontendApp, /OPENAI_API_KEY|GEMINI_API_KEY|google[_-]?api[_-]?key|gemini[_-]?api[_-]?key/i);
  assert.doesNotMatch(frontendWorker, /OPENAI_API_KEY|GEMINI_API_KEY|api\.openai\.com|generativelanguage\.googleapis\.com/i);
});

test('missing dual-provider configuration returns a stable diagnostic and safe Tenant message', () => {
  assert.match(geminiAdapter, /AI_PROVIDER_NOT_CONFIGURED = 'AI_PROVIDER_NOT_CONFIGURED'/);
  assert.match(geminiAdapter, /AI 服務目前尚未完成平台設定，請聯絡系統管理員。/);
  assert.match(detectLayoutRoute, /!c\.env\.MLM_WORKER && !c\.env\.OPENAI_API_KEY/);
  assert.match(detectLayoutRoute, /geminiProviderNotConfiguredResponse\(\), 503/);
});

test('Tenant requests cannot supply or override platform AI credentials', () => {
  assert.doesNotMatch(detectLayoutRoute, /body\.(?:apiKey|openAiApiKey|geminiApiKey|OPENAI_API_KEY|GEMINI_API_KEY)/);
  assert.doesNotMatch(detectLayoutRoute, /c\.req\.(?:header|query)\([^)]*(?:openai|gemini|api.?key)/i);
});

test('frontend exposes no platform AI credential field', () => {
  assert.doesNotMatch(frontendApp, /name=["'](?:openai|gemini|google)?[_-]?api[_-]?key["']/i);
  assert.doesNotMatch(frontendApp, /placeholder=["'][^"']*(?:OpenAI|Gemini|API Key)/i);
  assert.doesNotMatch(frontendWorker, /app\.post\('\/api\/detect-layout'/);
});

test('credential is not returned, logged, stored, or committed as Wrangler plaintext', () => {
  assert.doesNotMatch(detectLayoutRoute, /c\.json\([^\n]*c\.env\.(?:OPENAI_API_KEY|GEMINI_API_KEY)/);
  assert.doesNotMatch(detectLayoutRoute, /console\.(?:log|error)\([^\n]*c\.env\.(?:OPENAI_API_KEY|GEMINI_API_KEY)/);
  assert.doesNotMatch(backendIndex, /(?:INSERT|UPDATE)[^\n]*(?:OPENAI_API_KEY|GEMINI_API_KEY|openai_api_key|gemini_api_key)/i);
  assert.doesNotMatch(wranglerConfig, /OPENAI_API_KEY|GEMINI_API_KEY/);
});

test('Rich Menu image analysis keeps metering and internal-first dual-provider routing', () => {
  assert.match(detectLayoutRoute, /executeMeteredAiCall\(/);
  assert.match(detectLayoutRoute, /featureCode:\s*'rich_menu_image_analysis'/);
  assert.match(detectLayoutRoute, /operationCode:\s*'detect_layout'/);
  assert.match(detectLayoutRoute, /provider:\s*'openai'/);
  assert.match(detectLayoutRoute, /requestOpenAiResponses\(\{/);
  assert.match(detectLayoutRoute, /type:\s*'input_image'/);
  assert.match(responsesAdapter, /options\.service\.fetch\('https:\/\/mlm\.internal\/api\/internal\/ai\/responses'/);
  assert.match(responsesAdapter, /fetcher\('https:\/\/api\.openai\.com\/v1\/responses'/);
  assert.ok(responsesAdapter.indexOf('if (options.service)') < responsesAdapter.indexOf('if (!options.apiKey)'));
});

test('provider adapters keep keys only in server-side headers and request bodies exclude them', () => {
  assert.match(geminiAdapter, /'x-goog-api-key': options\.apiKey/);
  assert.match(responsesAdapter, /Authorization: `Bearer \$\{options\.apiKey\}`/);
  assert.match(responsesAdapter, /body: JSON\.stringify\(\{ request: options\.body \}\)/);
  assert.doesNotMatch(responsesAdapter, /JSON\.stringify\([^)]*apiKey/);
});
