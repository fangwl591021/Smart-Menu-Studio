import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [migration, commerce, member, routes, index, schema0046] = await Promise.all([
  read('../migrations/0047_commerce_member_order_ownership.sql'),
  read('../src/commerce/commerce.ts'),
  read('../src/commerce/member-commerce.ts'),
  read('../src/commerce/member-routes.ts'),
  read('../src/index.ts'),
  read('../migrations/0046_commerce_order_payment.sql'),
]);
const projections = member.match(/function publicProduct[\s\S]*?(?=const ownerJoin)/)?.[0] || '';
const memberSurface = `${member}\n${routes}`;

const checks = [
  ['1 authenticated Member Self product list works', routes, /verifiedReferralMember[\s\S]*\/api\/member\/commerce\/products/],
  ['2 unauthenticated Member Self is blocked', routes, /MEMBER_CONTEXT_REQUIRED[\s\S]*401/],
  ['3 auth resolves workspace server-side', routes, /workspaceId: String\(verified\.account\.workspace_id\)/],
  ['4 auth resolves member identity server-side', routes, /lineMemberId: String\(verified\.memberId\)/],
  ['5 client customer authority is not accepted', commerce, /exactKeys\(input\.body, \['items'\]/],
  ['6 ACTIVE products are visible', member, /status='ACTIVE'/],
  ['7 DRAFT products are hidden', member, /WHERE workspace_id=\? AND status='ACTIVE'/],
  ['8 ARCHIVED products are hidden', member, /public_ref=\? AND status='ACTIVE'/],
  ['9 product reads are workspace scoped', member, /commerce_products WHERE workspace_id=\?/],
  ['10 product projection uses safe reference', projections, /safeProductReference/],
  ['11 own order is created', member, /export async function createMemberOrder/],
  ['12 server binds verified member owner', member, /lineMemberId: context\.lineMemberId/],
  ['13 client memberId is rejected', commerce, /exactKeys\(input\.body, \['items'\]/],
  ['14 client total is rejected', commerce, /COMMERCE_ORDER_INPUT_INVALID/],
  ['15 server product price is authoritative', commerce, /Number\(product\.price_amount_minor\)\*raw\.quantity/],
  ['16 item snapshot remains frozen', commerce, /sku_snapshot,name_snapshot,unit_amount_minor,quantity,line_amount_minor/],
  ['17 archived product cannot create order', commerce, /public_ref=\? AND status='ACTIVE'/],
  ['18 invalid quantity is rejected', commerce, /raw\.quantity<1 \|\| raw\.quantity>100/],
  ['19 own orders are listed', member, /export async function listMemberOrders/],
  ['20 own order detail is readable', member, /export async function readMemberOrder/],
  ['21 Member A cannot read Member B order', member, /own\.line_member_id=\?/],
  ['22 cross-workspace order access is blocked', member, /own\.workspace_id=\?/],
  ['23 order projections contain no internal order ID', projections, /^(?![\s\S]*\borderId\b)/],
  ['24 own unpaid order can initiate payment', member, /ownOrderRow[\s\S]*initiatePayment/],
  ['25 another member order cannot initiate payment', member, /await ownOrderRow\(db, context, input\.safeOrderReference\)/],
  ['26 intent amount remains order authority', commerce, /amountMinor:Number\(intent\.amount_minor\)/],
  ['27 active intent 30 minute reuse remains', commerce, /Date\.now\(\)\+30\*60\*1000/],
  ['28 PAID order payment is blocked', commerce, /COMMERCE_ORDER_ALREADY_PAID/],
  ['29 CANCELLED order payment is blocked', commerce, /COMMERCE_ORDER_CANCELLED/],
  ['30 provider secrets are not projected', projections, /^(?![\s\S]*(HashKey|HashIV|hashKey|hashIv))/],
  ['31 PENDING payment status is safely projected', member, /paymentStatus: String\(order\.payment_status\)/],
  ['32 PAID status is read from backend order truth', member, /orderStatus: String\(order\.status\)/],
  ['33 browser success cannot mark PAID', routes, /^(?![\s\S]*(markPaid|confirmPaid|paymentSuccess))/i],
  ['34 FAILED payment is safely projected', member, /safeErrorCode: row\.safe_failure_code/],
  ['35 paidAt is projected', member, /paidAt: order\.paid_at \|\| null/],
  ['36 raw callback payload is absent', memberSurface, /^(?![\s\S]*(callback_payload|decrypted_payload|raw_payload))/i],
  ['37 duplicate payment init uses existing service policy', member, /return initiatePayment\(db/],
  ['38 duplicate callback stays in existing authority', routes, /^(?![\s\S]*app\.post\('\/api\/commerce\/payments\/newebpay\/notify')/],
  ['39 pre-order price change uses latest price', commerce, /SELECT \* FROM commerce_products[\s\S]*status='ACTIVE'/],
  ['40 post-order price change cannot alter snapshot', schema0046, /commerce_order_items_no_update/],
  ['41 archive before create blocks checkout', commerce, /COMMERCE_PRODUCT_NOT_AVAILABLE/],
  ['42 LINE UID is absent from projections', projections, /^(?![\s\S]*(lineUid|lineUserId|providerRecipientId))/i],
  ['43 identity hash is absent from projections', projections, /^(?![\s\S]*(identityHash|line_identity_hash))/i],
  ['44 CRM Person ID is absent from projections', projections, /^(?![\s\S]*crmPersonId)/],
  ['45 member internal ID is absent from projections', projections, /^(?![\s\S]*lineMemberId)/],
  ['46 workspace ID is absent from projections', projections, /^(?![\s\S]*workspaceId)/],
  ['47 HashKey and HashIV are absent', projections, /^(?![\s\S]*(HashKey|HashIV))/],
  ['48 decrypted TradeInfo is absent', memberSurface, /^(?![\s\S]*decryptTradeInfo)/],
  ['49 card data is absent', memberSurface, /^(?![\s\S]*(card_number|credit_card|\bCVV\b|\bPAN\b))/i],
  ['50 no Campaign conversion mutation', memberSurface, /^(?![\s\S]*(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(campaign|conversion))/i],
  ['51 no Referral mutation', memberSurface, /^(?![\s\S]*(INSERT INTO|UPDATE|DELETE FROM)[^\n]*referral)/i],
  ['52 no Dealer mutation', memberSurface, /^(?![\s\S]*(INSERT INTO|UPDATE|DELETE FROM)[^\n]*dealer)/i],
  ['53 no Points or Rewards mutation', memberSurface, /^(?![\s\S]*(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(points?|rewards?))/i],
  ['54 no Contribution or Tier mutation', memberSurface, /^(?![\s\S]*(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(contribution|tier))/i],
  ['55 no Commission or Payout mutation', memberSurface, /^(?![\s\S]*(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(commission|payout))/i],
  ['56 no Stage Follow-up Tag or Profile mutation', memberSurface, /^(?![\s\S]*(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(stage|follow_up|tag|profile))/i],
  ['57 ownership migration is additive only', migration, /Additive only; no backfill or seed data/],
  ['58 ownership migration has no destructive SQL', migration, /^(?![\s\S]*\b(DROP|ALTER)\b)/i],
  ['59 owner linkage is immutable', migration, /commerce_order_member_owner_no_update[\s\S]*commerce_order_member_owner_no_delete/],
  ['60 Member routes are registered', index, /registerMemberCommerceRoutes\(app,\{verifiedReferralMember,ensureCrmPersonForVerifiedMember,text\}\)/],
];

for (const [name, source, pattern] of checks) test(name, () => assert.match(source, pattern));

test('61 owner linkage is inserted atomically with order snapshots', () => {
  const create = commerce.match(/export async function createOrder[\s\S]*?(?=export async function listOrders)/)?.[0] || '';
  assert.ok(create.indexOf('commerce_order_member_owners') < create.indexOf('db.batch(statements)'));
});

test('62 CRM linkage is established only for order creation', () => {
  assert.match(routes, /memberContext\(c, deps, true\)[\s\S]*createMemberOrder/);
  assert.doesNotMatch(routes.match(/app\.get\('\/api\/member\/commerce\/products'[\s\S]*?\n  \}\);/)?.[0] || '', /ensureCrmPersonForVerifiedMember/);
});
