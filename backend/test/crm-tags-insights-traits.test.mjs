import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zodiacFromBirthday } from '../src/crm/insights.ts';

const file = (relative) => fileURLToPath(new URL(relative, import.meta.url));

test('0039 is additive and preserves tag, insight, and trait history', async () => {
  const sql = await readFile(file('../migrations/0039_crm_tags_insights_traits.sql'), 'utf8');
  for (const table of ['crm_tags', 'crm_person_tags', 'crm_person_insights', 'crm_person_traits']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /idx_crm_person_tag_active/);
  assert.match(sql, /removed_at IS NULL/);
  assert.match(sql, /crm_person_insights_no_update/);
  assert.match(sql, /crm_person_traits_no_delete/);
  assert.doesNotMatch(sql, /\b(?:ALTER TABLE|DROP TABLE|UPDATE\s+crm_profiles)\b/i);
});

test('Zodiac uses only valid birthday input and a deterministic versioned rule', () => {
  assert.equal(zodiacFromBirthday('1990-03-21'), 'ARIES');
  assert.equal(zodiacFromBirthday('1990-01-19'), 'CAPRICORN');
  assert.equal(zodiacFromBirthday('1990-02-30'), null);
  assert.equal(zodiacFromBirthday('not-a-date'), null);
});

test('6E route contract is workspace-scoped, safe-reference-only, and excludes AI execution', async () => {
  const [routes, service, index] = await Promise.all([readFile(file('../src/crm/insight-routes.ts'), 'utf8'), readFile(file('../src/crm/insights.ts'), 'utf8'), readFile(file('../src/index.ts'), 'utf8')]);
  for (const route of ["'/api/crm/tags'", "'/api/crm/tags/:safeTagReference/status'", "'/api/crm/people/:safePersonReference/tags'", "'/api/crm/people/:safePersonReference/insights'", "'/api/crm/people/:safePersonReference/traits'", "'/api/member/crm-traits'"]) assert.ok(routes.includes(route));
  assert.match(routes, /requireRole\(c, 'viewer'\)/); assert.match(routes, /requireRole\(c, 'editor'\)/); assert.match(routes, /requireRole\(c, 'admin'\)/);
  assert.match(routes, /safeTagReference/);
  assert.doesNotMatch(routes, /fetch\(|OPENAI|GEMINI|provider|prompt/i);
  assert.match(service, /zodiac:v1/);
  assert.doesNotMatch(service, /CHINESE_ZODIAC.*INSERT|LIFE_PATH_NUMBER.*INSERT/);
  assert.ok(index.includes('registerCrmInsightRoutes'));
});

test('safe member projection is trait-only and no provider payload or raw prompt storage exists', async () => {
  const [source, memberRoutes] = await Promise.all([readFile(file('../src/crm/insights.ts'), 'utf8'), readFile(file('../src/crm/insight-routes.ts'), 'utf8')]);
  for (const forbidden of ['provider_payload', 'raw_prompt', 'line_identity_hash', 'member_id']) assert.equal(source.includes(forbidden), false);
  assert.match(memberRoutes, /trait\.traitType === 'ZODIAC'/);
  assert.doesNotMatch(memberRoutes, /member\/crm-traits[\s\S]{0,700}(?:tags|insights)/);
});
