const encoder = new TextEncoder();
export const CONVERSION_REFERRAL_CONTEXT_TTL_SECONDS = 15 * 60;

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

export function createConversionReferralContextToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `smrc_${base64url(bytes)}`;
}

export async function conversionReferralContextFingerprint(secret: string, token: string) {
  if (!secret || !/^smrc_[A-Za-z0-9_-]{40,}$/.test(token)) throw new Error('CONVERSION_REFERRAL_CONTEXT_INVALID');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`conversion-referral-context\u001f${token}`));
  return [...new Uint8Array(signed)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function conversionReferralContextUsable(row: any, workspaceId: string, now = Date.now()) {
  if (!row || row.workspace_id !== workspaceId) return false;
  if (row.consumed_at || !row.expires_at || Date.parse(row.expires_at) <= now) return false;
  return row.referral_status === 'qualified';
}

export async function issueConversionReferralContext(db: D1Database, input: { secret: string; workspaceId: string; lineAccountId: string; memberId: string; now?: Date }) {
  const attribution: any = await db.prepare("SELECT id FROM member_referral_attributions WHERE workspace_id=? AND line_account_id=? AND invitee_member_id=? AND status='qualified' ORDER BY qualified_at DESC LIMIT 1").bind(input.workspaceId, input.lineAccountId, input.memberId).first();
  if (!attribution) return null;
  const token = createConversionReferralContextToken();
  const expiresAt = new Date((input.now || new Date()).getTime() + CONVERSION_REFERRAL_CONTEXT_TTL_SECONDS * 1000).toISOString();
  await db.prepare('INSERT INTO conversion_referral_contexts(id,workspace_id,line_account_id,member_referral_attribution_id,token_fingerprint,expires_at) VALUES(?,?,?,?,?,?)').bind(`crc_${crypto.randomUUID()}`, input.workspaceId, input.lineAccountId, attribution.id, await conversionReferralContextFingerprint(input.secret, token), expiresAt).run();
  return { token, expiresAt };
}

export async function resolveConversionReferralContext(db: D1Database, input: { secret: string; token?: string; workspaceId: string; now?: number }) {
  if (!input.token) return null;
  let fingerprint: string;
  try { fingerprint = await conversionReferralContextFingerprint(input.secret, input.token); } catch { return null; }
  const row: any = await db.prepare("SELECT c.id,c.workspace_id,c.line_account_id,c.member_referral_attribution_id,c.expires_at,c.consumed_at,a.status referral_status FROM conversion_referral_contexts c JOIN member_referral_attributions a ON a.id=c.member_referral_attribution_id AND a.workspace_id=c.workspace_id AND a.line_account_id=c.line_account_id WHERE c.workspace_id=? AND c.token_fingerprint=? LIMIT 1").bind(input.workspaceId, fingerprint).first();
  return conversionReferralContextUsable(row, input.workspaceId, input.now) ? row : null;
}

export async function establishConversionReferralEvidence(db: D1Database, input: { workspaceId: string; lineAccountId: string; conversionEventId: string; context: any }) {
  if (!input.context || input.context.workspace_id !== input.workspaceId || input.context.line_account_id !== input.lineAccountId) return false;
  const inserted: any = await db.prepare("INSERT INTO conversion_referral_evidence(id,workspace_id,line_account_id,conversion_event_id,member_referral_attribution_id,context_id,evidence_type) VALUES(?,?,?,?,?,?, 'SERVER_CONTEXT') ON CONFLICT DO NOTHING").bind(`cre_${crypto.randomUUID()}`, input.workspaceId, input.lineAccountId, input.conversionEventId, input.context.member_referral_attribution_id, input.context.id).run();
  if (Number(inserted?.meta?.changes || 0) !== 1) return false;
  await db.prepare('UPDATE conversion_referral_contexts SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND line_account_id=? AND consumed_at IS NULL').bind(input.context.id, input.workspaceId, input.lineAccountId).run();
  return true;
}
