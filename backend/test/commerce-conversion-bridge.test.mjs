import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPaidOrderConversionStatement, listConversions, readConversion } from '../src/commerce/conversions.ts';

const migration = await readFile(new URL('../migrations/0048_commerce_conversion_bridge.sql', import.meta.url), 'utf8');
const conversions = await readFile(new URL('../src/commerce/conversions.ts', import.meta.url), 'utf8');
const commerce = await readFile(new URL('../src/commerce/commerce.ts', import.meta.url), 'utf8');
const routes = await readFile(new URL('../src/commerce/routes.ts', import.meta.url), 'utf8');
const all = migration + '\n' + conversions + '\n' + commerce + '\n' + routes;

const contracts = [
  ['01 additive migration', migration, /Additive only/],
  ['02 no backfill contract', migration, /no backfill/],
  ['03 no seed contract', migration, /seed/],
  ['04 no fake conversion contract', migration, /fake conversion data/],
  ['05 conversion table', migration, /CREATE TABLE IF NOT EXISTS commerce_conversion_events/],
  ['06 workspace required', migration, /workspace_id TEXT NOT NULL/],
  ['07 order required', migration, /order_id TEXT NOT NULL/],
  ['08 optional CRM person link', migration, /crm_person_id TEXT,/],
  ['09 ORDER_PAID allowlist', migration, /CHECK\(conversion_type='ORDER_PAID'\)/],
  ['10 positive integer value', migration, /amount_minor BETWEEN 1 AND 100000000/],
  ['11 TWD only', migration, /CHECK\(currency_code='TWD'\)/],
  ['12 direct commerce source', migration, /CHECK\(source_kind='DIRECT_COMMERCE'\)/],
  ['13 customer label snapshot', migration, /customer_label_snapshot TEXT NOT NULL/],
  ['14 workspace order FK', migration, /FOREIGN KEY\(workspace_id,order_id\)/],
  ['15 existing CRM authority reused', migration, /REFERENCES crm_people\(id\)/],
  ['16 one conversion per order', migration, /UNIQUE\(workspace_id,order_id\)/],
  ['17 deterministic time index', migration, /workspace_id,occurred_at DESC,id DESC/],
  ['18 paid-order insert guard', migration, /commerce_conversion_paid_order_insert/],
  ['19 order status PAID required', migration, /o\.status='PAID'/],
  ['20 payment status PAID required', migration, /o\.payment_status='PAID'/],
  ['21 frozen order total authority', migration, /o\.total_amount_minor=NEW\.amount_minor/],
  ['22 frozen currency authority', migration, /o\.currency_code=NEW\.currency_code/],
  ['23 order owner authority', migration, /own\.crm_person_id=NEW\.crm_person_id/],
  ['24 update forbidden', migration, /commerce_conversion_events_no_update/],
  ['25 delete forbidden', migration, /commerce_conversion_events_no_delete/],
  ['26 append-only error', migration, /COMMERCE_CONVERSION_APPEND_ONLY/],
  ['27 server conversion id', conversions, /makeId\('cv'\)/],
  ['28 opaque public reference', conversions, /publicRef\('cnv'\)/],
  ['29 order total copied', conversions, /o\.total_amount_minor/],
  ['30 order currency copied', conversions, /o\.currency_code/],
  ['31 both PAID states rechecked', conversions, /o\.status='PAID' AND o\.payment_status='PAID'/],
  ['32 duplicate idempotency', conversions, /ON CONFLICT\(workspace_id,order_id\) DO NOTHING/],
  ['33 existing member ownership used', conversions, /LEFT JOIN commerce_order_member_owners/],
  ['34 linked customer safe label', conversions, /'會員顧客'/],
  ['35 unlinked customer safe label', conversions, /'未連結會員'/],
  ['36 callback imports bridge', commerce, /import \{ createPaidOrderConversionStatement \}/],
  ['37 provider callback verified first', commerce, /verifyCallback[\s\S]*const statements=/],
  ['38 merchant binding verified', commerce, /MerchantID.*intent\.merchant_id/],
  ['39 amount binding verified', commerce, /amountValue===Number\(intent\.amount_minor\)/],
  ['40 PAID update precedes conversion', commerce, /UPDATE commerce_orders SET status='PAID'[\s\S]*createPaidOrderConversionStatement/],
  ['41 atomic callback batch', commerce, /createPaidOrderConversionStatement[\s\S]*db\.batch\(statements\)/],
  ['42 duplicate callback exits', commerce, /if\(duplicate\)return \{accepted:true,idempotent:true/],
  ['43 no browser return authority', routes, /^(?![\s\S]*payments\/newebpay\/return)/],
  ['44 conversion list GET', routes, /app\.get\('\/api\/commerce\/conversions'/],
  ['45 conversion detail GET', routes, /app\.get\('\/api\/commerce\/conversions\/:safeConversionReference'/],
  ['46 viewer gate', routes, /conversions'[\s\S]*requireRole\(c,'viewer'\)/],
  ['47 list workspace scope', conversions, /WHERE e\.workspace_id=\?/],
  ['48 detail workspace scope', conversions, /WHERE e\.workspace_id=\? AND e\.public_ref=\?/],
  ['49 bounded page size', conversions, /Math\.min\(requestedLimit, 100\)/],
  ['50 deterministic ordering', conversions, /ORDER BY e\.occurred_at DESC,e\.id DESC/],
  ['51 opaque cursor lookup', conversions, /c\.public_ref=\?/],
  ['52 safe conversion output', conversions, /safeConversionReference/],
  ['53 safe order output', conversions, /safeOrderReference/],
  ['54 occurred time output', conversions, /occurredAt/],
  ['55 amount output', conversions, /amountMinor/],
  ['56 TWD output', conversions, /currencyCode: 'TWD'/],
  ['57 customer label output', conversions, /customerLabel/],
  ['58 campaign attribution deferred', conversions, /attributionSummaries: \[\]/],
  ['59 no conversion mutation API', routes, /^(?![\s\S]*app\.(post|put|patch|delete)\('\/api\/commerce\/conversions)/],
  ['60 no campaign mutation', all, /^(?![\s\S]*(UPDATE|INSERT INTO) campaigns\b)/i],
  ['61 no campaign click mutation', all, /^(?![\s\S]*(UPDATE|INSERT INTO) campaign_click)/i],
  ['62 no referral mutation', all, /^(?![\s\S]*(UPDATE|INSERT INTO) member_referral_attributions)/i],
  ['63 no dealer mutation', all, /^(?![\s\S]*(UPDATE|INSERT INTO) dealers\b)/i],
  ['64 no economy mutation', all, /^(?![\s\S]*(UPDATE|INSERT INTO) (points|point_|rewards?|contribution|tier_|commission_))/i],
  ['65 no CRM mutation', all, /^(?![\s\S]*(UPDATE|INSERT INTO) (crm_person_stage|crm_person_tags|crm_person_relationships|crm_profiles))/i],
  ['66 no raw payment payload column', migration, /^(?![\s\S]*(trade_info|trade_sha|raw_payload))/i],
  ['67 no provider transaction output', conversions, /^(?![\s\S]*provider_transaction)/i],
  ['68 no LINE UID output', conversions, /^(?![\s\S]*(line_user_id|line_member_id|uid_hash))/i],
  ['69 no credential output', conversions, /^(?![\s\S]*(access_token|channel_secret|hash_key|hash_iv))/i],
  ['70 no ROI claim', conversions, /^(?![\s\S]*(roi|roas|conversion rate))/i],
  ['71 no refund authority', all, /^(?![\s\S]*(ORDER_REFUNDED|CONVERSION_REVERSED))/i],
];

for (const [name, source, pattern] of contracts) test(name, () => assert.match(source, pattern));

test('72 output allowlist excludes internal identifiers', () => {
  const body = conversions.slice(conversions.indexOf('function conversionView'), conversions.indexOf('export function createPaidOrderConversionStatement'));
  assert.doesNotMatch(body, /\b(id|order_id|workspace_id|crm_person_id|payment_intent_id)\b/);
});

test('73 conversion statement binds opaque references, occurrence time, workspace, and order', () => {
  let bound;
  const db = { prepare(sql) { return { bind(...args) { bound = { sql, args }; return bound; } }; } };
  const statement = createPaidOrderConversionStatement(db,{workspaceId:'workspace-a',orderId:'order-a',occurredAt:'2026-08-11T00:00:00.000Z'});
  assert.equal(statement,bound);
  assert.match(bound.args[0],/^cv_[0-9a-f]{32}$/);
  assert.match(bound.args[1],/^cnv_[0-9a-f-]{36}$/);
  assert.deepEqual(bound.args.slice(2),['2026-08-11T00:00:00.000Z','2026-08-11T00:00:00.000Z','workspace-a','order-a']);
  assert.match(bound.sql,/status='PAID' AND o\.payment_status='PAID'/);
});

test('74 list projection drops internal identifiers from database rows', async () => {
  const internal = { id:'hidden-conversion',workspace_id:'hidden-workspace',order_id:'hidden-order',crm_person_id:'hidden-person',public_ref:'cnv-safe',conversion_type:'ORDER_PAID',amount_minor:900,currency_code:'TWD',customer_label_snapshot:'會員顧客',occurred_at:'2026-08-11T00:00:00.000Z',order_public_ref:'ord-safe' };
  const db = { prepare() { return { bind() { return { all:async()=>({results:[internal]}) }; } }; } };
  const result = await listConversions(db,'workspace-a',{limit:25});
  assert.deepEqual(result,{conversions:[{safeConversionReference:'cnv-safe',conversionType:'ORDER_PAID',occurredAt:'2026-08-11T00:00:00.000Z',amountMinor:900,currencyCode:'TWD',safeOrderReference:'ord-safe',customerLabel:'會員顧客',attributionSummaries:[]}],nextCursor:null});
  assert.doesNotMatch(JSON.stringify(result),/hidden-(conversion|workspace|order|person)/);
});

test('75 detail projection drops payment and identity internals', async () => {
  const internal = { provider_transaction_hash:'hidden-payment',line_member_id:'hidden-member',public_ref:'cnv-safe',conversion_type:'ORDER_PAID',amount_minor:1200,currency_code:'TWD',customer_label_snapshot:'未連結會員',occurred_at:'2026-08-11T01:00:00.000Z',order_public_ref:'ord-safe' };
  const db = { prepare() { return { bind() { return { first:async()=>internal }; } }; } };
  const result = await readConversion(db,'workspace-a','cnv-safe');
  assert.equal(result.safeConversionReference,'cnv-safe');
  assert.equal(result.safeOrderReference,'ord-safe');
  assert.doesNotMatch(JSON.stringify(result),/hidden-(payment|member)/);
});