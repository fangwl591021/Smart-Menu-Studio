import { establishCommissionAttribution } from '../commission/attribution.ts';
import {
  CONVERSION_REFERRAL_CONTEXT_TTL_SECONDS,
  conversionReferralContextFingerprint,
  createConversionReferralContextToken,
  establishConversionReferralEvidence,
} from '../commission/evidence-bridge.ts';

const encoder = new TextEncoder();
const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const now = () => new Date().toISOString();

async function hmacHex(secret: string, purpose: string, values: readonly string[]) {
  if (!secret) throw new Error('TRAVEL_SELLER_REFERENCE_UNAVAILABLE');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode([purpose, ...values].join('\u001f')));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function travelSellerReference(secret: string, input: { workspaceId: string; lineAccountId: string; dealerId: string }) {
  return `tsr_${await hmacHex(secret, 'travel-seller-reference-v1', [input.workspaceId, input.lineAccountId, input.dealerId])}`;
}

function sellerLabel(reference: string) {
  return `Travel seller ${reference.slice(-6).toUpperCase()}`;
}

function publicSeller(row: any, safeSellerReference: string) {
  const permissionStatus = row.permission_status === 'ACTIVE' || row.permission_status === 'REVOKED' ? row.permission_status : 'NOT_GRANTED';
  return {
    safeSellerReference,
    sellerLabel: sellerLabel(safeSellerReference),
    permissionStatus,
    sellerEligible: row.dealer_status === 'ACTIVE' && permissionStatus === 'ACTIVE',
    createdAt: row.permission_created_at || null,
    revokedAt: row.permission_revoked_at || null,
  };
}

async function scopedDealerRows(db: D1Database, workspaceId: string, lineAccountId: string) {
  const account = await db.prepare('SELECT id FROM workspace_line_accounts WHERE id=? AND workspace_id=? LIMIT 1').bind(lineAccountId, workspaceId).first();
  if (!account) throw new Error('TRAVEL_LINE_ACCOUNT_NOT_FOUND');
  return ((await db.prepare(`
    SELECT d.id,d.status dealer_status,p.id permission_id,p.status permission_status,
      p.created_at permission_created_at,p.revoked_at permission_revoked_at
    FROM line_oa_dealers d
    LEFT JOIN travel_seller_permissions p
      ON p.workspace_id=d.workspace_id AND p.line_account_id=d.line_account_id AND p.dealer_id=d.id
    WHERE d.workspace_id=? AND d.line_account_id=?
    ORDER BY d.applied_at ASC,d.id ASC
  `).bind(workspaceId, lineAccountId).all<any>()).results || []);
}

async function dealerForReference(db: D1Database, input: { secret: string; workspaceId: string; lineAccountId: string; safeSellerReference: string }) {
  if (!/^tsr_[a-f0-9]{64}$/.test(input.safeSellerReference)) throw new Error('TRAVEL_SELLER_NOT_FOUND');
  const rows = await scopedDealerRows(db, input.workspaceId, input.lineAccountId);
  for (const row of rows) {
    const reference = await travelSellerReference(input.secret, { workspaceId: input.workspaceId, lineAccountId: input.lineAccountId, dealerId: String(row.id) });
    if (reference === input.safeSellerReference) return { row, reference };
  }
  throw new Error('TRAVEL_SELLER_NOT_FOUND');
}

export async function listTravelSellers(db: D1Database, input: { secret: string; workspaceId: string; lineAccountId: string }) {
  const rows = await scopedDealerRows(db, input.workspaceId, input.lineAccountId);
  return Promise.all(rows.map(async row => publicSeller(row, await travelSellerReference(input.secret, {
    workspaceId: input.workspaceId,
    lineAccountId: input.lineAccountId,
    dealerId: String(row.id),
  }))));
}

