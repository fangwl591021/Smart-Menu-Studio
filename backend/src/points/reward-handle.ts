const encoder = new TextEncoder();
const PURPOSE = 'member-reward-redemption-action:v1';
const TTL_SECONDS = 15 * 60;
const text = (value: unknown, max = 4096) => String(value ?? '').trim().slice(0, max);
const encode = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const decode = (value: string) => atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));

async function hmac(secret: string, parts: string[]) {
  if (!secret) throw new Error('REWARD_HANDLE_SECRET_MISSING');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(parts.join('\u001f')));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function equal(left: string, right: string) { if (left.length !== right.length) return false; let diff = 0; for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i); return diff === 0; }

export type RewardHandleScope = {
  workspaceId: string;
  lineAccountId: string;
  memberId: string;
  rewardId: string;
  rewardVersionId: string;
};

export async function rewardHandleReference(secret: string, scope: RewardHandleScope) {
  return hmac(secret, [PURPOSE, 'reward-reference', text(scope.workspaceId,120), text(scope.lineAccountId,120), text(scope.memberId,120), text(scope.rewardId,120), text(scope.rewardVersionId,120)]);
}

export async function createRewardHandle(secret: string, scope: RewardHandleScope, ttlSeconds = TTL_SECONDS) {
  const payload = {
    r: await rewardHandleReference(secret, scope),
    j: crypto.randomUUID(),
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${await hmac(secret, [PURPOSE, 'signature', encoded])}`;
}

export async function verifyRewardHandle(secret: string, token: string) {
  const [encoded, signature, ...extra] = text(token).split('.');
  if (!encoded || !signature || extra.length) throw new Error('REWARD_HANDLE_INVALID');
  const expected = await hmac(secret, [PURPOSE, 'signature', encoded]);
  if (!equal(signature, expected)) throw new Error('REWARD_HANDLE_INVALID');
  let payload: any;
  try { payload = JSON.parse(decode(encoded)); } catch { throw new Error('REWARD_HANDLE_INVALID'); }
  if (!/^[a-f0-9]{64}$/.test(text(payload?.r,128))) throw new Error('REWARD_HANDLE_INVALID');
  if (!/^[0-9a-f-]{36}$/i.test(text(payload?.j,64))) throw new Error('REWARD_HANDLE_INVALID');
  if (!Number.isInteger(payload?.e) || payload.e < Math.floor(Date.now() / 1000)) throw new Error('REWARD_HANDLE_EXPIRED');
  return {
    rewardReference: text(payload.r,128),
    actionReference: await hmac(secret, [PURPOSE, 'action-reference', text(payload.j,64)]),
    expiresAt: new Date(payload.e * 1000).toISOString(),
  };
}
