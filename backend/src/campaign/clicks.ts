import { parseCampaignTextContent, renderCampaignTextContent } from './content.ts';

const encoder = new TextEncoder();
const HEX_64 = /^[a-f0-9]{64}$/;
const PURPOSE_LINK = 'campaign-tracked-link:v1';
const PURPOSE_CONTEXT = 'campaign-recipient-link:v1';
const PURPOSE_CLICK = 'campaign-click-cursor-ref:v1';
const PURPOSE_CURSOR = 'campaign-click-list-cursor:v1';

export type FrozenTrackedLink = {
  id: string;
  publicRef: string;
  token: string;
  destinationUrl: string;
  label: string;
};

const clean = (value: unknown, maximum = 200) => String(value ?? '').trim().slice(0, maximum);
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret: string, purpose: string, parts: readonly unknown[]) {
  if (!secret.trim()) throw new Error('CAMPAIGN_TRACKING_SECRET_MISSING');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = JSON.stringify([purpose, ...parts]);
  return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

function equalOpaque(left: string, right: string) {
  if (!HEX_64.test(left) || !HEX_64.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function trackingOrigin(value: unknown) {
  let url: URL;
  try { url = new URL(String(value || '')); } catch { throw new Error('CAMPAIGN_TRACKING_ORIGIN_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('CAMPAIGN_TRACKING_ORIGIN_INVALID');
  return url.origin;
}

export async function trackedLinkRegistrationStatements(db: D1Database, input: {
  workspaceId: string; campaignId: string; contentVersionNo: number;
  contentType: unknown; payloadJson: unknown; signingSecret: string;
}) {
  const content = parseCampaignTextContent(input.contentType, input.payloadJson);
  const statements: D1PreparedStatement[] = [];
  for (const link of content.links) {
    const internalId = id('camptl');
    const publicRef = await hmac(input.signingSecret, PURPOSE_LINK, [
      input.workspaceId, input.campaignId, input.contentVersionNo, link.token, link.destinationUrl, link.label,
    ]);
    statements.push(db.prepare(`INSERT INTO campaign_tracked_links(
      id,public_ref,workspace_id,campaign_id,content_version_no,token_name,destination_url,label
    ) VALUES(?,?,?,?,?,?,?,?)`).bind(
      internalId, publicRef, input.workspaceId, input.campaignId, input.contentVersionNo,
      link.token, link.destinationUrl, link.label,
    ));
  }
  return statements;
}

export async function loadFrozenTrackedLinks(db: D1Database, input: {
  workspaceId: string; campaignId: string; contentVersionNo: number;
  contentType: unknown; payloadJson: unknown; signingSecret: string;
}) {
  const content = parseCampaignTextContent(input.contentType, input.payloadJson);
  if (!content.links.length) return [] as FrozenTrackedLink[];
  const rows = await db.prepare(`SELECT id,public_ref,token_name,destination_url,label FROM campaign_tracked_links
    WHERE workspace_id=? AND campaign_id=? AND content_version_no=? ORDER BY token_name ASC`)
    .bind(input.workspaceId, input.campaignId, input.contentVersionNo).all<Record<string, unknown>>();
  const found = rows.results || [];
  if (found.length !== content.links.length) throw new Error('CAMPAIGN_TRACKED_LINK_BINDING_INVALID');
  const result: FrozenTrackedLink[] = [];
  for (const definition of content.links) {
    const row = found.find(candidate => candidate.token_name === definition.token);
    if (!row || row.destination_url !== definition.destinationUrl || row.label !== definition.label) {
      throw new Error('CAMPAIGN_TRACKED_LINK_BINDING_INVALID');
    }
    const expected = await hmac(input.signingSecret, PURPOSE_LINK, [
      input.workspaceId, input.campaignId, input.contentVersionNo, definition.token, definition.destinationUrl, definition.label,
    ]);
    if (!equalOpaque(clean(row.public_ref, 64), expected)) throw new Error('CAMPAIGN_TRACKED_LINK_BINDING_INVALID');
    result.push({ id: clean(row.id), publicRef: expected, token: definition.token, destinationUrl: definition.destinationUrl, label: definition.label });
  }
  return result;
}

export async function recipientTrackedContent(input: {
  db: D1Database; workspaceId: string; campaignId: string; executionId: string; deliveryId: string;
  contentType: unknown; payloadJson: unknown; links: readonly FrozenTrackedLink[];
  signingSecret: string; trackingBaseUrl: string; createContexts: boolean;
}) {
  const byToken = new Map(input.links.map(link => [link.token, link]));
  const statements: D1PreparedStatement[] = [];
  const base = input.links.length ? trackingOrigin(input.trackingBaseUrl) : '';
  const text = await renderCampaignTextContent({
    contentType: input.contentType,
    payloadJson: input.payloadJson,
    resolveTrackedLink: async definition => {
      const link = byToken.get(definition.token);
      if (!link || link.destinationUrl !== definition.destinationUrl || link.label !== definition.label) {
        throw new Error('CAMPAIGN_TRACKED_LINK_BINDING_INVALID');
      }
      const contextRef = await hmac(input.signingSecret, PURPOSE_CONTEXT, [
        input.workspaceId, input.campaignId, input.executionId, input.deliveryId, link.id,
      ]);
      if (input.createContexts) statements.push(input.db.prepare(`INSERT INTO campaign_click_contexts(
        id,public_ref,workspace_id,campaign_id,execution_id,delivery_id,tracked_link_id
      ) VALUES(?,?,?,?,?,?,?)`).bind(
        id('campctx'), contextRef, input.workspaceId, input.campaignId, input.executionId, input.deliveryId, link.id,
      ));
      return `${base}/t/${link.publicRef}?c=${contextRef}`;
    },
  });
  return { text, statements };
}

export async function resolveCampaignClick(db: D1Database, input: {
  opaqueReference: string; recipientContext?: string | null; signingSecret: string;
}) {
  const reference = clean(input.opaqueReference, 64);
  if (!HEX_64.test(reference)) return null;
  const link = await db.prepare(`SELECT l.*,v.content_type,v.payload_json FROM campaign_tracked_links l
    JOIN campaign_content_versions v ON v.workspace_id=l.workspace_id AND v.campaign_id=l.campaign_id
      AND v.version_no=l.content_version_no
    WHERE l.public_ref=? LIMIT 1`).bind(reference).first<Record<string, unknown>>();
  if (!link) return null;
  const expectedLink = await hmac(input.signingSecret, PURPOSE_LINK, [
    link.workspace_id, link.campaign_id, Number(link.content_version_no), link.token_name, link.destination_url, link.label,
  ]);
  if (!equalOpaque(reference, expectedLink)) return null;
  const content = parseCampaignTextContent(link.content_type, link.payload_json);
  const frozen = content.links.find(item => item.token === link.token_name);
  if (!frozen || frozen.destinationUrl !== link.destination_url || frozen.label !== link.label) return null;

  let visitorKind: 'ANONYMOUS' | 'KNOWN_CRM_PERSON' = 'ANONYMOUS';
  let crmPersonId: string | null = null;
  let executionId: string | null = null;
  let deliveryId: string | null = null;
  const contextRef = clean(input.recipientContext, 64);
  if (input.recipientContext != null) {
    if (!HEX_64.test(contextRef)) return null;
    const context = await db.prepare(`SELECT x.*,d.crm_person_id FROM campaign_click_contexts x
      JOIN campaign_deliveries d ON d.workspace_id=x.workspace_id AND d.id=x.delivery_id
        AND d.execution_id=x.execution_id AND d.campaign_id=x.campaign_id
      JOIN campaign_executions e ON e.workspace_id=x.workspace_id AND e.id=x.execution_id
        AND e.campaign_id=x.campaign_id
      WHERE x.public_ref=? AND x.tracked_link_id=? AND x.workspace_id=? AND x.campaign_id=? LIMIT 1`)
      .bind(contextRef, link.id, link.workspace_id, link.campaign_id).first<Record<string, unknown>>();
    if (!context) return null;
    const expectedContext = await hmac(input.signingSecret, PURPOSE_CONTEXT, [
      context.workspace_id, context.campaign_id, context.execution_id, context.delivery_id, context.tracked_link_id,
    ]);
    if (!equalOpaque(contextRef, expectedContext)) return null;
    visitorKind = 'KNOWN_CRM_PERSON';
    crmPersonId = clean(context.crm_person_id);
    executionId = clean(context.execution_id);
    deliveryId = clean(context.delivery_id);
  }
  const destinationUrl = String(link.destination_url);
  if (new URL(destinationUrl).protocol !== 'https:') return null;
  const eventId = id('campclick');
  const occurredAt = new Date().toISOString();
  const cursorRef = await hmac(input.signingSecret, PURPOSE_CLICK, [eventId, link.workspace_id, link.campaign_id, occurredAt]);
  const evidence = db.prepare(`INSERT INTO campaign_click_events(
    id,cursor_ref,workspace_id,campaign_id,tracked_link_id,occurred_at,visitor_kind,crm_person_id,execution_id,delivery_id
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(
    eventId, cursorRef, link.workspace_id, link.campaign_id, link.id, occurredAt,
    visitorKind, crmPersonId, executionId, deliveryId,
  ).run();
  // Existing-person clicks are engagement evidence only: never acquisition, conversion, referral, or economy authority.
  return { destinationUrl, evidence };
}

function destinationHost(value: unknown) {
  try { return new URL(String(value)).host; } catch { return ''; }
}

export async function campaignClickSummary(db: D1Database, workspaceId: string, campaignReference: string) {
  const campaign = await db.prepare('SELECT id FROM campaigns WHERE workspace_id=? AND public_ref=? LIMIT 1')
    .bind(workspaceId, campaignReference).first<Record<string, unknown>>();
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  const total = await db.prepare(`SELECT COUNT(*) total_clicks,
      COUNT(DISTINCT CASE WHEN visitor_kind='KNOWN_CRM_PERSON' THEN crm_person_id END) unique_known_people,
      COALESCE(SUM(CASE WHEN visitor_kind='ANONYMOUS' THEN 1 ELSE 0 END),0) anonymous_clicks,
      MIN(occurred_at) first_clicked_at,MAX(occurred_at) latest_clicked_at
    FROM campaign_click_events WHERE workspace_id=? AND campaign_id=?`).bind(workspaceId, campaign.id).first<Record<string, unknown>>();
  const rows = await db.prepare(`SELECT l.label,l.destination_url,COUNT(e.id) total_clicks,
      COUNT(DISTINCT CASE WHEN e.visitor_kind='KNOWN_CRM_PERSON' THEN e.crm_person_id END) unique_known_people,
      COALESCE(SUM(CASE WHEN e.visitor_kind='ANONYMOUS' THEN 1 ELSE 0 END),0) anonymous_clicks
    FROM campaign_tracked_links l LEFT JOIN campaign_click_events e
      ON e.workspace_id=l.workspace_id AND e.campaign_id=l.campaign_id AND e.tracked_link_id=l.id
    WHERE l.workspace_id=? AND l.campaign_id=? GROUP BY l.id,l.label,l.destination_url ORDER BY l.label ASC,l.public_ref ASC`)
    .bind(workspaceId, campaign.id).all<Record<string, unknown>>();
  return {
    totalClicks: Number(total?.total_clicks || 0),
    uniqueKnownPeople: Number(total?.unique_known_people || 0),
    anonymousClicks: Number(total?.anonymous_clicks || 0),
    firstClickedAt: total?.first_clicked_at || null,
    latestClickedAt: total?.latest_clicked_at || null,
    clicksByTrackedLink: (rows.results || []).map(row => ({
      trackedLinkLabel: clean(row.label, 120), destinationHost: destinationHost(row.destination_url),
      totalClicks: Number(row.total_clicks || 0), uniqueKnownPeople: Number(row.unique_known_people || 0),
      anonymousClicks: Number(row.anonymous_clicks || 0),
    })),
  };
}

function base64Url(value: string) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodeBase64Url(value: string) {
  try { return atob(value.replace(/-/g, '+').replace(/_/g, '/')); } catch { throw new Error('CAMPAIGN_CLICK_CURSOR_INVALID'); }
}

async function encodeCursor(secret: string, workspaceId: string, campaignId: string, occurredAt: string, cursorRef: string) {
  const payload = JSON.stringify({ v: 1, occurredAt, cursorRef });
  const signature = await hmac(secret, PURPOSE_CURSOR, [workspaceId, campaignId, payload]);
  return `${base64Url(payload)}.${signature}`;
}

async function decodeCursor(secret: string, workspaceId: string, campaignId: string, value: string) {
  const [encoded, signature, extra] = value.split('.');
  if (!encoded || !signature || extra) throw new Error('CAMPAIGN_CLICK_CURSOR_INVALID');
  const payload = decodeBase64Url(encoded);
  const expected = await hmac(secret, PURPOSE_CURSOR, [workspaceId, campaignId, payload]);
  if (!equalOpaque(signature, expected)) throw new Error('CAMPAIGN_CLICK_CURSOR_INVALID');
  let parsed: any;
  try { parsed = JSON.parse(payload); } catch { throw new Error('CAMPAIGN_CLICK_CURSOR_INVALID'); }
  if (parsed?.v !== 1 || typeof parsed.occurredAt !== 'string' || !HEX_64.test(parsed.cursorRef)) {
    throw new Error('CAMPAIGN_CLICK_CURSOR_INVALID');
  }
  return { occurredAt: parsed.occurredAt, cursorRef: parsed.cursorRef };
}

export async function campaignClickList(db: D1Database, input: {
  workspaceId: string; campaignReference: string; limit: number; cursor?: string | null; signingSecret: string;
}) {
  const campaign = await db.prepare('SELECT id FROM campaigns WHERE workspace_id=? AND public_ref=? LIMIT 1')
    .bind(input.workspaceId, input.campaignReference).first<Record<string, unknown>>();
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
  const cursor = input.cursor ? await decodeCursor(input.signingSecret, input.workspaceId, clean(campaign.id), input.cursor) : null;
  const where = cursor ? 'AND (e.occurred_at<? OR (e.occurred_at=? AND e.cursor_ref<?))' : '';
  const args = cursor
    ? [input.workspaceId, campaign.id, cursor.occurredAt, cursor.occurredAt, cursor.cursorRef, limit + 1]
    : [input.workspaceId, campaign.id, limit + 1];
  const rows = await db.prepare(`SELECT e.occurred_at,e.cursor_ref,e.visitor_kind,l.label,l.destination_url,
      COALESCE(NULLIF(p.display_name,''),NULLIF(p.contact_name,''),'LINE member') person_label
    FROM campaign_click_events e JOIN campaign_tracked_links l
      ON l.workspace_id=e.workspace_id AND l.campaign_id=e.campaign_id AND l.id=e.tracked_link_id
    LEFT JOIN crm_profiles p ON p.crm_person_id=e.crm_person_id
    WHERE e.workspace_id=? AND e.campaign_id=? ${where}
    ORDER BY e.occurred_at DESC,e.cursor_ref DESC LIMIT ?`).bind(...args).all<Record<string, unknown>>();
  const result = rows.results || [];
  const page = result.slice(0, limit);
  const last = page[page.length - 1];
  return {
    clicks: page.map(row => ({
      occurredAt: row.occurred_at || null, trackedLinkLabel: clean(row.label, 120),
      visitorKind: clean(row.visitor_kind, 30),
      safePersonLabel: row.visitor_kind === 'KNOWN_CRM_PERSON' ? clean(row.person_label, 120) : null,
      destinationHost: destinationHost(row.destination_url),
    })),
    nextCursor: result.length > limit && last
      ? await encodeCursor(input.signingSecret, input.workspaceId, clean(campaign.id), String(last.occurred_at), clean(last.cursor_ref, 64))
      : null,
  };
}