export async function grantTravelSellerPermission(db: D1Database, input: {
  secret: string;
  workspaceId: string;
  lineAccountId: string;
  safeSellerReference: string;
  actorUserId?: string | null;
}) {
  const found = await dealerForReference(db, input);
  if (found.row.dealer_status !== 'ACTIVE') throw new Error('TRAVEL_SELLER_DEALER_NOT_ACTIVE');
  if (found.row.permission_status === 'ACTIVE') return { ...publicSeller(found.row, found.reference), idempotent: true };
  const timestamp = now(), permissionId = found.row.permission_id || makeId('tsp');
  const permissionStatement = found.row.permission_id
    ? db.prepare(`UPDATE travel_seller_permissions
        SET status='ACTIVE',revoked_by_user_id=NULL,revoked_at=NULL,updated_at=?
        WHERE id=? AND workspace_id=? AND line_account_id=? AND dealer_id=? AND status='REVOKED'`)
      .bind(timestamp, permissionId, input.workspaceId, input.lineAccountId, found.row.id)
    : db.prepare(`INSERT INTO travel_seller_permissions(
        id,workspace_id,line_account_id,dealer_id,status,created_by_user_id,created_at,updated_at
      ) VALUES(?,?,?,?,'ACTIVE',?,?,?)`)
      .bind(permissionId, input.workspaceId, input.lineAccountId, found.row.id, input.actorUserId || null, timestamp, timestamp);
  await db.batch([
    permissionStatement,
    db.prepare(`INSERT INTO travel_seller_bridge_events(
      id,workspace_id,line_account_id,permission_id,event_type,actor_type,actor_user_id,dedupe_key,occurred_at,created_at
    ) VALUES(?,?,?,?,'TRAVEL_SELLER_PERMISSION_GRANTED','TENANT_USER',?,?,?,?)`)
      .bind(makeId('tsbe'), input.workspaceId, input.lineAccountId, permissionId, input.actorUserId || null,
        `travel-seller-permission:${permissionId}:grant:${timestamp}`, timestamp, timestamp),
  ]);
  const row = await db.prepare(`SELECT d.status dealer_status,p.status permission_status,p.created_at permission_created_at,p.revoked_at permission_revoked_at
    FROM travel_seller_permissions p JOIN line_oa_dealers d ON d.id=p.dealer_id
    WHERE p.id=? AND p.workspace_id=? AND p.line_account_id=? LIMIT 1`).bind(permissionId, input.workspaceId, input.lineAccountId).first<any>();
  return { ...publicSeller(row, found.reference), idempotent: false };
}

export async function revokeTravelSellerPermission(db: D1Database, input: {
  secret: string;
  workspaceId: string;
  lineAccountId: string;
  safeSellerReference: string;
  actorUserId?: string | null;
}) {
  const found = await dealerForReference(db, input);
  if (!found.row.permission_id) throw new Error('TRAVEL_SELLER_PERMISSION_NOT_FOUND');
  if (found.row.permission_status === 'REVOKED') return { ...publicSeller(found.row, found.reference), idempotent: true };
  const timestamp = now();
  await db.batch([
    db.prepare(`UPDATE travel_seller_permissions
      SET status='REVOKED',revoked_by_user_id=?,revoked_at=?,updated_at=?
      WHERE id=? AND workspace_id=? AND line_account_id=? AND dealer_id=? AND status='ACTIVE'`)
      .bind(input.actorUserId || null, timestamp, timestamp, found.row.permission_id, input.workspaceId, input.lineAccountId, found.row.id),
    db.prepare(`INSERT INTO travel_seller_bridge_events(
      id,workspace_id,line_account_id,permission_id,event_type,actor_type,actor_user_id,dedupe_key,occurred_at,created_at
    ) VALUES(?,?,?,?,'TRAVEL_SELLER_PERMISSION_REVOKED','TENANT_USER',?,?,?,?)`)
      .bind(makeId('tsbe'), input.workspaceId, input.lineAccountId, found.row.permission_id, input.actorUserId || null,
        `travel-seller-permission:${found.row.permission_id}:revoke:${timestamp}`, timestamp, timestamp),
  ]);
  return {
    ...publicSeller({ ...found.row, permission_status: 'REVOKED', permission_revoked_at: timestamp }, found.reference),
    idempotent: false,
  };
}

