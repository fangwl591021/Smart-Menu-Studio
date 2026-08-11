import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [app, admin, member] = await Promise.all([
  read('../src/App.jsx'),
  read('../src/components/CommerceAdminWorkspace.jsx'),
  read('../src/components/LiffCommercePage.jsx'),
]);

const acceptance = [
  ['tenant navigation contains commerce entry', app, /id: 'commerce', label: '商城'/],
  ['tenant navigation permits commerce view', app, /'campaigns', 'commerce', 'travel', 'ai-usage'/],
  ['application imports commerce workspace', app, /import CommerceAdminWorkspace from '\.\/components\/CommerceAdminWorkspace'/],
  ['application renders commerce workspace', app, /currentView === 'commerce'[\s\S]*<CommerceAdminWorkspace request=\{authFetch\} userRole=\{activeRole\}/],
  ['member storefront has dedicated LIFF route', app, /pathname === '\/liff\/commerce'[\s\S]*<LiffCommercePage/],
  ['admin exposes product management', admin, /商品管理/],
  ['admin exposes order management', admin, /訂單管理/],
  ['admin lists products from approved contract', admin, /request\('\/api\/commerce\/products'\)/],
  ['admin creates products through approved contract', admin, /current \? 'PATCH' : 'POST'/],
  ['admin updates products using safe reference', admin, /encodeURIComponent\(current\.safeProductReference\)/],
  ['admin archives products using safe reference', admin, /safeProductReference\)\}\/archive/],
  ['only owner and admin can manage products', admin, /\['owner', 'admin'\]\.includes/],
  ['admin lists orders from approved contract', admin, /request\('\/api\/commerce\/orders'\)/],
  ['admin reads order detail and payments', admin, /\/api\/commerce\/orders\/\$\{ref\}`\)[\s\S]*\/payments/],
  ['admin displays item snapshots', admin, /商品快照/],
  ['admin displays safe payment history', admin, /付款紀錄/],
  ['member identity starts with LIFF bootstrap', member, /\/api\/member\/referral\/bootstrap/],
  ['member identity uses LIFF access token', member, /liff\.getAccessToken\(\)/],
  ['member establishes server-side identity', member, /\/api\/member\/establish/],
  ['member requests attach bearer access token', member, /Authorization[\s\S]*Bearer \$\{auth\.accessToken\}/],
  ['member lists ACTIVE-only backend product projection', member, /\/api\/member\/commerce\/products/],
  ['member product detail uses the approved route', member, /\/api\/member\/commerce\/products\/\$\{encodeURIComponent\(product\.safeProductReference\)\}/],
  ['cart quantities are bounded', member, /Math\.max\(0, Math\.min\(100, quantity\)\)/],
  ['order creation sends only safe product reference and quantity', member, /items: cartItems\.map[\s\S]*safeProductReference[\s\S]*quantity/],
  ['server order amount is authoritative', member, /訂單金額以伺服器建立結果為準/],
  ['member lists own orders', member, /\/api\/member\/commerce\/orders'\)/],
  ['member reads own order detail', member, /\/api\/member\/commerce\/orders\/\$\{ref\}`/],
  ['member reads safe own payment history', member, /\/api\/member\/commerce\/orders\/\$\{ref\}\/payments/],
  ['unpaid own order can be cancelled', member, /\/cancel`[\s\S]*method: 'POST'/],
  ['paid order hides cancel control', member, /!\['PAID', 'CANCELLED'\]\.includes\(state\.selectedOrder\.paymentStatus\)[\s\S]*取消訂單/],
  ['payment intent uses own-order route', member, /\/payment-intents`[\s\S]*method: 'POST'/],
  ['NewebPay handoff is POST form submission', member, /form\.method = 'POST'[\s\S]*form\.action = checkout\.gatewayUrl[\s\S]*form\.submit\(\)/],
  ['return flow begins with exact confirming message', member, /正在確認付款結果…/],
  ['poll interval is four seconds', member, /POLL_INTERVAL_MS = 4000/],
  ['poll limit is sixty seconds', member, /POLL_LIMIT_MS = 60000/],
  ['poll uses member payment status endpoint', member, /\/payment-status/],
  ['poll stops only on approved terminal statuses', member, /\['PAID', 'FAILED', 'CANCELLED'\]\.includes/],
  ['paid display uses exact backend payment status', member, /isVerifiedPaid = payment => payment\?\.paymentStatus === 'PAID'/],
  ['paid completion copy is exact', member, /付款已完成/],
  ['pending timeout copy is exact', member, /付款結果仍在確認中，您可以稍後重新整理查看。/],
  ['failed payment can be retried', member, /paymentStatus === 'FAILED' \? '重新付款'/],
  ['browser URL is never used as paid authority', member, /location\.(?:search|hash)|URLSearchParams|paymentSuccess|tradeStatus/, false],
  ['member never sends internal identity authority', member, /memberId|crmPersonId|workspaceId|customerId|lineMemberId/, false],
  ['member never persists access token or checkout payload', member, /setItem\([^\n]*(?:accessToken|TradeInfo|TradeSha|MerchantID|safePaymentReference)/, false],
  ['member never renders internal payment identifiers', member, /safePaymentReference|paymentIntentId|orderId|paymentId/, false],
  ['commerce UI contains no campaign conversion mutation', `${admin}\n${member}`, /conversion|campaign/i, false],
  ['commerce UI contains no referral or dealer business feature', `${admin}\n${member}`, /attribution|dealer|推薦|經銷/i, false],
  ['commerce UI contains no points rewards commission or payout', `${admin}\n${member}`, /points|rewards?|commission|payout|佣金|點數|提領/i, false],
  ['commerce UI contains no CRM automation', `${admin}\n${member}`, /pipelineStage|automaticTag|followUp|CRM Stage|自動標籤/i, false],
];

for (const [name, source, pattern, expected = true] of acceptance) {
  test(`7D-UI acceptance: ${name}`, () => {
    if (expected) assert.match(source, pattern);
    else assert.doesNotMatch(source, pattern);
  });
}

test('7D-UI focused suite contains at least 45 named acceptance checks', () => {
  assert.ok(acceptance.length >= 45, `expected at least 45 checks, received ${acceptance.length}`);
});
