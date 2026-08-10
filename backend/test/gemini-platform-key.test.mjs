import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backendIndex = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const geminiAdapter = await readFile(new URL('../src/gemini.ts', import.meta.url), 'utf8');
const frontendApp = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const frontendWorker = await readFile(new URL('../../frontend/src/index.ts', import.meta.url), 'utf8');
const wranglerConfig = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

const detectLayoutRoute = backendIndex.slice(
  backendIndex.indexOf("app.post('/api/detect-layout'"),
  backendIndex.indexOf("app.post('/api/templates/upload-image'"),
);

test('Gemini credential remains a server-side Worker binding', () => {
  assert.match(backendIndex, /GEMINI_API_KEY:\s*string/);
  assert.match(detectLayoutRoute, /c\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(frontendApp, /GEMINI_API_KEY|google[_-]?api[_-]?key|gemini[_-]?api[_-]?key/i);
  assert.doesNotMatch(frontendWorker, /GEMINI_API_KEY|generativelanguage\.googleapis\.com|x-goog-api-key/);
});

test('missing provider configuration returns a stable diagnostic and safe Tenant message', () => {
  assert.match(geminiAdapter, /AI_PROVIDER_NOT_CONFIGURED = 'AI_PROVIDER_NOT_CONFIGURED'/);
  assert.match(geminiAdapter, /AI 服務目前尚未完成平台設定，請聯絡系統管理員。/);
  assert.match(detectLayoutRoute, /geminiProviderNotConfiguredResponse\(\), 503/);
  assert.doesNotMatch(detectLayoutRoute, /GEMINI_API_KEY 尚未設定/);
});

test('Tenant requests cannot supply or override the Gemini credential', () => {
  assert.doesNotMatch(detectLayoutRoute, /body\.(?:apiKey|geminiApiKey|GEMINI_API_KEY)/);
  assert.doesNotMatch(detectLayoutRoute, /c\.req\.(?:header|query)\([^)]*(?:gemini|api.?key)/i);
});

test('LINE account configuration cannot supply or persist the Gemini credential', () => {
  assert.doesNotMatch(backendIndex, /line[_-]?account[^\n]{0,120}(?:gemini|api[_-]?key)/i);
  assert.doesNotMatch(backendIndex, /(?:gemini|api[_-]?key)[^\n]{0,120}line[_-]?account/i);
});

test('frontend exposes no Gemini credential field', () => {
  assert.doesNotMatch(frontendApp, /name=["'](?:gemini|google)?[_-]?api[_-]?key["']/i);
  assert.doesNotMatch(frontendApp, /placeholder=["'][^"']*(?:Gemini|API Key)/i);
  assert.doesNotMatch(frontendWorker, /app\.post\('\/api\/detect-layout'/);
});

test('credential is not returned, logged, stored, or committed as Wrangler plaintext', () => {
  assert.doesNotMatch(detectLayoutRoute, /c\.json\([^\n]*c\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(detectLayoutRoute, /console\.(?:log|error)\([^\n]*c\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(backendIndex, /(?:INSERT|UPDATE)[^\n]*(?:GEMINI_API_KEY|gemini_api_key)/i);
  assert.doesNotMatch(wranglerConfig, /GEMINI_API_KEY/);
});

test('Rich Menu image analysis keeps plan and usage metering boundaries', () => {
  assert.match(detectLayoutRoute, /executeMeteredAiCall\(/);
  assert.match(detectLayoutRoute, /workspaceId:\s*workspaceIdOf\(c\)/);
  assert.match(detectLayoutRoute, /userId:\s*text\(c\.get\('userId'\)\)/);
  assert.match(detectLayoutRoute, /featureCode:\s*'rich_menu_image_analysis'/);
  assert.match(detectLayoutRoute, /operationCode:\s*'detect_layout'/);
  assert.match(detectLayoutRoute, /provider:\s*'google'/);
});

test('Gemini adapter sends the shared key only in the server-side provider header', () => {
  assert.match(geminiAdapter, /'x-goog-api-key': options\.apiKey/);
  assert.match(geminiAdapter, /body:\s*JSON\.stringify\(options\.body\)/);
  assert.doesNotMatch(geminiAdapter, /JSON\.stringify\([^)]*apiKey/);
});