export async function resolveTrustedTravelSellerAttribution(db: D1Database, input: {
  secret: string;
  workspaceId: string;
  lineAccountId: string;
  inviteeMemberId: string;
  occurredAt: string;
}) {
  const row: any = await db.prepare(`
    SELECT r.id member_referral_attribution_id,d.id seller_dealer_id,p.id seller_permission_id
    FROM member_referral_attributions r
    JOIN line_oa_dealers d
      ON d.workspace_id=r.workspace_id AND d.line_account_id=r.line_account_id
     AND d.member_id=r.inviter_member_id AND d.status='ACTIVE'
    JOIN travel_seller_permissions p
      ON p.workspace_id=d.workspace_id AND p.line_account_id=d.line_account_id
     AND p.dealer_id=d.id AND p.status='ACTIVE'
    WHERE r.workspace_id=? AND r.line_account_id=? AND r.invitee_member_id=?
      AND r.status='qualified' AND datetime(r.qualified_at)<=datetime(?)
    ORDER BY r.qualified_at DESC,r.id DESC LIMIT 1
  `).bind(input.workspaceId, input.lineAccountId, input.inviteeMemberId, input.occurredAt).first();
  if (!row) return null;
  const safeSellerReference = await travelSellerReference(input.secret, {
    workspaceId: input.workspaceId,
    lineAccountId: input.lineAccountId,
    dealerId: String(row.seller_dealer_id),
  });
  return {
    sellerDealerId: String(row.seller_dealer_id),
    sellerPermissionId: String(row.seller_permission_id),
    memberReferralAttributionId: String(row.member_referral_attribution_id),
    safeSellerReference,
    sellerLabel: sellerLabel(safeSellerReference),
  };
}

export function travelSellerSnapshotStatements(db: D1Database, input: {
  workspaceId: string;
  lineAccountId: string;
  bookingId: string;
  amountMinor: number;
  currencyCode: 'TWD';
  attributedAt: string;
  seller: NonNullable<Awaited<ReturnType<typeof resolveTrustedTravelSellerAttribution>>>;
}) {
  const contextId = makeId('tbsc');
  return [
    db.prepare(`INSERT INTO travel_booking_seller_contexts(
      id,workspace_id,line_account_id,booking_id,seller_dealer_id,seller_permission_id,
      member_referral_attribution_id,safe_seller_reference_snapshot,seller_label_snapshot,
      commissionable_amount_minor_snapshot,currency_code_snapshot,attributed_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,'TWD',?,?)`).bind(
      contextId, input.workspaceId, input.lineAccountId, input.bookingId, input.seller.sellerDealerId,
      input.seller.sellerPermissionId, input.seller.memberReferralAttributionId, input.seller.safeSellerReference,
      input.seller.sellerLabel, input.amountMinor, input.attributedAt, input.attributedAt,
    ),
    db.prepare(`INSERT INTO travel_seller_bridge_events(
      id,workspace_id,line_account_id,booking_id,event_type,actor_type,dedupe_key,occurred_at,created_at
    ) VALUES(?,?,?,?,'TRAVEL_SELLER_ATTRIBUTION_FROZEN','SYSTEM',?,?,?)`).bind(
      makeId('tsbe'), input.workspaceId, input.lineAccountId, input.bookingId,
      `travel-seller-attribution:${input.bookingId}`, input.attributedAt, input.attributedAt,
    ),
  ];
}

