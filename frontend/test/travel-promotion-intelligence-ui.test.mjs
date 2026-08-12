import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  TRAVEL_PROMOTION_FORMATS,
  canManageTravelPromotions,
  isTravelPromotionFormatCountValid,
  travelPromotionErrorMessage,
  travelPromotionStatusLabel,
  travelPromotionUiAuthority,
} from '../src/travel-promotion-presentation.js';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [app, travel, promotion, campaign] = await Promise.all([
  read('../src/App.jsx'),
  read('../src/components/TravelWorkspace.jsx'),
  read('../src/components/TravelPromotionWorkspace.jsx'),
  read('../src/components/CampaignWorkspace.jsx'),
]);
const ui = `${app}\n${travel}\n${promotion}\n${campaign}`;

test('8F-UI entitlement matrix keeps preview on TRAVEL and handoff on TRAVEL plus CAMPAIGN', () => {
  assert.deepEqual(travelPromotionUiAuthority({ travelEnabled: true, campaignEnabled: true }), { travelAvailable: true, previewAvailable: true, campaignHandoffAvailable: true });
  assert.deepEqual(travelPromotionUiAuthority({ travelEnabled: true, campaignEnabled: false }), { travelAvailable: true, previewAvailable: true, campaignHandoffAvailable: false });
  assert.deepEqual(travelPromotionUiAuthority({ travelEnabled: false, campaignEnabled: true }), { travelAvailable: false, previewAvailable: false, campaignHandoffAvailable: false });
  assert.deepEqual(travelPromotionUiAuthority({ travelEnabled: false, campaignEnabled: false }), { travelAvailable: false, previewAvailable: false, campaignHandoffAvailable: false });
  assert.match(app, /travelEnabled=\{moduleAuthority\.isEnabled\('TRAVEL'\) === true\}/);
  assert.match(app, /campaignEnabled=\{moduleAuthority\.isEnabled\('CAMPAIGN'\) === true\}/);
  assert.doesNotMatch(promotion, /disabled=\{[^}]*campaignEnabled[^}]*\}[^]*\u9810覽推廣內容/);
});

test('8F-UI stays inside Travel with the approved three subflows', () => {
  assert.match(travel, /\['promotions','推廣素材'\]/);
  assert.match(travel, /<TravelPromotionWorkspace/);
  assert.match(promotion, /useState\('library'\)/);
  for (const label of ['素材庫', '新增 DM', '製作推廣內容']) assert.ok(promotion.includes(label));
  assert.equal((app.match(/id: 'travel'/g) || []).length, 1);
  assert.doesNotMatch(app, /id: 'travel-promotions'|id: 'knowledge'/);
});

test('8F-UI ingest uses existing safe image upload and bounded transient text', () => {
  for (const value of ['新增宣傳 DM', '上傳 DM 圖片', '貼上 DM 文字', 'image/jpeg,image/png', 'maxLength={20000}', '/ 20,000', '請勿上傳含身分證、護照、健康或金融個資的文件。', '/api/templates/upload-image', 'safeAssetReferences']) assert.ok(promotion.includes(value), `missing ${value}`);
  assert.doesNotMatch(promotion, /PDF|application\/pdf|storage_key|bucket|Wasabi|base64|localStorage|sessionStorage|indexedDB/i);
  assert.match(promotion, /DM 是推廣素材，不是正式行程/);
  assert.doesNotMatch(promotion, />新增行程</);
});

test('8F-UI AI is optional, platform-authoritative, review-only, and never auto-activates', () => {
  for (const value of ['AI 解析 DM', '正在解析 DM…', 'AI 草稿已產生，請確認內容。', '此工作區尚未啟用 AI 功能。', 'AI 解析內容僅供草稿使用', '/extract']) assert.ok(promotion.includes(value));
  assert.doesNotMatch(promotion, /GEMINI_API_KEY|OPENAI_API_KEY|apiKey|secret/i);
  assert.match(promotion, /if \(kind === 'ai'\) body = [^;]*\/extract/);
  assert.match(promotion, /if \(kind === 'activate'\) body = [^;]*\/activate/);
  assert.doesNotMatch(promotion, /if \(kind === 'ai'\)[^;]*\/activate/);
});

