import { type PromotionLiveTravel, readPromotionLiveTravel } from './promotion-formal-link.ts';

type Row = Record<string, unknown>;

export type PromotionQuery = {
  original: string;
  normalized: string;
  tokens: string[];
  monthTerms: string[];
  dayCount: number | null;
  priceTerms: string[];
};

export type PromotionSearchCandidate = {
  safePromotionReference: string;
  approvedAt: string;
  title: string;
  summary: string;
  destination: string;
  region: string;
  days: number | null;
  departureLocation: string;
  dateTexts: string[];
  pricingTexts: string[];
  promotionTerms: string[];
  highlights: string[];
  keywords: string[];
  faq: Array<{ question: string; answer: string }>;
  replyTemplate: string;
  knowledgeSearchTexts: string[];
};

export type PromotionSearchMatch = {
  safePromotionReference: string;
  score: number;
  matchedFields: string[];
  matchedKeywords: string[];
  promotionSnapshot: Omit<PromotionSearchCandidate, 'safePromotionReference' | 'approvedAt' | 'knowledgeSearchTexts'>;
  liveTravel: PromotionLiveTravel | null;
};

const MAX_QUERY_LENGTH = 300;
const MAX_CANDIDATES = 100;
const MAX_KNOWLEDGE_ROWS = 1300;
const FIELD_ORDER = ['destination', 'region', 'keywords', 'title', 'departureLocation', 'dateTexts', 'days', 'pricingTexts', 'knowledge'] as const;
const STOP_WORDS = ['請問', '想找', '想要', '有沒有', '有什麼', '什麼', '行程', '旅遊', '可以', '是否', '推薦', '幫我', '左右', '大約', '預算', '從', '出發', '的', '嗎', '呢', '有'];
const CHINESE_DIGITS: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

const clean = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().trim();
const compact = (value: unknown) => clean(value).replace(/[\s\p{P}\p{S}]+/gu, '');
const json = <T>(value: unknown, fallback: T): T => {
  try { return JSON.parse(String(value ?? '')) as T; } catch { return fallback; }
};
const unique = <T>(items: T[]) => [...new Set(items)];
const boundedText = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string') throw new Error(code);
  const result = value.trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) throw new Error(code);
  return result;
};

function chineseDayCount(value: string): number | null {
  const match = value.match(/([一二兩三四五六七八九十]|\d{1,3})天/u);
  if (!match) return null;
  const parsed = /^\d+$/.test(match[1]) ? Number(match[1]) : CHINESE_DIGITS[match[1]];
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : null;
}

export function normalizePromotionQuery(value: unknown): PromotionQuery {
  const original = boundedText(value, MAX_QUERY_LENGTH, 'TRAVEL_PROMOTION_QUERY_INVALID');
  const normalized = compact(original);
  if (!normalized) throw new Error('TRAVEL_PROMOTION_QUERY_INVALID');
  const monthTerms = unique([...normalized.matchAll(/(?:1[0-2]|0?[1-9])月/gu)].map(match => match[0].replace(/^0/, '')));
  const dayCount = chineseDayCount(normalized);
  const priceTerms = unique([...normalized.matchAll(/\d+(?:\.\d+)?萬|\d{4,7}(?:元)?/gu)].map(match => match[0]));
  let remainder = normalized;
  for (const phrase of [...monthTerms, ...priceTerms, ...STOP_WORDS]) remainder = remainder.split(phrase).join(' ');
  remainder = remainder.replace(/([一二兩三四五六七八九十]|\d{1,3})天(?:[一二兩三四五六七八九十]|\d{1,3})夜?/gu, ' ');
  const words = remainder.split(/\s+/u).filter(token => token.length >= 2 && token.length <= 40);
  const tokens = unique([...words, ...monthTerms, ...(dayCount ? [`${dayCount}天`] : []), ...priceTerms]).slice(0, 20);
  if (!tokens.length) tokens.push(normalized.slice(0, 40));
  return { original, normalized, tokens, monthTerms, dayCount, priceTerms };
}

const includesAny = (value: string, terms: string[]) => {
  const target = compact(value);
  return Boolean(target) && terms.some(term => target.includes(compact(term)) || compact(term).includes(target));
};
const matchingTerms = (values: string[], terms: string[]) => unique(terms.filter(term => values.some(value => includesAny(value, [term]))));

