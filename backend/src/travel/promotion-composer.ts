import { readPromotionLiveTravel, type PromotionLiveTravel } from './promotion-formal-link.ts';

export const PROMOTION_COMPOSER_FORMATS = ['SINGLE','CAROUSEL','LIST','TRAVEL_4_GRID','TRAVEL_6_GRID'] as const;
export type PromotionComposerFormat = typeof PROMOTION_COMPOSER_FORMATS[number];
type Row = Record<string, any>;

const referencePattern = /^promotion_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const clean = (value: unknown, maximum: number) => String(value ?? '').trim().slice(0, maximum);
const json = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value ?? '')) as T; } catch { return fallback; } };
const exact = (value: unknown, fields: readonly string[], code: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !fields.includes(key))) throw new Error(code);
  return record;
};

function requiredCount(format: PromotionComposerFormat) {
  if (format === 'SINGLE') return { min: 1, max: 1 };
  if (format === 'TRAVEL_4_GRID') return { min: 4, max: 4 };
  if (format === 'TRAVEL_6_GRID') return { min: 6, max: 6 };
  return { min: 2, max: 10 };
}

export function validatePromotionCompositionRequest(value: unknown) {
  const body = exact(value, ['format','safePromotionReferences','options'], 'TRAVEL_PROMOTION_COMPOSITION_INVALID');
  const format = String(body.format || '').toUpperCase() as PromotionComposerFormat;
  if (!PROMOTION_COMPOSER_FORMATS.includes(format)) throw new Error('TRAVEL_PROMOTION_FORMAT_INVALID');
  if (!Array.isArray(body.safePromotionReferences)) throw new Error('TRAVEL_PROMOTION_SELECTION_INVALID');
  const references = body.safePromotionReferences.map(item => typeof item === 'string' ? item.trim() : '');
  const count = requiredCount(format);
  if (references.length < count.min || references.length > count.max) throw new Error('TRAVEL_PROMOTION_COMPOSE_COUNT_INVALID');
  if (new Set(references).size !== references.length
    || references.some(reference => !referencePattern.test(reference))) throw new Error('TRAVEL_PROMOTION_SELECTION_INVALID');
  const options = body.options === undefined ? {} : exact(body.options, ['headline','ctaLabel'], 'TRAVEL_PROMOTION_OPTIONS_INVALID');
  const headline = options.headline === undefined ? '' : clean(options.headline, 80);
  const ctaLabel = options.ctaLabel === undefined ? '查看旅遊內容' : clean(options.ctaLabel, 20);
  if ((options.headline !== undefined && (!headline || headline !== options.headline)) || !ctaLabel || ctaLabel !== (options.ctaLabel ?? '查看旅遊內容')) {
    throw new Error('TRAVEL_PROMOTION_OPTIONS_INVALID');
  }
  return { format, safePromotionReferences: references, options: { headline, ctaLabel } };
}

function money(amountMinor: number, currency: string) {
  return currency === 'TWD' ? `NT$${amountMinor.toLocaleString('en-US')}` : `${currency} ${amountMinor.toLocaleString('en-US')}`;
}

function promotionFacts(row: Row, live: PromotionLiveTravel | null, baseUrl: string) {
  const snapshotPrices = json<string[]>(row.pricing_texts_json, []).slice(0, 2);
  const snapshotDates = json<string[]>(row.date_texts_json, []).slice(0, 2);
  const bookable = Boolean(live?.departure && live.currentBookability && !live.soldOut && live.departure.status !== 'CANCELLED');
  const liveLines = !live?.departure ? [] : [
    live.departure.departureDate ? `出發日 ${live.departure.departureDate}` : '',
    live.departure.status === 'CANCELLED' ? '目前已取消' : live.soldOut ? '目前已額滿' : live.currentBookability ? `尚有 ${live.remainingSeats} 席` : '目前不可報名',
    live.authoritativePrice ? `目前價格 ${money(live.authoritativePrice.amountMinor, live.authoritativePrice.currencyCode)}` : '',
  ].filter(Boolean);
  return {
    title: clean(row.title, 120) || clean(row.display_label, 120),
    summary: clean(row.summary, 400),
    snapshotLines: [...snapshotDates, ...snapshotPrices],
    liveLines,
    bookable,
    safeDepartureReference: live?.departure?.safeDepartureReference || null,
    safeImageUrl: row.asset_id ? `${baseUrl}/api/assets/${encodeURIComponent(String(row.asset_id))}` : null,
  };
}

function textNode(text: string, size = 'sm', weight?: string) {
  return { type: 'text', text, size, wrap: true, ...(weight ? { weight } : {}) };
}