export async function projectTravelCommissionEligibility(db: D1Database, input: {
  secret: string;
  workspaceId: string;
  orderId: string;
  occurredAt: string;
}) {
  const context: any = await db.prepare(`
    SELECT s.booking_id,s.line_account_id,s.seller_dealer_id,s.member_referral_attribution_id,
      s.commissionable_amount_minor_snapshot,s.currency_code_snapshot,
      b.booking_status,o.status order_status,o.payment_status
    FROM travel_booking_seller_contexts s
    JOIN travel_booking_extensions b ON b.workspace_id=s.workspace_id AND b.id=s.booking_id AND b.order_id=?
    JOIN commerce_orders o ON o.workspace_id=b.workspace_id AND o.id=b.order_id
    WHERE s.workspace_id=? LIMIT 1
  `).bind(input.orderId, input.workspaceId).first();
  if (!context) return { projected: false, reason: 'NO_SELLER_ATTRIBUTION' as const };
  if (context.booking_status === 'CANCELLED' || context.order_status !== 'PAID' || context.payment_status !== 'PAID') {
    return { projected: false, reason: 'ORDER_NOT_FULLY_SETTLED' as const };
  }
  const externalEventId = `travel-booking-fully-settled:${context.booking_id}`;
  const conversionEventId = makeId('lce');
  await db.prepare(`INSERT INTO line_conversion_events(
    id,workspace_id,line_account_id,external_event_id,conversion_type,conversion_source,
    attribution_model,value_minor,currency,mapping_status,occurred_at,created_at
  ) VALUES(?,?,?,?,?,'TRAVEL','last_observed_touch',?,'TWD','unmatched',?,?)
  ON CONFLICT(workspace_id,external_event_id) DO NOTHING`).bind(
    conversionEventId, input.workspaceId, context.line_account_id, externalEventId,
    'TRAVEL_BOOKING_FULLY_SETTLED', Number(context.commissionable_amount_minor_snapshot), input.occurredAt, input.occurredAt,
  ).run();
  const conversion: any = await db.prepare(`SELECT id,line_account_id,conversion_type,conversion_source,value_minor,currency
    FROM line_conversion_events WHERE workspace_id=? AND external_event_id=? LIMIT 1`).bind(input.workspaceId, externalEventId).first();
  if (!conversion || conversion.line_account_id !== context.line_account_id || conversion.conversion_type !== 'TRAVEL_BOOKING_FULLY_SETTLED'
    || conversion.conversion_source !== 'TRAVEL' || Number(conversion.value_minor) !== Number(context.commissionable_amount_minor_snapshot)
    || conversion.currency !== context.currency_code_snapshot) throw new Error('TRAVEL_COMMISSION_CONTEXT_CONFLICT');

  let evidence: any = await db.prepare(`SELECT id FROM conversion_referral_evidence
    WHERE workspace_id=? AND line_account_id=? AND conversion_event_id=? LIMIT 1`).bind(
    input.workspaceId, context.line_account_id, conversion.id,
  ).first();
  if (!evidence) {
    const token = createConversionReferralContextToken();
    const contextId = makeId('crc');
    const expiresAt = new Date(Date.parse(input.occurredAt) + CONVERSION_REFERRAL_CONTEXT_TTL_SECONDS * 1000).toISOString();
    await db.prepare(`INSERT INTO conversion_referral_contexts(
      id,workspace_id,line_account_id,member_referral_attribution_id,token_fingerprint,issued_at,expires_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`).bind(
      contextId, input.workspaceId, context.line_account_id, context.member_referral_attribution_id,
      await conversionReferralContextFingerprint(input.secret, token), input.occurredAt, expiresAt, input.occurredAt,
    ).run();
    const evidenceId = await establishConversionReferralEvidence(db, {
      workspaceId: input.workspaceId,
      lineAccountId: String(context.line_account_id),
      conversionEventId: String(conversion.id),
      context: {
        id: contextId,
        workspace_id: input.workspaceId,
        line_account_id: String(context.line_account_id),
        member_referral_attribution_id: String(context.member_referral_attribution_id),
      },
    });
    evidence = evidenceId ? { id: evidenceId } : await db.prepare(`SELECT id FROM conversion_referral_evidence
      WHERE workspace_id=? AND line_account_id=? AND conversion_event_id=? LIMIT 1`).bind(
      input.workspaceId, context.line_account_id, conversion.id,
    ).first();
  }
  if (!evidence) throw new Error('TRAVEL_COMMISSION_EVIDENCE_FAILED');
  const decision = await establishCommissionAttribution(db, {
    workspaceId: input.workspaceId,
    lineAccountId: String(context.line_account_id),
    conversionReferralEvidenceId: String(evidence.id),
  });
  await db.prepare(`INSERT INTO travel_seller_bridge_events(
    id,workspace_id,line_account_id,booking_id,event_type,actor_type,reason_code,dedupe_key,occurred_at,created_at
  ) VALUES(?,?,?,?,'TRAVEL_COMMISSION_ELIGIBILITY_PROJECTED','SYSTEM',?,?,?,?)
  ON CONFLICT(workspace_id,dedupe_key) DO NOTHING`).bind(
    makeId('tsbe'), input.workspaceId, context.line_account_id, context.booking_id, decision.reason,
    `travel-commission-eligibility:${context.booking_id}`, input.occurredAt, input.occurredAt,
  ).run();
  return { projected: true, reason: decision.reason };
}
