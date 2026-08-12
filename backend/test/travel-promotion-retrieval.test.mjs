import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildDeterministicPromotionReply,
  normalizePromotionQuery,
  scorePromotionCandidate,
  searchTravelPromotionKnowledge,
} from '../src/travel/promotion-retrieval.ts';

const file = relative => new URL(relative, import.meta.url);
const source = await readFile(file('../src/travel/promotion-retrieval.ts'), 'utf8');
const routes = await readFile(file('../src/travel/promotion-routes.ts'), 'utf8');

const candidate = overrides => ({
  safePromotionReference: 'promotion_11111111-1111-1111-1111-111111111111', approvedAt: '2026-08-12T00:00:00.000Z',
  title: '北海道冬季五日', summary: '北海道雪景行程', destination: '北海道', region: '日本', days: 5,
  departureLocation: '台中機場', dateTexts: ['10月出發'], pricingTexts: ['每人 3萬 起'],
  promotionTerms: [], highlights: ['雪景'], keywords: ['北海道', '日本'], faq: [], replyTemplate: '',
  knowledgeSearchTexts: ['北海道 日本 台中 10月 3萬 雪景'], ...overrides,
});

class FakeDb {
  constructor(documents, knowledge) { this.documents = documents; this.knowledge = knowledge; this.sql = []; }
  prepare(sql) {
    this.sql.push(sql);
    return { bind: (...bindings) => ({
      all: async () => ({ results: sql.includes('k.search_text') ? this.knowledge : this.documents, bindings }),
      first: async () => null,
    }) };
  }
}

test('query normalization deterministically extracts destination text, month, departure, days, and price', () => {
  assert.deepEqual(normalizePromotionQuery('10月有日本行程嗎？').tokens, ['日本', '10月']);
  assert.deepEqual(normalizePromotionQuery('北海道有什麼？').tokens, ['北海道']);
  assert.deepEqual(normalizePromotionQuery('台中出發的行程').tokens, ['台中']);
  assert.equal(normalizePromotionQuery('三天兩夜有嗎').dayCount, 3);
  assert.deepEqual(normalizePromotionQuery('3萬左右有什麼').priceTerms, ['3萬']);
  assert.throws(() => normalizePromotionQuery(''), /TRAVEL_PROMOTION_QUERY_INVALID/);
  assert.throws(() => normalizePromotionQuery('x'.repeat(301)), /TRAVEL_PROMOTION_QUERY_INVALID/);
});

test('scoring is explicit for title destination region keyword departure month days price and knowledge', () => {
  for (const [query, field] of [
    ['北海道', 'destination'], ['日本', 'region'], ['北海道', 'keywords'], ['北海道冬季五日', 'title'],
    ['台中', 'departureLocation'], ['10月', 'dateTexts'], ['5天', 'days'], ['3萬', 'pricingTexts'], ['雪景', 'knowledge'],
  ]) {
    const result = scorePromotionCandidate(normalizePromotionQuery(query), candidate());
    assert.ok(result.matchedFields.includes(field), query + ' -> ' + field);
    assert.ok(result.score > 0);
  }
});

