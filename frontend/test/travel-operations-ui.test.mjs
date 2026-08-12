import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canManageTravelOperations,
  travelFulfillmentLabel,
  travelMemberPaymentLabel,
  travelOperationErrorMessage,
  travelOperationPaymentLabel,
  travelReadinessLabel,
  travelReadinessWarningLabel,
} from '../src/travel-operations-presentation.js';
import { travelEventLabel } from '../src/travel-presentation.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [app, workspace, panel, member, presentation, travelPresentation] = await Promise.all([
  read('../src/App.jsx'), read('../src/components/TravelWorkspace.jsx'), read('../src/components/DepartureOperationsPanel.jsx'),
  read('../src/components/LiffTravelPage.jsx'), read('../src/travel-operations-presentation.js'), read('../src/travel-presentation.js'),
]);
const ui = `${workspace}\n${panel}\n${member}\n${presentation}\n${travelPresentation}`;
const contracts = [
  ['旅遊管理 top-level is preserved', app, /id: 'travel', label: '旅遊管理'/],
  ['出發日 tab is preserved', workspace, /\['departures','出發日'\]/],
  ['營運總覽 is entered from a departure', workspace, /operationsReference: item\.safeDepartureReference[^]*>營運總覽<\/button>/],
  ['no top-level operations navigation is added', app, /id: ['"](?:operations|travel-operations)['"]/, false],
  ['panel receives only safe departure reference', workspace, /safeDepartureReference=\{item\.safeDepartureReference\}/],
  ['operations summary route is exact', panel, /departures\/\$\{ref\}\/operations`/],
  ['booking roster route is bounded to page size', panel, /bookings\?limit=\$\{pageSize\}&page=\$\{page\}/],
  ['traveler roster route is bounded to page size', panel, /travelers\?limit=\$\{pageSize\}&page=\$\{page\}/],
  ['timeline route is bounded to 100', panel, /events\?limit=100/],
  ['default roster page size is 25', panel, /const pageSize = 25/],
  ['operations loading wording exists', panel, /正在載入營運資訊…/],
  ['summary renders itinerary authority', panel, /\['行程',data\.itineraryTitle\]/],
  ['summary renders departure dates', panel, /\['出發日期',`\$\{dateOnly\(data\.departureStart\)\}/],
  ['summary renders booking window', panel, /\['報名期間',`\$\{dateTime\(data\.bookingOpenAt\)\}/],
  ['summary renders backend departure status', panel, /travelStatusLabel\(data\.departureStatus\)/],
  ['summary renders seat limit', panel, /\['座位上限',data\.seatLimit\]/],
  ['summary renders minimum group size', panel, /\['最低成團人數',data\.minGroupSize\]/],
  ['capacity renders reserved seats', panel, /已預訂人數[^]*data\.reservedSeats/],
  ['capacity renders remaining seats', panel, /剩餘名額[^]*data\.remainingSeats/],
  ['booking count uses backend value', panel, /報名訂單數[^]*data\.bookingCount/],
  ['traveler count uses backend value', panel, /旅客人數[^]*data\.travelerCount/],
  ['unpaid count uses backend value', panel, /未付款[^]*data\.unpaidBookings/],
  ['deposit completed count uses backend value', panel, /訂金完成[^]*data\.depositCompletedBookings/],
  ['fully paid count uses backend value', panel, /款項已付清[^]*data\.fullyPaidBookings/],
  ['cancelled count uses backend value', panel, /已取消[^]*data\.cancelledBookings/],
  ['readiness state comes directly from backend', panel, /travelReadinessLabel\(data\.readiness\?\.state\)/],
  ['readiness warnings come directly from backend', panel, /data\.readiness\?\.warnings[^]*travelReadinessWarningLabel\(warning\)/],
  ['frontend contains no readiness calculation', panel, /minGroupSize\s*[<>]|unpaidBookings\s*[<>]|remainingSeats\s*===/, false],
  ['operational confirmation uses backend boolean', panel, /data\.operationalState\?\.confirmed \? '已確認' : '尚未確認'/],
  ['service completion uses backend boolean', panel, /data\.operationalState\?\.completed \? '已完成' : '尚未完成'/],
  ['operational timestamps are localized safely', panel, /dateTime\(data\.operationalState\.confirmedAt\)[^]*dateTime\(data\.operationalState\.completedAt\)/],
  ['confirm CTA exists', panel, />確認出團營運<\/button>/],
  ['complete CTA exists', panel, />標記服務完成<\/button>/],
  ['mutation controls are admin owner gated', panel, /const canManage = canManageTravelOperations\(userRole\)[^]*\{canManage &&/],
  ['confirm uses approved endpoint', panel, /operations\/\$\{action\}`[^]*method: 'POST'/],
  ['confirm dialog disclaims payment authority', panel, /不代表付款完成，也不會變更訂單付款狀態/],
  ['complete dialog disclaims adjacent mutations', panel, /不會變更付款、退款、佣金或結算狀態/],
  ['success confirmation wording exists', panel, /營運狀態已確認/],
  ['success completion wording exists', panel, /服務已標記完成/],
  ['booking roster exposes safe reference', panel, /item\.safeBookingReference/],
  ['booking roster exposes safe customer label', panel, /item\.safeCustomerLabel/],
  ['booking roster maps backend payment status', panel, /travelOperationPaymentLabel\(item\.paymentStatus\)/],
  ['booking roster exposes safe seller label with none fallback', panel, /item\.safeSellerLabel \|\| '無'/],
  ['empty booking state is localized', panel, /目前沒有報名訂單。/],
  ['traveler roster renders approved low-risk fields', panel, /item\.displayName[^]*travelerTypeLabel\(item\.travelerType\)[^]*item\.phone/],
  ['empty traveler state is localized', panel, /目前沒有旅客資料。/],
  ['timeline uses safe event localization', panel, /travelEventLabel\(event\)/],
  ['empty timeline state is localized', panel, /目前尚無旅遊進度紀錄。/],
  ['operation milestone localization exists', travelPresentation, /OPERATION_CONFIRMED: '營運已確認', SERVICE_COMPLETED: '服務已完成'/],
  ['unknown event fallback is safe', travelPresentation, /旅遊狀態已更新/],
  ['member own booking detail renders fulfillment', member, /travelFulfillmentLabel\(state\.booking\.fulfillment\?\.state\)/],
  ['member renders backend booking payment authority', member, /travelMemberPaymentLabel\(state\.booking\.bookingStatus\)/],
  ['member has no operations mutation endpoint', member, /operations\/(?:confirm|complete)/, false],
  ['member has no other roster reads', member, /departures\/[^\n]*\/(?:bookings|travelers)/, false],
  ['member has no commission data', member, /commissionRate|commissionAmount|settlement|payout/, false],
  ['no raw operation event id is rendered', panel, /event\.id|eventId|actorUserId/, false],
  ['no internal domain identifiers are rendered', panel, /dealerId|memberId|crmPersonId|commerceOrderId|departureId|bookingId|commissionId/, false],
  ['no high-risk traveler data exists', ui, /passport|national.?id|health|bank|document.?image|護照|身分證|病歷/i, false],
  ['no roster export exists', ui, /匯出旅客|下載名單|CSV|Excel|PDF/, false],
  ['no browser persistence exists', ui, /localStorage|sessionStorage|indexedDB/, false],
  ['no Referral mutation UI exists', ui, /referral\/(?:assign|mutate)|推薦關係重設/, false],
  ['no Dealer reassignment UI exists', ui, /dealer\/(?:assign|reassign)|重新指派銷售/, false],
  ['no Commission calculation UI exists', ui, /calculateCommission|commission\/calculate/, false],
  ['no CRM automation exists', ui, /pipelineStage|automaticTag|followUp/, false],
  ['no Campaign execution exists', ui, /campaigns?\/[^\n]*(?:execute|resume)/, false],
  ['no AI Travel exists', ui, /gemini|generateContent|AI 成團|AI 營運|AI 付款/i, false],
  ['no frontend payment mutation is introduced', panel, /payment-intents|markPaid|payment\/status/, false],
];
for (const [name, source, pattern, expected = true] of contracts) test(`8E-UI acceptance: ${name}`, () => expected ? assert.match(source, pattern) : assert.doesNotMatch(source, pattern));

test('8E-UI roles keep viewer and editor read-only', () => {
  assert.equal(canManageTravelOperations('viewer'), false); assert.equal(canManageTravelOperations('editor'), false);
  assert.equal(canManageTravelOperations('admin'), true); assert.equal(canManageTravelOperations('owner'), true);
});
test('8E-UI readiness states are localized', () => {
  assert.equal(travelReadinessLabel('READY'), '營運狀態良好'); assert.equal(travelReadinessLabel('ATTENTION'), '需要留意'); assert.equal(travelReadinessLabel('BLOCKED'), '尚不可進行');
});
test('8E-UI approved readiness warnings are localized', () => {
  assert.deepEqual(['MIN_GROUP_NOT_REACHED','UNPAID_BOOKINGS_EXIST','DEPOSIT_ONLY_BOOKINGS_EXIST','DEPARTURE_CANCELLED','BOOKING_WINDOW_OPEN','SOLD_OUT'].map(travelReadinessWarningLabel), ['尚未達最低成團人數','尚有未付款訂單','尚有僅完成訂金的訂單','此出發日已取消','目前仍在報名期間','名額已滿']);
  assert.equal(travelReadinessWarningLabel('FUTURE_WARNING'), '請留意目前營運狀態');
});
test('8E-UI payment states preserve deposit versus fully-paid semantics', () => {
  assert.equal(travelOperationPaymentLabel('UNPAID'), '未付款'); assert.equal(travelOperationPaymentLabel('DEPOSIT_COMPLETED'), '訂金完成'); assert.equal(travelOperationPaymentLabel('FULLY_PAID'), '款項已付清'); assert.notEqual(travelOperationPaymentLabel('DEPOSIT_COMPLETED'), '款項已付清');
  assert.equal(travelMemberPaymentLabel('DEPOSIT_PAID'), '訂金完成'); assert.equal(travelMemberPaymentLabel('FULLY_PAID'), '款項已付清');
});
test('8E-UI Member fulfillment states are localized without inference', () => {
  assert.deepEqual(['PENDING','CONFIRMED','COMPLETED','CANCELLED'].map(travelFulfillmentLabel), ['等待出團確認','已確認出團','旅程服務已完成','已取消']);
});
test('8E-UI safe errors never expose raw backend details', () => {
  assert.equal(travelOperationErrorMessage('FORBIDDEN'), '你沒有權限執行此操作。');
  assert.equal(travelOperationErrorMessage('TRAVEL_DEPARTURE_NOT_FOUND'), '找不到此出發日。');
  assert.equal(travelOperationErrorMessage('TRAVEL_OPERATION_NOT_CONFIRMED', 'complete'), '目前無法將此出發日標記為服務完成。');
  assert.equal(travelOperationErrorMessage('SQLITE_CONSTRAINT', 'confirm'), '目前無法確認此出發日的營運狀態。');
});
test('8E-UI merged milestone labels and unknown fallback are safe', () => {
  assert.equal(travelEventLabel({ eventType: 'OPERATION_CONFIRMED' }), '營運已確認'); assert.equal(travelEventLabel({ eventType: 'SERVICE_COMPLETED' }), '服務已完成'); assert.equal(travelEventLabel({ eventType: 'FUTURE_EVENT' }), '旅遊狀態已更新');
});