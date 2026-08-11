import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCheckout, decryptTradeInfo, newebpayConfig, parseCallbackPayload, tradeSha, verifyCallback } from '../src/commerce/providers/newebpay.ts';

const migration = await readFile(new URL('../migrations/0046_commerce_order_payment.sql', import.meta.url), 'utf8');
const domain = await readFile(new URL('../src/commerce/commerce.ts', import.meta.url), 'utf8');
const paymentObligations = await readFile(new URL('../src/commerce/payment-obligations.ts', import.meta.url), 'utf8');
const routes = await readFile(new URL('../src/commerce/routes.ts', import.meta.url), 'utf8');
const provider = await readFile(new URL('../src/commerce/providers/newebpay.ts', import.meta.url), 'utf8');
const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const config = { merchantId: 'MS123456789', hashKey: '12345678901234567890123456789012', hashIv: '1234567890123456', mode: 'test' };

const contracts = [
  ['0046 is additive', migration, /Additive only; no backfill or seed data/],
  ['products table', migration, /CREATE TABLE IF NOT EXISTS commerce_products/],
  ['orders table', migration, /CREATE TABLE IF NOT EXISTS commerce_orders/],
  ['order items table', migration, /CREATE TABLE IF NOT EXISTS commerce_order_items/],
  ['payment intents table', migration, /CREATE TABLE IF NOT EXISTS commerce_payment_intents/],
  ['payment transactions table', migration, /CREATE TABLE IF NOT EXISTS commerce_payment_transactions/],
  ['product workspace scope', migration, /UNIQUE\(workspace_id,sku\)/],
  ['product opaque reference', migration, /commerce_products[\s\S]*public_ref TEXT NOT NULL UNIQUE/],
  ['product status allowlist', migration, /'DRAFT','ACTIVE','ARCHIVED'/],
  ['integer price bound', migration, /price_amount_minor INTEGER NOT NULL CHECK\(price_amount_minor BETWEEN 1 AND 100000000\)/],
  ['TWD only products', migration, /currency_code='TWD'/],
  ['order state allowlist', migration, /'DRAFT','PENDING_PAYMENT','PAID','CANCELLED','PAYMENT_FAILED'/],
  ['payment state allowlist', migration, /'UNPAID','PENDING','PAID','FAILED','CANCELLED'/],
  ['server total invariant', migration, /total_amount_minor=subtotal_amount_minor-discount_amount_minor/],
  ['discount disabled', migration, /discount_amount_minor=0/],
  ['item quantity bound', migration, /quantity BETWEEN 1 AND 100/],
  ['line total invariant', migration, /line_amount_minor=unit_amount_minor\*quantity/],
  ['item product scoped FK', migration, /FOREIGN KEY\(workspace_id,product_id\)/],
  ['item update immutable', migration, /commerce_order_items_no_update/],
  ['item delete immutable', migration, /commerce_order_items_no_delete/],
  ['order PAID terminal', migration, /commerce_orders_paid_terminal/],
  ['intent provider fixed', migration, /provider='NEWEBPAY'/],
  ['intent merchant order unique', migration, /merchant_order_no TEXT NOT NULL UNIQUE/],
  ['one pending intent', migration, /idx_commerce_payment_one_pending/],
  ['intent binding immutable', migration, /commerce_payment_intents_binding_immutable/],
  ['intent PAID terminal', migration, /commerce_payment_intents_paid_terminal/],
  ['callback hash unique', migration, /UNIQUE\(provider,callback_hash\)/],
  ['transaction update immutable', migration, /commerce_payment_transactions_no_update/],
  ['transaction delete immutable', migration, /commerce_payment_transactions_no_delete/],
  ['no raw TradeInfo column', migration, /^(?![\s\S]*trade_info)/i],
  ['no card field', migration, /^(?![\s\S]*(card_number|credit_card|pan TEXT))/i],
  ['strict product keys', domain, /exactKeys\(input\.body, \['sku','name','description','priceAmountMinor','currencyCode'\]/],
  ['SKU normalization', domain, /toUpperCase\(\)/],
  ['SKU validation', domain, /\^\[A-Z0-9\]/],
  ['product archive is terminal', domain, /COMMERCE_PRODUCT_ARCHIVED/],
  ['order only accepts items', domain, /exactKeys\(input\.body, \['items'\]/],
  ['order item strict shape', domain, /\['safeProductReference','quantity'\]/],
  ['duplicate products rejected', domain, /seen\.has\(ref\)/],
  ['active product authority', domain, /status='ACTIVE'/],
  ['order total computed server side', domain, /total\+=line/],
  ['order batch snapshot', domain, /db\.batch\(statements\)/],
  ['paid order cannot cancel', domain, /if\(order\.payment_status==='PAID'\)/],
  ['provider config from env', provider, /NEWEBPAY_MERCHANT_ID/],
  ['strict key length', provider, /hashKey\.length !== 32/],
  ['strict IV length', provider, /hashIv\.length !== 16/],
  ['test gateway', provider, /ccore\.newebpay\.com/],
  ['production gateway', provider, /core\.newebpay\.com/],
  ['AES CBC', provider, /AES-CBC/],
  ['SHA-256 TradeSha', provider, /SHA-256/],
  ['callback signature checked', provider, /timingSafeTextEqual/],
  ['callback amount checked', domain, /amountValue===Number\(intent\.amount_minor\)/],
  ['callback merchant checked', domain, /MerchantID.*intent\.merchant_id/],
  ['duplicate callback idempotent', domain, /idempotent:true/],
  ['callback only writes paid state through obligation authority', `${domain}\n${paymentObligations}`, /UPDATE commerce_orders SET status='PAID'/],
  ['browser return absent as mutation route', routes, /^(?![\s\S]*payments\/newebpay\/return)/],
  ['callback body bounded', routes, /65536/],
  ['callback is exact auth exemption', index, /c\.req\.path === '\/api\/commerce\/payments\/newebpay\/notify'/],
  ['Tenant viewer reads', routes, /requireRole\(c,'viewer'\)/],
  ['Tenant admin writes', routes, /requireRole\(c,'admin'\)/],
  ['no member commerce route', routes, /^(?![\s\S]*\/api\/member\/commerce)/],
  ['no campaign mutation', domain, /^(?![\s\S]*(UPDATE|INSERT INTO) campaigns\b)/i],
  ['no points mutation', domain, /^(?![\s\S]*(UPDATE|INSERT INTO) points\b)/i],
  ['no referral mutation', domain, /^(?![\s\S]*(UPDATE|INSERT INTO) referral\b)/i],
  ['no commission mutation', domain, /^(?![\s\S]*(UPDATE|INSERT INTO) commission\b)/i],
];

for (const [name, source, pattern] of contracts) test(name, () => assert.match(source, pattern));

test('provider config rejects missing secret', () => assert.throws(() => newebpayConfig({}), /PROVIDER_UNAVAILABLE/));
test('TradeInfo encrypts and decrypts', async () => { const checkout = await createCheckout({ config, merchantOrderNo:'SMS123', amountMinor:100, itemDescription:'item', notifyUrl:'https://example.com/notify', timestamp:1 }); assert.match(checkout.TradeInfo,/^[0-9a-f]+$/); assert.match(await decryptTradeInfo(checkout.TradeInfo,config),/Amt=100/); });
test('TradeSha verifies authentic callback', async () => { const checkout=await createCheckout({config,merchantOrderNo:'SMS124',amountMinor:100,itemDescription:'item',notifyUrl:'https://example.com/notify',timestamp:1}); const value=await verifyCallback({tradeInfo:checkout.TradeInfo,tradeShaValue:checkout.TradeSha,config}); assert.equal(value.MerchantOrderNo,'SMS124'); });
test('TradeSha rejects tampering', async () => { const checkout=await createCheckout({config,merchantOrderNo:'SMS125',amountMinor:100,itemDescription:'item',notifyUrl:'https://example.com/notify',timestamp:1}); await assert.rejects(()=>verifyCallback({tradeInfo:checkout.TradeInfo,tradeShaValue:'0'.repeat(64),config}),/SIGNATURE_INVALID/); });
test('JSON callback result is normalized', () => assert.deepEqual(parseCallbackPayload('{"Status":"SUCCESS","Result":{"Amt":100}}'),{Amt:100,Status:'SUCCESS',Message:undefined}));
test('form callback result is normalized', () => assert.deepEqual(parseCallbackPayload('Amt=100&Status=SUCCESS'),{Amt:'100',Status:'SUCCESS'}));
test('TradeSha is uppercase SHA-256', async () => assert.match(await tradeSha('abc',config),/^[0-9A-F]{64}$/));
