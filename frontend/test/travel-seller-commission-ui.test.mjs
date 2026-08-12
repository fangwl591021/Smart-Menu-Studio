import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { commissionSourceLabel } from '../src/commission-source-presentation.js';
import { canManageTravelSellerPermissions, travelSellerEligibilityLabel, travelSellerErrorMessage, travelSellerStatusLabel } from '../src/travel-seller-presentation.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [app, travel, tenantCommission, dealerCommission] = await Promise.all([
  read('../src/App.jsx'),
  read('../src/components/TravelWorkspace.jsx'),
  read('../src/components/CommissionAttributionPanel.jsx'),
  read('../src/components/LiffReferralPage.jsx'),
]);

test('8D-UI Travel area retains entitlement authority and adds the seller tab without duplicate top-level navigation', () => {
  assert.match(app, /currentView === 'travel'[^]*tenantViewAccessible[^]*<TravelWorkspace/);
  assert.match(travel, /\['sellers','銷售夥伴'\]/);
  assert.equal((app.match(/id: 'travel'/g) || []).length, 1);
  assert.doesNotMatch(app, /id: 'travel-commission'|id: 'travel-sellers'/);
});

test('8D-UI seller list uses safe backend projection and approved scoped actions', () => {
  for (const value of ['/api/line/account', '/api/travel/sellers?', 'safeSellerReference', 'sellerLabel', 'permissionStatus', 'sellerEligible', 'createdAt', 'revokedAt', '正在載入銷售夥伴…', '目前沒有可管理的旅遊銷售夥伴。']) assert.ok(travel.includes(value), `missing ${value}`);
  assert.match(travel, /encodeURIComponent\(seller\.safeSellerReference\)/);
  assert.match(travel, /method: 'POST'[^]*json\(\{\}\)/);
  assert.match(travel, /啟用旅遊銷售/);
  assert.match(travel, /撤銷旅遊銷售/);
  assert.match(travel, /既有報名的歷史銷售來源不會被修改/);
  assert.doesNotMatch(travel, /(?:onClick|request\()[^\n]*(?:reassign|assign-seller|seller\/assign)/i);
});

test('8D-UI role and seller presentation helpers are deterministic and backend-authoritative', () => {
  assert.equal(canManageTravelSellerPermissions('owner'), true);
  assert.equal(canManageTravelSellerPermissions('admin'), true);
  assert.equal(canManageTravelSellerPermissions('editor'), false);
  assert.equal(canManageTravelSellerPermissions('viewer'), false);
  assert.equal(travelSellerStatusLabel('ACTIVE'), '啟用');
  assert.equal(travelSellerStatusLabel('REVOKED'), '已撤銷');
  assert.equal(travelSellerEligibilityLabel(false), '目前不符合資格');
  assert.equal(travelSellerErrorMessage('FORBIDDEN'), '你沒有權限執行此操作。');
  assert.match(travel, /\{canManage && <td[^]*seller\.permissionStatus === 'ACTIVE'/);
});

test('8D-UI booking detail renders only the safe immutable seller snapshot or none', () => {
  assert.match(travel, /銷售來源：\{state\.detail\.seller\?\.sellerLabel \|\| '無'\}/);
  for (const forbidden of ['sellerDealerId', 'dealerId', 'memberId', 'referralId', 'commissionLedgerId']) assert.equal(travel.includes(forbidden), false);
});

test('8D-UI Commission labels Travel only from sourceDomain and preserves attributionSource labels', () => {
  const travelSource = { attributionSource: 'REFERRAL_EVIDENCE', sourceDomain: 'TRAVEL' };
  const referralSource = { attributionSource: 'REFERRAL_EVIDENCE', sourceDomain: null };
  assert.equal(commissionSourceLabel(travelSource), '來源：旅遊報名');
  assert.equal(commissionSourceLabel(referralSource), '推薦證據');
  assert.notEqual(commissionSourceLabel(referralSource), '來源：旅遊報名');
  for (const source of [tenantCommission, dealerCommission]) {
    assert.match(source, /commissionSourceLabel\(source\)/);
    assert.match(source, /commissionSourceKey\(source\)/);
    assert.doesNotMatch(source, /sourceDomain\s*\|\|\s*source\.attributionSource/);
  }
});

test('8D-UI adds no duplicate finance, mutation, identity, persistence, payment or AI authority', () => {
  const ui = `${travel}\n${tenantCommission}`;
  for (const forbidden of ['Travel Commission Dashboard', '旅遊佣金計算', 'commissionRate', 'commissionAmount', 'lineUserId', 'line_identity_hash', 'localStorage', 'sessionStorage', 'indexedDB', 'referral/assign', 'dealer/reassign', 'points/rewards', 'gemini', 'generateContent']) assert.equal(ui.includes(forbidden), false, `must not include ${forbidden}`);
  assert.doesNotMatch(travel, /訂金[^\n]*(?:佣金|已賺取)/);
});
