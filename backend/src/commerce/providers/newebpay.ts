export type NewebPayConfig = {
  merchantId: string;
  hashKey: string;
  hashIv: string;
  mode: 'test' | 'production';
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => new Uint8Array((value.match(/.{2}/g) || []).map(v => parseInt(v, 16)));

export function newebpayConfig(env: Record<string, unknown>): NewebPayConfig {
  const merchantId = String(env.NEWEBPAY_MERCHANT_ID || '').trim();
  const hashKey = String(env.NEWEBPAY_HASH_KEY || '');
  const hashIv = String(env.NEWEBPAY_HASH_IV || '');
  const mode = String(env.NEWEBPAY_MODE || 'test').toLowerCase();
  if (!merchantId || hashKey.length !== 32 || hashIv.length !== 16 || !['test', 'production'].includes(mode)) {
    throw new Error('COMMERCE_PAYMENT_PROVIDER_UNAVAILABLE');
  }
  return { merchantId, hashKey, hashIv, mode: mode as NewebPayConfig['mode'] };
}

export const gatewayUrl = (mode: NewebPayConfig['mode']) => mode === 'production'
  ? 'https://core.newebpay.com/MPG/mpg_gateway'
  : 'https://ccore.newebpay.com/MPG/mpg_gateway';

export async function sha256Hex(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function aesKey(config: NewebPayConfig) {
  return crypto.subtle.importKey('raw', encoder.encode(config.hashKey), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

export async function encryptTradeInfo(plain: string, config: NewebPayConfig) {
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: encoder.encode(config.hashIv) },
    await aesKey(config),
    encoder.encode(plain),
  );
  return hex(new Uint8Array(encrypted));
}

export async function decryptTradeInfo(value: string, config: NewebPayConfig) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 32 !== 0) throw new Error('COMMERCE_PAYMENT_CALLBACK_INVALID');
  try {
    return decoder.decode(await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: encoder.encode(config.hashIv) },
      await aesKey(config),
      unhex(value),
    ));
  } catch {
    throw new Error('COMMERCE_PAYMENT_CALLBACK_INVALID');
  }
}

export async function tradeSha(tradeInfo: string, config: NewebPayConfig) {
  return (await sha256Hex(`HashKey=${config.hashKey}&${tradeInfo}&HashIV=${config.hashIv}`)).toUpperCase();
}

export function timingSafeTextEqual(a: string, b: string) {
  const aa = encoder.encode(a.toUpperCase());
  const bb = encoder.encode(b.toUpperCase());
  let diff = aa.length ^ bb.length;
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i += 1) diff |= (aa[i % Math.max(aa.length, 1)] || 0) ^ (bb[i % Math.max(bb.length, 1)] || 0);
  return diff === 0;
}

export function parseCallbackPayload(plain: string): Record<string, unknown> {
  const trimmed = plain.trim();
  if (!trimmed) throw new Error('COMMERCE_PAYMENT_CALLBACK_INVALID');
  try {
    const value = JSON.parse(trimmed);
    return typeof value.Result === 'object' && value.Result
      ? { ...value.Result, Status: value.Status, Message: value.Message }
      : value;
  } catch {
    return Object.fromEntries(new URLSearchParams(trimmed));
  }
}

export async function createCheckout(input: {
  config: NewebPayConfig;
  merchantOrderNo: string;
  amountMinor: number;
  itemDescription: string;
  notifyUrl: string;
  returnUrl?: string;
  timestamp?: number;
}) {
  const params = new URLSearchParams({
    MerchantID: input.config.merchantId,
    RespondType: 'JSON',
    TimeStamp: String(input.timestamp || Math.floor(Date.now() / 1000)),
    Version: '2.0',
    MerchantOrderNo: input.merchantOrderNo,
    Amt: String(input.amountMinor),
    ItemDesc: input.itemDescription.slice(0, 50),
    NotifyURL: input.notifyUrl,
    CREDIT: '1',
  });
  if (input.returnUrl) params.set('ReturnURL', input.returnUrl);
  const tradeInfo = await encryptTradeInfo(params.toString(), input.config);
  return {
    gatewayUrl: gatewayUrl(input.config.mode),
    MerchantID: input.config.merchantId,
    TradeInfo: tradeInfo,
    TradeSha: await tradeSha(tradeInfo, input.config),
    Version: '2.0',
  };
}

export async function verifyCallback(input: { tradeInfo: string; tradeShaValue: string; config: NewebPayConfig }) {
  const expected = await tradeSha(input.tradeInfo, input.config);
  if (!timingSafeTextEqual(expected, input.tradeShaValue)) throw new Error('COMMERCE_PAYMENT_CALLBACK_SIGNATURE_INVALID');
  return parseCallbackPayload(await decryptTradeInfo(input.tradeInfo, input.config));
}
