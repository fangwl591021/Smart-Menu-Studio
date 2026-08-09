const text = (value: unknown, max = 4096) => String(value ?? '').trim().slice(0, max);
const encoder = new TextEncoder();
const PURPOSE = 'dealer-payout-request-action:v1';
const HANDLE_TTL_SECONDS = 15 * 60;
const encode = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const decode = (value: string) => atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));

async function hmac(secret: string, parts: string[]) {
  if (!secret) throw new Error('DEALER_PAYOUT_REQUEST_HANDLE_SECRET_MISSING');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(parts.join('\u001f')));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function equal(left: string, right: string) { if (left.length !== right.length) return false; let diff = 0; for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index); return diff === 0; }

export type DealerPayoutRequestHandleScope = { workspaceId: string; lineAccountId: string; dealerId: string; payoutRequestId: string };
export async function dealerPayoutRequestHandleReference(secret: string, scope: DealerPayoutRequestHandleScope) { return hmac(secret, [PURPOSE, 'reference', text(scope.workspaceId, 120), text(scope.lineAccountId, 120), text(scope.dealerId, 120), text(scope.payoutRequestId, 120)]); }
export async function createDealerPayoutRequestHandle(secret: string, scope: DealerPayoutRequestHandleScope, ttlSeconds = HANDLE_TTL_SECONDS) { const payload = { r: await dealerPayoutRequestHandleReference(secret, scope), e: Math.floor(Date.now() / 1000) + ttlSeconds }; const encoded = encode(JSON.stringify(payload)); return `${encoded}.${await hmac(secret, [PURPOSE, 'signature', encoded])}`; }
export async function verifyDealerPayoutRequestHandle(secret: string, token: string) { const [encoded, signature, ...extra] = text(token, 4096).split('.'); if (!encoded || !signature || extra.length) throw new Error('DEALER_PAYOUT_REQUEST_HANDLE_INVALID'); const expected = await hmac(secret, [PURPOSE, 'signature', encoded]); if (!equal(signature, expected)) throw new Error('DEALER_PAYOUT_REQUEST_HANDLE_INVALID'); let payload: any; try { payload = JSON.parse(decode(encoded)); } catch { throw new Error('DEALER_PAYOUT_REQUEST_HANDLE_INVALID'); } if (!/^[a-f0-9]{64}$/.test(text(payload?.r, 128))) throw new Error('DEALER_PAYOUT_REQUEST_HANDLE_INVALID'); if (!Number.isInteger(payload?.e) || payload.e < Math.floor(Date.now() / 1000)) throw new Error('DEALER_PAYOUT_REQUEST_HANDLE_EXPIRED'); return { reference: text(payload.r, 128), expiresAt: new Date(payload.e * 1000).toISOString() }; }