function itemBox(item: ReturnType<typeof promotionFacts>, ctaLabel: string, uri: string) {
  const contents: any[] = [];
  if (item.safeImageUrl) contents.push({ type: 'image', url: item.safeImageUrl, size: 'full', aspectMode: 'cover' });
  contents.push(textNode(item.title, 'md', 'bold'));
  if (item.summary) contents.push(textNode(item.summary));
  for (const line of item.snapshotLines) contents.push(textNode(`DM 快照｜${line}`, 'xs'));
  for (const line of item.liveLines) contents.push(textNode(`即時資訊｜${line}`, 'xs'));
  if (item.bookable) contents.push({ type: 'button', style: 'primary', action: { type: 'uri', label: ctaLabel, uri } });
  return { type: 'box', layout: 'vertical', spacing: 'sm', contents };
}

function flexMessage(format: PromotionComposerFormat, items: Array<ReturnType<typeof promotionFacts>>, headline: string, ctaLabel: string, baseUrl: string, refs: string[]) {
  const boxes = items.map((item, index) => itemBox(item, ctaLabel, `${baseUrl}/liff/travel?promotion=${encodeURIComponent(refs[index])}`));
  if (format === 'CAROUSEL') return { type: 'flex', altText: headline || '旅遊精選', contents: { type: 'carousel', contents: boxes.map(box => ({ type: 'bubble', body: box })) } };
  let bodyContents: any[] = headline ? [textNode(headline, 'lg', 'bold')] : [];
  if (format === 'TRAVEL_4_GRID' || format === 'TRAVEL_6_GRID') {
    for (let index = 0; index < boxes.length; index += 2) bodyContents.push({ type: 'box', layout: 'horizontal', spacing: 'md', contents: boxes.slice(index, index + 2) });
  } else bodyContents = [...bodyContents, ...boxes];
  return { type: 'flex', altText: headline || '旅遊精選', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'lg', contents: bodyContents } } };
}