test('8F-UI review mirrors exact backend fields, explicit activation, archive, and versions', () => {
  for (const label of ['標題','摘要','目的地','地區','天數','出發地','日期資訊','價格資訊','優惠／注意事項','行程亮點','關鍵字','FAQ','客服回覆模板','社群宣傳文案','有效期限','核准並啟用','封存素材','目前版本','目前啟用版本','草稿版本']) assert.ok(promotion.includes(label), `missing ${label}`);
  assert.match(promotion, /confirm\?\.\('確定要啟用這份推廣素材嗎/);
  assert.match(promotion, /confirm\?\.\('封存後將不再提供新的推廣搜尋使用/);
  assert.doesNotMatch(promotion, />刪除|method:\s*'DELETE'/);
  assert.equal(travelPromotionStatusLabel({ status: 'DRAFT' }), '草稿');
  assert.equal(travelPromotionStatusLabel({ status: 'ACTIVE' }), '使用中');
  assert.equal(travelPromotionStatusLabel({ status: 'ARCHIVED' }), '已封存');
  assert.equal(travelPromotionStatusLabel({ status: 'ACTIVE', isExpired: true }), '已過期');
});

test('8F-UI library provides safe filters and no internal identifiers', () => {
  for (const label of ['搜尋標題或目的地','全部狀態','全部目的地','全部有效期','正式行程連結','更新時間','目前沒有推廣素材。']) assert.ok(promotion.includes(label));
  assert.match(promotion, /safePromotionReference/);
  assert.doesNotMatch(promotion, /promotionId|versionId|knowledgeEntryId|workspaceId|crmPersonId|memberId|dealerId|campaignId|r2Key|storageKey/);
});

test('8F-UI formal Travel links use safe references and separate snapshots from live facts', () => {
  for (const value of ['正式行程連結','不連結正式行程','選擇行程','選擇出發日','safeItineraryReference','safeDepartureReference','尚未連結正式行程','DM 快照','即時資訊','目前已額滿','此出發日已取消']) assert.ok(promotion.includes(value), `missing ${value}`);
  assert.match(promotion, /liveTravel\.soldOut === true/);
  assert.match(promotion, /liveTravel\.currentBookability === true/);
  assert.doesNotMatch(promotion, /seatLimit\s*-|priceAmountMinor\s*[+*/]/);
});

test('8F-UI deterministic retrieval works without AI and copies only', () => {
  for (const value of ['測試旅客詢問','10 月有日本行程嗎？','/api/travel/promotions/search','符合條件的推廣素材','matchedFields','matchedKeywords','目前沒有符合條件且仍有效的推廣素材。','建議回覆','複製回覆','navigator.clipboard.writeText','不需要 AI']) assert.ok(promotion.includes(value), `missing ${value}`);
  assert.doesNotMatch(promotion, /AI 搜尋/);
});

test('8F-UI mirrors all composer formats and exact count rules', () => {
  assert.deepEqual(TRAVEL_PROMOTION_FORMATS.map(item => item.label), ['單張','輪播','列表','四格','六宮格']);
  for (const [format, valid, invalid] of [['SINGLE',1,2],['CAROUSEL',2,1],['LIST',10,11],['TRAVEL_4_GRID',4,3],['TRAVEL_6_GRID',6,5]]) { assert.equal(isTravelPromotionFormatCountValid(format, valid), true); assert.equal(isTravelPromotionFormatCountValid(format, invalid), false); }
  assert.match(promotion, /requestJson\(request, '\/api\/travel\/promotions\/compose'/);
  assert.match(promotion, /預覽推廣內容/);
  assert.match(promotion, /composition\.preview\?\.items/);
  assert.doesNotMatch(promotion, /Flex JSON|rawFlex|payload editor|contenteditable/i);
});

test('8F-UI reuses Campaign structured adapter and existing editor', () => {
  assert.match(promotion, /requestJson\(request, '\/api\/campaigns'/);
  assert.match(promotion, /contentType: 'TRAVEL_PROMOTION', composition: compositionBody/);
  assert.match(promotion, /建立行銷活動草稿/);
  assert.match(promotion, /此工作區尚未啟用行銷活動模組。推廣預覽仍可使用。/);
  assert.match(promotion, /該版本的推廣內容會被固定/);
  assert.match(app, /setCampaignHandoff\(campaign\)[^]*setCurrentView\('campaigns'\)/);
  assert.match(campaign, /initialCampaign\?\.safeCampaignReference[^]*setSelectedCampaign\(initialCampaign\)/);
  assert.equal((ui.match(/<CampaignEditor/g) || []).length, 1);
});

test('8F-UI roles, localized errors, privacy, and business boundaries remain safe', () => {
  assert.equal(canManageTravelPromotions('owner'), true); assert.equal(canManageTravelPromotions('admin'), true); assert.equal(canManageTravelPromotions('editor'), false); assert.equal(canManageTravelPromotions('viewer'), false);
  assert.equal(travelPromotionErrorMessage('TRAVEL_PROMOTION_AI_DISABLED'), '此工作區尚未啟用 AI 功能。');
  assert.equal(travelPromotionErrorMessage('TRAVEL_PROMOTION_COMPOSE_COUNT_INVALID'), '目前選取的素材數量不符合此格式。');
  assert.equal(travelPromotionErrorMessage('TRAVEL_PROMOTION_FORMAL_LINK_TARGET_MISMATCH'), '無法連結指定的正式行程。');
  for (const forbidden of ['api.line.me','pushMessage','broadcast','multicast','narrowcast','立即群發','直接推播','直接發送 LINE','dealer/reassign','referral/assign','commission/calculate','crm/stage','commerce/orders','travel/bookings','webhook']) assert.equal(promotion.toLowerCase().includes(forbidden.toLowerCase()), false, `must not include ${forbidden}`);
});
