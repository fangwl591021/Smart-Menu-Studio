import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [panel, editor] = await Promise.all([
  read('../src/components/CampaignClickEngagementPanel.jsx'),
  read('../src/components/CampaignEditor.jsx'),
]);

const cases = [
  ['1 click engagement section exists', panel, /data-testid="campaign-click-engagement-panel"[\s\S]*點擊互動/],
  ['2 semantic disclaimer exists', panel, /這是互動證據，不代表名單取得、成交、推薦、獎勵或佣金結果/],
  ['3 totalClicks is displayed', panel, /總點擊次數[\s\S]*summary\.totalClicks/],
  ['4 uniqueKnownPeople is displayed', panel, /已識別聯絡人數[\s\S]*summary\.uniqueKnownPeople/],
  ['5 anonymousClicks is displayed', panel, /匿名點擊次數[\s\S]*summary\.anonymousClicks/],
  ['6 firstClickedAt is displayed', panel, /首次點擊時間[\s\S]*summary\.firstClickedAt/],
  ['7 latestClickedAt is displayed', panel, /最近點擊時間[\s\S]*summary\.latestClickedAt/],
  ['8 anonymous uniqueness is never claimed', panel, /匿名(?:訪客|使用者|聯絡人)(?:人數|數)|Unique Anonymous/i, false],
  ['9 per-link summary exists', panel, /data-testid="campaign-click-link-summary"/],
  ['10 safe tracked link label is used', panel, /link\.trackedLinkLabel/],
  ['11 destinationHost is used', panel, /link\.destinationHost/],
  ['12 per-link click count is used', panel, /link\.totalClicks/],
  ['13 raw destination URL is not rendered', panel, /destinationUrl|https:\/\/\$\{|URLSearchParams/, false],
  ['14 internal tracked link ID is absent', panel, /trackedLinkId|tracked_link_id/, false],
  ['15 click event list exists', panel, /data-testid="campaign-click-event-list"/],
  ['16 occurredAt is displayed', panel, /formatTime\(click\.occurredAt\)/],
  ['17 trackedLinkLabel is displayed', panel, /click\.trackedLinkLabel/],
  ['18 ANONYMOUS is translated', panel, /kind === 'ANONYMOUS'[\s\S]*匿名訪客/],
  ['19 KNOWN_CRM_PERSON is translated', panel, /kind === 'KNOWN_CRM_PERSON'[\s\S]*已識別 CRM 聯絡人/],
  ['20 safePersonLabel is displayed', panel, /click\.safePersonLabel/],
  ['21 anonymous person label is unable to identify', panel, /click\.visitorKind === 'ANONYMOUS' \? '無法識別'/],
  ['22 opaque cursor is never rendered', panel, />\{nextCursor\}</, false],
  ['23 load more uses opaque next cursor', panel, /cursor=\$\{encodeURIComponent\(nextCursor\)\}[\s\S]*載入更多/],
  ['24 loading state exists', panel, /載入點擊互動資料中…/],
  ['25 empty state exists', panel, /目前尚無點擊互動紀錄/],
  ['26 safe error state exists', panel, /目前無法載入點擊互動資料，請稍後再試/],
  ['27 explicit refresh exists', panel, /onClick=\{loadAnalytics\}[\s\S]*重新整理/],
  ['28 no conversion count is calculated', panel, /conversionCount|轉換次數|成交次數/, false],
  ['29 no conversion rate is calculated', panel, /conversionRate|轉換率|成交率/, false],
  ['30 no acquisition source is shown', panel, /acquisitionSource|firstSource|latestSource|取得來源/, false],
  ['31 no referral metric is shown', panel, /referralCount|referralRate|推薦轉換率/, false],
  ['32 no points metric or action exists', panel, /pointCount|pointsBalance|增減點數|點數發放/, false],
  ['33 no commission metric or action exists', panel, /commissionAmount|commissionRate|佣金金額|建立佣金/, false],
  ['34 no open rate exists', panel, /openRate|Open Rate|開信率/, false],
  ['35 no CTR exists', panel, /\bCTR\b|clickThroughRate|點閱率/, false],
  ['36 UID or identity hash is absent', panel, /lineUid|lineUserId|identityHash|line_identity_hash/i, false],
  ['37 internal IDs are absent', panel, /crmPersonId|executionId|deliveryId|clickId|workspaceId/, false],
  ['38 IP data is absent', panel, /ipAddress|ipHash|cf-connecting-ip/i, false],
  ['39 user agent is absent', panel, /userAgent|user-agent/i, false],
  ['40 source_ref is absent', panel, /source_ref|sourceRef/, false],
  ['41 browser persistence is absent', panel, /localStorage|sessionStorage|indexedDB/, false],
  ['42 Campaign Builder remains present', editor, /data-testid="campaign-editor"/],
  ['43 Campaign Execution remains present', editor, /<CampaignExecutionPanel[\s\S]*userRole=\{userRole\}/],
  ['44 frozen audience panel remains present', editor, /<CampaignAudiencePanel[\s\S]*onPrepared=\{refreshCampaign\}/],
  ['45 resume authority component remains delegated', editor, /<CampaignExecutionPanel/],
  ['46 zh-TW engagement copy is present', panel, /匿名訪客[\s\S]*已識別 CRM 聯絡人[\s\S]*點擊互動/],
  ['47 CRM is read-only and not mutated', panel, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]|\/api\/crm\//, false],
];

for (const [name, source, pattern, expected = true] of cases) {
  test(name, () => expected ? assert.match(source, pattern) : assert.doesNotMatch(source, pattern));
}

test('backend summary and list routes are consumed without invented fields', () => {
  assert.ok(panel.includes("${base}/summary"));
  assert.ok(panel.includes("${base}?limit=25"));
  assert.doesNotMatch(panel, /impressions|sentCount|recipientCount|uniqueAnonymous/);
});

test('Campaign Builder structured-link authoring is integrated without mutating analytics', () => {
  assert.match(editor, /<CampaignStructuredLinkEditor[\s\S]*links=\{links\}/);
  assert.match(editor, /createStructuredCampaignContent\(text, links\)/);
  assert.doesNotMatch(panel, /method:/);
});