export function scorePromotionCandidate(query: PromotionQuery, candidate: PromotionSearchCandidate) {
  const fields = new Set<string>();
  const matchedKeywords: string[] = [];
  let score = 0;
  const generalTerms = query.tokens.filter(term => !query.monthTerms.includes(term) && !query.priceTerms.includes(term) && term !== `${query.dayCount}天`);
  if (candidate.destination && includesAny(candidate.destination, generalTerms)) { score += 50; fields.add('destination'); }
  if (candidate.region && includesAny(candidate.region, generalTerms)) { score += 35; fields.add('region'); }
  for (const keyword of candidate.keywords) if (includesAny(keyword, generalTerms)) { score += 20; fields.add('keywords'); matchedKeywords.push(keyword); }
  if (candidate.title && includesAny(candidate.title, generalTerms)) { score += 25; fields.add('title'); }
  if (candidate.departureLocation && includesAny(candidate.departureLocation, generalTerms)) { score += 25; fields.add('departureLocation'); }
  const dateMatches = matchingTerms(candidate.dateTexts, query.monthTerms);
  if (dateMatches.length) { score += 18 * dateMatches.length; fields.add('dateTexts'); }
  if (query.dayCount !== null && candidate.days === query.dayCount) { score += 30; fields.add('days'); }
  const priceMatches = matchingTerms(candidate.pricingTexts, query.priceTerms);
  if (priceMatches.length) { score += 12 * priceMatches.length; fields.add('pricingTexts'); }
  const knowledgeTerms = query.tokens.filter(term => candidate.knowledgeSearchTexts.some(value => includesAny(value, [term])));
  if (knowledgeTerms.length) { score += Math.min(25, knowledgeTerms.length * 5); fields.add('knowledge'); }
  return { score, matchedFields: FIELD_ORDER.filter(field => fields.has(field)), matchedKeywords: unique(matchedKeywords).sort() };
}

function candidateFromRow(row: Row, knowledgeSearchTexts: string[]): PromotionSearchCandidate {
  return {
    safePromotionReference: String(row.public_ref), approvedAt: String(row.approved_at || ''),
    title: String(row.title || ''), summary: String(row.summary || ''), destination: String(row.destination || ''),
    region: String(row.region || ''), days: row.days === null || row.days === undefined ? null : Number(row.days),
    departureLocation: String(row.departure_location || ''), dateTexts: json(row.date_texts_json, []),
    pricingTexts: json(row.pricing_texts_json, []), promotionTerms: json(row.promotion_terms_json, []),
    highlights: json(row.highlights_json, []), keywords: json(row.keywords_json, []), faq: json(row.faq_json, []),
    replyTemplate: String(row.reply_template || ''), knowledgeSearchTexts,
  };
}

function safeMatch(candidate: PromotionSearchCandidate, scored: ReturnType<typeof scorePromotionCandidate>, liveTravel: PromotionLiveTravel | null): PromotionSearchMatch {
  const { safePromotionReference, approvedAt: _approvedAt, knowledgeSearchTexts: _knowledge, ...promotionSnapshot } = candidate;
  return { safePromotionReference, ...scored, promotionSnapshot, liveTravel };
}

const money = (amountMinor: number, currencyCode: string) => currencyCode === 'TWD'
  ? `NT$${amountMinor.toLocaleString('en-US')}`
  : `${currencyCode} ${amountMinor.toLocaleString('en-US')}`;

function liveTravelLines(live: PromotionLiveTravel | null) {
  if (!live) return [];
  if (!live.departure) return [`正式行程：${live.itinerary.title}（尚未指定出發日）`];
  const state = live.departure.status === 'CANCELLED' ? '目前狀態：已取消'
    : live.soldOut ? '目前狀態：已售罄'
      : live.currentBookability ? `目前可報名：剩餘 ${live.remainingSeats} 位`
        : '目前狀態：暫不可報名';
  return [`正式出發日：${live.departure.departureDate}`, state,
    live.authoritativePrice ? `目前價格：${money(live.authoritativePrice.amountMinor, live.authoritativePrice.currencyCode)}` : ''];
}