function validateFlexNode(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
  const node = exact(value, value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>) : [], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
  if (node.type === 'text') {
    exact(node, ['type','text','size','wrap','weight'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    if (typeof node.text !== 'string' || !node.text.trim() || Array.from(node.text).length > 500
      || !['xs','sm','md','lg'].includes(String(node.size)) || node.wrap !== true
      || (node.weight !== undefined && node.weight !== 'bold')) throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    return;
  }
  if (node.type === 'box') {
    exact(node, ['type','layout','spacing','contents'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    if (!['vertical','horizontal'].includes(String(node.layout)) || !['sm','md','lg'].includes(String(node.spacing))
      || !Array.isArray(node.contents) || node.contents.length < 1 || node.contents.length > 40) throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    node.contents.forEach(child => validateFlexNode(child, depth + 1)); return;
  }
  if (node.type === 'image') {
    exact(node, ['type','url','size','aspectMode'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    if (node.size !== 'full' || node.aspectMode !== 'cover' || typeof node.url !== 'string') throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    let url: URL; try { url = new URL(node.url); } catch { throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID'); }
    if (url.protocol !== 'https:' || !url.pathname.startsWith('/api/assets/') || url.username || url.password) throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    return;
  }
  if (node.type === 'button') {
    exact(node, ['type','style','action'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    if (node.style !== 'primary') throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    const action = exact(node.action, ['type','label','uri'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    if (action.type !== 'uri' || typeof action.label !== 'string' || !action.label.trim() || Array.from(action.label).length > 20
      || typeof action.uri !== 'string') throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    let uri: URL; try { uri = new URL(action.uri); } catch { throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID'); }
    if (uri.protocol !== 'https:' || uri.pathname !== '/liff/travel'
      || !referencePattern.test(uri.searchParams.get('promotion') || '') || uri.username || uri.password) {
      throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    }
    return;
  }
  if (node.type === 'bubble') {
    exact(node, ['type','body'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    validateFlexNode(node.body, depth + 1); return;
  }
  if (node.type === 'carousel') {
    exact(node, ['type','contents'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    if (!Array.isArray(node.contents) || node.contents.length < 2 || node.contents.length > 10) throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    node.contents.forEach(child => validateFlexNode(child, depth + 1)); return;
  }
  throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
}

function validateFlexMessage(value: unknown) {
  const message = exact(value, ['type','altText','contents'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
  if (message.type !== 'flex' || typeof message.altText !== 'string' || !message.altText.trim()
    || Array.from(message.altText).length > 400) throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
  validateFlexNode(message.contents);
}
export function validateStructuredTravelEnvelope(value: unknown) {
  const envelope = exact(value, ['schemaVersion','messageType','format','messages','selectedPromotions'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
  if (envelope.schemaVersion !== 1 || envelope.messageType !== 'TRAVEL_PROMOTION'
    || !PROMOTION_COMPOSER_FORMATS.includes(envelope.format as PromotionComposerFormat)
    || !Array.isArray(envelope.messages) || envelope.messages.length !== 1
    || !Array.isArray(envelope.selectedPromotions)) throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
  const count = requiredCount(envelope.format as PromotionComposerFormat);
  if (envelope.selectedPromotions.length < count.min || envelope.selectedPromotions.length > count.max) {
    throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
  }
  for (const selected of envelope.selectedPromotions) {
    const item = exact(selected, ['safePromotionReference','safeDepartureReference','bookableAtCompose'], 'CAMPAIGN_STRUCTURED_CONTENT_INVALID');
    if (typeof item.safePromotionReference !== 'string' || !referencePattern.test(item.safePromotionReference)
      || (item.safeDepartureReference !== null && (typeof item.safeDepartureReference !== 'string'
        || !/^dep_[0-9a-f-]{36}$/.test(item.safeDepartureReference)))
      || typeof item.bookableAtCompose !== 'boolean') throw new Error('CAMPAIGN_STRUCTURED_CONTENT_INVALID');
  }
  const serialized = JSON.stringify(envelope);
  if (new TextEncoder().encode(serialized).byteLength > 50000) throw new Error('TRAVEL_PROMOTION_COMPOSE_PAYLOAD_TOO_LARGE');
  const message = envelope.messages[0] as any;
  validateFlexMessage(message);
  return { envelope, serialized };
}

export async function composeTravelPromotions(db: D1Database, input: { workspaceId: string; body: unknown; publicBaseUrl: string; now?: Date }) {
  const request = validatePromotionCompositionRequest(input.body);
  let baseUrl: URL;
  try { baseUrl = new URL(input.publicBaseUrl); } catch { throw new Error('TRAVEL_PROMOTION_DESTINATION_INVALID'); }
  if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== 'localhost' && baseUrl.hostname !== '127.0.0.1') throw new Error('TRAVEL_PROMOTION_DESTINATION_INVALID');
  const timestamp = (input.now || new Date()).toISOString();
  const placeholders = request.safePromotionReferences.map(() => '?').join(',');
  const rows = (await db.prepare(`SELECT d.id,d.public_ref,d.display_label,d.active_version_no,
      v.title,v.summary,v.date_texts_json,v.pricing_texts_json,
      (SELECT sa.asset_id FROM travel_promotion_source_assets sa JOIN assets a
        ON a.id=sa.asset_id AND a.workspace_id=sa.workspace_id
        WHERE sa.workspace_id=d.workspace_id AND sa.promotion_document_id=d.id
          AND sa.version_no=d.active_version_no AND sa.source_revision=v.source_revision
          AND a.status='ready' AND a.deleted_at IS NULL AND a.storage_key IS NOT NULL
          AND a.content_type IN ('image/png','image/jpeg')
        ORDER BY sa.sequence_no ASC LIMIT 1) asset_id
    FROM travel_promotion_documents d JOIN travel_promotion_versions v
      ON v.workspace_id=d.workspace_id AND v.promotion_document_id=d.id
      AND v.version_no=d.active_version_no AND v.version_status='APPROVED'
    WHERE d.workspace_id=? AND d.status='ACTIVE' AND d.public_ref IN (${placeholders})
      AND (d.expires_at IS NULL OR datetime(d.expires_at)>=datetime(?))`)
    .bind(input.workspaceId, ...request.safePromotionReferences, timestamp).all<Row>()).results || [];
  const byReference = new Map(rows.map(row => [String(row.public_ref), row]));
  if (request.safePromotionReferences.some(reference => !byReference.has(reference))) throw new Error('TRAVEL_PROMOTION_NOT_AVAILABLE');
  const ordered = request.safePromotionReferences.map(reference => byReference.get(reference)!);
  const live = await Promise.all(ordered.map(row => readPromotionLiveTravel(db, {
    workspaceId: input.workspaceId, documentId: String(row.id), activeVersionNo: Number(row.active_version_no), now: input.now,
  })));
  const facts = ordered.map((row, index) => promotionFacts(row, live[index], baseUrl.origin));
  const fallbackText = [request.options.headline || '旅遊精選', ...facts.map((item, index) => `${index + 1}. ${item.title}${item.liveLines.length ? `\n${item.liveLines.join('\n')}` : ''}`)].join('\n');
  const envelope = {
    schemaVersion: 1, messageType: 'TRAVEL_PROMOTION', format: request.format,
    messages: [flexMessage(request.format, facts, request.options.headline, request.options.ctaLabel, baseUrl.origin, request.safePromotionReferences)],
    selectedPromotions: request.safePromotionReferences.map((reference, index) => ({
      safePromotionReference: reference, safeDepartureReference: facts[index].safeDepartureReference,
      bookableAtCompose: facts[index].bookable,
    })),
  };
  const validated = validateStructuredTravelEnvelope(envelope);
  if (Array.from(fallbackText).length > 5000) throw new Error('CAMPAIGN_CONTENT_TEXT_INVALID');
  return { format: request.format, fallbackText, structuredContent: validated.envelope, payloadJson: validated.serialized,
    preview: { format: request.format, items: facts.map((item, index) => ({ safePromotionReference: request.safePromotionReferences[index], ...item })) } };
}
