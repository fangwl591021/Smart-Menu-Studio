const text = (value: unknown, max = 4096) => String(value ?? '').trim().slice(0, max);
const encoder = new TextEncoder();
const PURPOSE = 'dealer-settlement-payout-action:v1';
const HANDLE_TTL_SECONDS = 15 * 60;
const encode = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const decode = (value: string) => atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));

async function hmac(secret: string, parts: string[]) {
  if (!secret) throw new Error('DEALER_SETTLEMENT_HANDLE_SECRET_MISSING');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(parts.join('\u001f')));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function equal(left: string, right: string) { if (left.length !== right.length) return false; let diff = 0; for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index); return diff === 0; }

export type DealerSettlementHandleScope = { workspaceId: string; lineAccountId: string; dealerId: string; settlementId: string };
export async function dealerSettlementHandleReference(secret: string, scope: DealerSettlementHandleScope) { return hmac(secret, [PURPOSE, 'reference', text(scope.workspaceId, 120), text(scope.lineAccountId, 120), text(scope.dealerId, 120), text(scope.settlementId, 120)]); }
export async function createDealerSettlementHandle(secret: string, scope: DealerSettlementHandleScope, ttlSeconds = HANDLE_TTL_SECONDS) { const payload = { r: await dealerSettlementHandleReference(secret, scope), e: Math.floor(Date.now() / 1000) + ttlSeconds }; const encoded = encode(JSON.stringify(payload)); return `${encoded}.${await hmac(secret, [PURPOSE, 'signature', encoded])}`; }
export async function verifyDealerSettlementHandle(secret: string, token: string) { const [encoded, signature, ...extra] = text(token, 4096).split('.'); if (!encoded || !signature || extra.length) throw new Error('DEALER_SETTLEMENT_HANDLE_INVALID'); const expected = await hmac(secret, [PURPOSE, 'signature', encoded]); if (!equal(signature, expected)) throw new Error('DEALER_SETTLEMENT_HANDLE_INVALID'); let payload: any; try { payload = JSON.parse(decode(encoded)); } catch { throw new Error('DEALER_SETTLEMENT_HANDLE_INVALID'); } if (!/^[a-f0-9]{64}$/.test(text(payload?.r, 128)) || !Number.isInteger(payload?.e) || payload.e < Math.floor(Date.now() / 1000)) throw new Error('DEALER_SETTLEMENT_HANDLE_EXPIRED'); return { reference: text(payload.r, 128), expiresAt: new Date(payload.e * 1000).toISOString() }; }

export async function dealerFinalizedSettlementRows(db: D1Database, scope: { workspaceId: string; lineAccountId: string; dealerId: string; from?: string | null }) {
  const rows: any[] = (await db.prepare(`SELECT s.id settlement_id,p.period_start,p.period_end,p.finalized_at,s.snapshot_at,SUM(i.amount_minor) amount_minor,COUNT(i.id) entry_count
    FROM commission_settlement_items i JOIN commission_settlements s ON s.id=i.settlement_id JOIN commission_settlement_periods p ON p.id=s.settlement_period_id
    WHERE s.workspace_id=? AND s.line_account_id=? AND i.dealer_id=? AND s.status='FINALIZED' ${scope.from ? 'AND p.finalized_at>=?' : ''}
    GROUP BY s.id,p.period_start,p.period_end,p.finalized_at,s.snapshot_at ORDER BY p.finalized_at DESC,s.id DESC`).bind(...(scope.from ? [scope.workspaceId, scope.lineAccountId, scope.dealerId, scope.from] : [scope.workspaceId, scope.lineAccountId, scope.dealerId])).all()).results || [];
  return rows.map(row => ({ settlementId: text(row.settlement_id, 120), periodStart: text(row.period_start, 40), periodEnd: text(row.period_end, 40), finalizedAt: row.finalized_at || null, snapshotAt: row.snapshot_at || null, amountMinor: Number(row.amount_minor || 0), currencyCode: 'TWD', entryCount: Number(row.entry_count || 0) }));
}
export const publicDealerSettlementRow = (row: { periodStart: string; periodEnd: string; finalizedAt: unknown; snapshotAt: unknown; amountMinor: number; currencyCode: string; entryCount: number; settlementHandle: string }) => ({ periodStart: row.periodStart, periodEnd: row.periodEnd, finalizedAt: row.finalizedAt || null, snapshotAt: row.snapshotAt || null, amountMinor: row.amountMinor, currencyCode: row.currencyCode, entryCount: row.entryCount, settlementHandle: row.settlementHandle });