test('retrieval SQL is workspace scoped and admits only current active approved unexpired versions', () => {
  assert.match(source, /d\.workspace_id=\?/);
  assert.match(source, /d\.status='ACTIVE'/);
  assert.match(source, /v\.version_no=d\.active_version_no/);
  assert.match(source, /v\.version_status='APPROVED'/);
  assert.match(source, /d\.expires_at IS NULL OR datetime\(d\.expires_at\)>=datetime\(\?\)/);
  assert.doesNotMatch(source, /current_draft_version_no/);
  assert.match(source, /LIMIT \?`\)[\s\S]*MAX_CANDIDATES/);
  assert.match(source, /MAX_CANDIDATES = 100/);
  assert.match(source, /MAX_KNOWLEDGE_ROWS = 1300/);
});

test('search returns deterministic ordering, safe evidence, current snapshots, and bounded results', async () => {
  const documents = [
    { document_id: 'internal-b', public_ref: 'promotion_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', active_version_no: 2,
      approved_at: '2026-08-12T00:00:00.000Z', title: '北海道 B', summary: '北海道', destination: '北海道', region: '日本', days: 5,
      departure_location: '台中', date_texts_json: '[]', pricing_texts_json: '[]', promotion_terms_json: '[]', highlights_json: '[]', keywords_json: '["北海道"]', faq_json: '[]', reply_template: '' },
    { document_id: 'internal-a', public_ref: 'promotion_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', active_version_no: 1,
      approved_at: '2026-08-12T00:00:00.000Z', title: '北海道 A', summary: '北海道', destination: '北海道', region: '日本', days: 5,
      departure_location: '台中', date_texts_json: '[]', pricing_texts_json: '[]', promotion_terms_json: '[]', highlights_json: '[]', keywords_json: '["北海道"]', faq_json: '[]', reply_template: '' },
  ];
  const db = new FakeDb(documents, [{ document_id: 'internal-a', search_text: '北海道' }, { document_id: 'internal-b', search_text: '北海道' }]);
  const result = await searchTravelPromotionKnowledge(db, { workspaceId: 'workspace-internal', query: '北海道', limit: 2, now: new Date('2026-08-12T00:00:00Z') });
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map(item => item.safePromotionReference), [documents[1].public_ref, documents[0].public_ref]);
  assert.equal(result.matches[0].liveTravel, null);
  assert.ok(result.matches[0].matchedFields.length);
  assert.equal('documentId' in result.matches[0], false);
  assert.equal(JSON.stringify(result).includes('internal-a'), false);
  await assert.rejects(() => searchTravelPromotionKnowledge(db, { workspaceId: 'w', query: '北海道', limit: 11 }), /TRAVEL_PROMOTION_QUERY_INVALID/);
});

test('no match is empty and deterministic reply never invents a promotion', async () => {
  const db = new FakeDb([], []);
  const result = await searchTravelPromotionKnowledge(db, { workspaceId: 'w', query: '不存在的內容' });
  assert.deepEqual(result.matches, []);
  assert.match(result.replySuggestion, /目前沒有找到/);
  assert.match(result.replySuggestion, /專人再確認/);
});

test('deterministic reply distinguishes DM snapshot and uses safe confirmation wording', () => {
  const scored = scorePromotionCandidate(normalizePromotionQuery('北海道'), candidate());
  const item = candidate();
  const { safePromotionReference, approvedAt, knowledgeSearchTexts, ...promotionSnapshot } = item;
  const reply = buildDeterministicPromotionReply('北海道', [{ safePromotionReference, ...scored, promotionSnapshot, liveTravel: null }]);
  assert.match(reply, /DM 日期/);
  assert.match(reply, /DM 宣傳價格/);
  assert.match(reply, /可協助確認/);
  assert.match(reply, /名額與價格仍以最新出發日及行程資料為準/);
  assert.doesNotMatch(reply, /已報名|已保留|一定有位|價格保證/);
});

test('viewer search route is exact, uses server workspace context, and requires no AI', () => {
  const start = routes.indexOf("app.post('/api/travel/promotions/search'");
  assert.ok(start >= 0);
  const route = routes.slice(start, routes.indexOf("app.get('/api/travel/promotions/:safePromotionReference'"));
  assert.match(route, /requireRole\(c,'viewer'\)/);
  assert.match(route, /exactAction[\s\S]*\['query','limit'\]/);
  assert.match(route, /workspaceId:deps\.workspaceIdOf\(c\)/);
  assert.doesNotMatch(route, /executeMeteredAiCall|requestGeminiContent|moduleKey:'AI'/);
});

test('formal Travel enrichment is explicit and never inferred from promotion text', () => {
  assert.match(source, /readPromotionLiveTravel/);
  assert.match(source, /documentId: String\(row\.document_id\)/);
  assert.doesNotMatch(source, /title.*(?:JOIN|LIKE).*travel_/i);
  assert.doesNotMatch(source, /destination.*(?:JOIN|LIKE).*travel_/i);
});

test('retrieval has no writes, LINE/Campaign surface, analytics, vectors, or internal identity projection', () => {
  assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|REPLACE\s+INTO)\b/i);
  assert.doesNotMatch(source, /executeMeteredAiCall|requestGemini|fetch\(|\/v2\/bot|webhook|campaign|crm_|referral|dealer|commission|payment|booking|embedding|vector/i);
  assert.doesNotMatch(source, /lineUser|uid|memberId/);
  const publicType = source.slice(source.indexOf('export type PromotionSearchMatch'), source.indexOf('const MAX_QUERY_LENGTH'));
  assert.doesNotMatch(publicType, /documentId|versionId|knowledgeEntryId|storageKey|workspaceId/);
});