export function buildDeterministicPromotionReply(query: string, matches: PromotionSearchMatch[]) {
  if (!matches.length) return `目前沒有找到符合「${query}」的現行宣傳內容，可協助由專人再確認最新行程。`;
  const lines = matches.map((match, index) => {
    const item = match.promotionSnapshot;
    const details = [item.summary, item.dateTexts.length ? `DM 日期：${item.dateTexts.join('、')}` : '',
      item.pricingTexts.length ? `DM 宣傳價格：${item.pricingTexts.join('、')}` : '',
      item.departureLocation ? `出發地點：${item.departureLocation}` : '', ...liveTravelLines(match.liveTravel)].filter(Boolean);
    return `${index + 1}. ${item.title}${details.length ? `\n${details.join('\n')}` : ''}`;
  });
  const note = matches.some(match => match.liveTravel)
    ? 'DM 內容保留為審核快照；目前狀態、名額與價格以正式行程資料為準，送出前請再次確認。'
    : '目前名額與價格仍以最新出發日及行程資料為準，可協助確認。';
  return `找到以下現行宣傳內容：\n${lines.join('\n')}\n${note}`;
}

export async function searchTravelPromotionKnowledge(db: D1Database, input: { workspaceId: string; query: unknown; limit?: unknown; now?: Date }) {
  const query = normalizePromotionQuery(input.query);
  const requested = input.limit === undefined ? 5 : Number(input.limit);
  if (!Number.isInteger(requested) || requested < 1 || requested > 10) throw new Error('TRAVEL_PROMOTION_QUERY_INVALID');
  const nowValue = input.now || new Date();
  const now = nowValue.toISOString();
  const candidates = (await db.prepare(`SELECT d.public_ref,d.id AS document_id,d.active_version_no,
      v.approved_at,v.title,v.summary,v.destination,v.region,v.days,v.departure_location,
      v.date_texts_json,v.pricing_texts_json,v.promotion_terms_json,v.highlights_json,v.keywords_json,v.faq_json,v.reply_template
    FROM travel_promotion_documents d
    JOIN travel_promotion_versions v ON v.workspace_id=d.workspace_id AND v.promotion_document_id=d.id
      AND v.version_no=d.active_version_no AND v.version_status='APPROVED'
    WHERE d.workspace_id=? AND d.status='ACTIVE' AND d.active_version_no IS NOT NULL
      AND (d.expires_at IS NULL OR datetime(d.expires_at)>=datetime(?))
    ORDER BY datetime(v.approved_at) DESC,d.public_ref ASC LIMIT ?`)
    .bind(input.workspaceId, now, MAX_CANDIDATES).all<Row>()).results || [];
  if (!candidates.length) return { query: query.original, matches: [], replySuggestion: buildDeterministicPromotionReply(query.original, []) };
  const knowledgeRows = (await db.prepare(`SELECT d.id AS document_id,k.search_text
    FROM travel_promotion_documents d
    JOIN travel_promotion_versions v ON v.workspace_id=d.workspace_id AND v.promotion_document_id=d.id
      AND v.version_no=d.active_version_no AND v.version_status='APPROVED'
    JOIN travel_promotion_knowledge_entries k ON k.workspace_id=d.workspace_id AND k.promotion_document_id=d.id
      AND k.version_no=d.active_version_no
    WHERE d.workspace_id=? AND d.status='ACTIVE' AND (d.expires_at IS NULL OR datetime(d.expires_at)>=datetime(?))
    ORDER BY d.public_ref ASC,k.entry_type ASC,k.sequence_no ASC LIMIT ?`)
    .bind(input.workspaceId, now, MAX_KNOWLEDGE_ROWS).all<Row>()).results || [];
  const knowledge = new Map<string, string[]>();
  for (const row of knowledgeRows) knowledge.set(String(row.document_id), [...(knowledge.get(String(row.document_id)) || []), String(row.search_text || '')]);
  const selected = candidates.map(row => {
    const candidate = candidateFromRow(row, knowledge.get(String(row.document_id)) || []);
    return { documentId: String(row.document_id), activeVersionNo: Number(row.active_version_no), candidate,
      scored: scorePromotionCandidate(query, candidate) };
  }).filter(item => item.scored.score > 0)
    .sort((a, b) => b.scored.score - a.scored.score || b.candidate.approvedAt.localeCompare(a.candidate.approvedAt)
      || a.candidate.safePromotionReference.localeCompare(b.candidate.safePromotionReference))
    .slice(0, requested);
  const ranked = await Promise.all(selected.map(async item => safeMatch(item.candidate, item.scored,
    await readPromotionLiveTravel(db, { workspaceId: input.workspaceId, documentId: item.documentId,
      activeVersionNo: item.activeVersionNo, now: nowValue }))));
  return { query: query.original, matches: ranked, replySuggestion: buildDeterministicPromotionReply(query.original, ranked) };
}
