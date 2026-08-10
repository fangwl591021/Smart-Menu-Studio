import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const panel = await readFile(
  fileURLToPath(new URL('../src/components/CrmInsightsTraitsPanel.jsx', import.meta.url)),
  'utf8',
);
const workspace = await readFile(
  fileURLToPath(new URL('../src/components/CrmWorkspace.jsx', import.meta.url)),
  'utf8',
);

test('CRM 360 mounts the contained Tags, Insights, and Traits experience', () => {
  assert.match(workspace, /CrmInsightsTraitsPanel/);
  assert.match(workspace, /personReference=\{detail\.personRef\}/);
  assert.match(panel, /CRM 標籤/);
  assert.match(panel, /五項洞察/);
  assert.match(panel, /個人特質/);
  assert.match(workspace, /CRM 負責人/);
  assert.match(workspace, /referrerLabel/);
  assert.match(workspace, /assignedOwner/);
});

test('Tags use only safe references with role-aware create, assign, and history-safe remove UX', () => {
  for (const path of ['/api/crm/tags', '/tags', '/remove']) assert.match(panel, new RegExp(path.replaceAll('/', '\\/')));
  assert.match(panel, /safeTagReference/);
  assert.match(panel, /canCreateTags/);
  assert.match(panel, /canManageTags/);
  assert.match(panel, /CRM_MANUAL/);
  assert.match(panel, /目前尚未為此客戶加入 CRM 標籤/);
  assert.doesNotMatch(panel, /tagId|crm_tag_id|crm_person_id|memberId|line_identity_hash|source_ref/i);
});

test('Insights remain backend-read-only, version-aware, and never offer AI generation', () => {
  assert.match(panel, /\/api\/crm\/people\/.*\/insights/);
  assert.match(panel, /顯示版本歷程/);
  assert.match(panel, /insight\.version/);
  assert.match(panel, /insightStatusLabels/);
  assert.match(panel, /目前尚無已記錄的洞察資料/);
  assert.match(panel, /目前未提供 AI 產生或重新產生功能/);
  assert.doesNotMatch(panel, /generateInsight|regenerate|fetch\(|https?:\/\/.*(?:openai|gemini|anthropic)/i);
  assert.doesNotMatch(panel, /providerPayload|rawPrompt|promptText/i);
});

test('Traits display backend Zodiac only and keep Chinese Zodiac and Life Path pending', () => {
  assert.match(panel, /\/api\/crm\/people\/.*\/traits/);
  assert.match(panel, /zodiacLabels/);
  assert.match(panel, /尚無星座特質資料/);
  assert.match(panel, /生肖：尚未提供/);
  assert.match(panel, /生命靈數：尚未提供/);
  assert.doesNotMatch(panel, /zodiacFromBirthday|deriveZodiacTrait|getUTCMonth\(|lifePath|numerology/i);
});

test('The panel has isolated loading and error states with no browser persistence or economy controls', () => {
  assert.match(panel, /載入 CRM 標籤、洞察與特質中/);
  assert.match(panel, /無法載入洞察資訊/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|indexedDB|payout|withdraw|commission|pointAccount|dealer eligibility/i);
});
