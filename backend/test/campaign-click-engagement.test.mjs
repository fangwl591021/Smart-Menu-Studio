import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { recipientTrackedContent } from '../src/campaign/clicks.ts';

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [migration, clicks, routes, executions, campaigns, content, index] = await Promise.all([
  read('../migrations/0045_campaign_click_engagement.sql'), read('../src/campaign/clicks.ts'),
  read('../src/campaign/click-routes.ts'), read('../src/campaign/executions.ts'),
  read('../src/campaign/campaigns.ts'), read('../src/campaign/content.ts'), read('../src/index.ts'),
]);
const db = { prepare: sql => ({ sql, bind(...args) { return { sql, args }; } }) };
const structured = JSON.stringify({ text: 'Offer {{link:offer}}', links: [{ token: 'offer', destinationUrl: 'https://shop.example/p?a=1', label: 'Offer' }] });
const render = overrides => recipientTrackedContent({
  db, workspaceId: 'workspace-internal', campaignId: 'campaign-internal', executionId: 'execution-internal',
  deliveryId: 'delivery-internal', contentType: 'TEXT', payloadJson: structured,
  links: [{ id: 'link-internal', publicRef: 'a'.repeat(64), token: 'offer', destinationUrl: 'https://shop.example/p?a=1', label: 'Offer' }],
  signingSecret: 'test-secret-not-production', trackingBaseUrl: 'https://worker.example', createContexts: true, ...overrides,
});

test('1 structured token resolves to tracked URL', async () => assert.match((await render()).text, /^Offer https:\/\/worker\.example\/t\/[a-f0-9]{64}\?c=[a-f0-9]{64}$/));
test('2 plain raw URL is untouched', async () => assert.equal((await render({ payloadJson: JSON.stringify({ text: 'https://plain.example/?x=1' }), links: [] })).text, 'https://plain.example/?x=1'));
test('3 undeclared token remains fail closed', async () => await assert.rejects(render({ payloadJson: JSON.stringify({ text: '{{link:nope}}', links: [{ token: 'offer', destinationUrl: 'https://shop.example/', label: 'Offer' }] }) }), /CAMPAIGN_EXECUTION_CONTENT_INVALID/));
test('4 frozen content version is execution authority', () => assert.match(executions, /prepared_content_version_no[\s\S]*campaign_content_versions/));
test('5 tracked destination is immutable', () => assert.match(migration, /campaign_tracked_links_no_update[\s\S]*CAMPAIGN_TRACKED_LINK_IMMUTABLE/));
test('6 tracked destinations are HTTPS only', () => assert.match(`${content}\n${migration}`, /https:[\s\S]*destination_url LIKE 'https:\/\/%'/));
test('7 valid opaque URL uses redirect', () => assert.match(routes, /c\.redirect\(resolved\.destinationUrl, 302\)/));
test('8 forged reference is rejected', () => assert.match(clicks, /equalOpaque\(reference, expectedLink\)/));
test('9 unknown reference is safe 404', () => assert.match(routes, /if \(!resolved\) return c\.text\('Not found', 404\)/));
test('10 click event is append only', () => assert.match(migration, /campaign_click_events_no_update[\s\S]*campaign_click_events_no_delete/));
test('11 evidence failure still redirects', () => assert.match(routes, /waitUntil\(resolved\.evidence\.catch[\s\S]*c\.redirect/));
test('12 redirect leaks no internal error', () => assert.match(routes, /catch \{[\s\S]*c\.text\('Not found', 404\)/));
test('13 archived campaign link remains resolvable', () => assert.doesNotMatch(clicks.match(/export async function resolveCampaignClick[\s\S]*?(?=\nfunction destinationHost)/)?.[0] || '', /campaign.*status|archived_at/));
test('14 anonymous click remains anonymous', () => assert.match(clicks, /visitorKind: 'ANONYMOUS' \| 'KNOWN_CRM_PERSON' = 'ANONYMOUS'/));
test('15 anonymous click creates no Person', () => assert.doesNotMatch(clicks, /INSERT INTO crm_people/));
test('16 recipient click resolves exact frozen Person', () => assert.match(clicks, /JOIN campaign_deliveries d[\s\S]*crm_person_id/));
test('17 wrong-workspace recipient context is blocked', () => assert.match(clicks, /x\.workspace_id=\?[\s\S]*x\.campaign_id=\?/));
test('18 raw identity is absent from tracking URL', async () => { const url=(await render()).text; for (const raw of ['workspace-internal','campaign-internal','execution-internal','delivery-internal','link-internal']) assert.doesNotMatch(url, new RegExp(raw)); });
test('19 UID and hash are absent from redirect response', () => assert.doesNotMatch(routes, /line_uid|lineUserId|identity_hash/));
test('20 known Person click inserts click evidence', () => assert.match(clicks, /INSERT INTO campaign_click_events/));
test('21 known click creates no acquisition event', () => assert.doesNotMatch(clicks, /crm_acquisition_events/));
test('22 latest acquisition is unchanged', () => assert.doesNotMatch(clicks, /latestSource|latest_source/));
test('23 first acquisition is unchanged', () => assert.doesNotMatch(clicks, /firstSource|first_source/));
test('24 repeated clicks are preserved', () => assert.doesNotMatch(migration, /UNIQUE\([^\n]*tracked_link_id[^\n]*crm_person_id/));
test('25 referral authority is untouched', () => assert.doesNotMatch(clicks, /member_referral_attributions/));
test('26 summary returns totalClicks', () => assert.match(clicks, /totalClicks: Number/));
test('27 summary returns uniqueKnownPeople', () => assert.match(clicks, /uniqueKnownPeople: Number/));
test('28 summary returns anonymousClicks', () => assert.match(clicks, /anonymousClicks: Number/));
test('29 summary returns firstClickedAt', () => assert.match(clicks, /firstClickedAt:/));
test('30 summary returns latestClickedAt', () => assert.match(clicks, /latestClickedAt:/));
test('31 summary groups clicks by tracked link', () => assert.match(clicks, /clicksByTrackedLink:/));
test('32 projection exposes destination host only', () => { assert.match(clicks, /destinationHost:/); const projection=clicks.match(/clicks: page\.map[\s\S]*?nextCursor:/)?.[0] || ''; assert.doesNotMatch(projection, /destinationUrl/); });
test('33 read projection contains no internal IDs', () => { const projection=clicks.match(/clicks: page\.map[\s\S]*?nextCursor:/)?.[0] || ''; assert.doesNotMatch(projection, /workspaceId|campaignId|trackedLinkId|executionId|deliveryId|crmPersonId/); });
test('34 click ordering is deterministic', () => assert.match(clicks, /ORDER BY e\.occurred_at DESC,e\.cursor_ref DESC/));
test('35 cursor is opaque and signed', () => assert.match(clicks, /PURPOSE_CURSOR[\s\S]*encodeCursor/));
test('36 forged cursor is blocked', () => assert.match(clicks, /equalOpaque\(signature, expected\)/));
test('37 pages use strict keyset boundaries', () => assert.match(clicks, /e\.occurred_at<\?[\s\S]*e\.cursor_ref<\?/));
test('38 click DB ID is absent from cursor', () => assert.doesNotMatch(clicks.match(/async function encodeCursor[\s\S]*?(?=\nasync function decodeCursor)/)?.[0] || '', /\bid\b/i));
test('39 raw IP is absent', () => assert.doesNotMatch(`${migration}\n${clicks}`, /\bip_address\b|cf-connecting-ip/i));
test('40 IP hash is absent', () => assert.doesNotMatch(`${migration}\n${clicks}`, /ip_hash/i));
test('41 raw user-agent is absent', () => assert.doesNotMatch(`${migration}\n${clicks}`, /user-agent|user_agent/i));
test('42 UID and identity hash are absent', () => assert.doesNotMatch(`${migration}\n${clicks}\n${routes}`, /line_uid|identity_hash/i));
test('43 CRM internal ID is absent from public mapping', () => assert.doesNotMatch(clicks.match(/clicks: page\.map[\s\S]*?\}\)\),/)?.[0] || '', /crm_person_id/));
test('44 execution and delivery IDs are absent from public mapping', () => assert.doesNotMatch(clicks.match(/clicks: page\.map[\s\S]*?\}\)\),/)?.[0] || '', /execution_id|delivery_id/));
test('45 tracking URL contains only opaque refs', async () => assert.match((await render()).text, /\/t\/[a-f0-9]{64}\?c=[a-f0-9]{64}$/));
test('46 no acquisition mutation exists', () => assert.doesNotMatch(clicks, /INSERT INTO crm_acquisition|UPDATE crm_acquisition/));
test('47 no Referral mutation exists', () => assert.doesNotMatch(clicks, /INSERT INTO member_referral|UPDATE member_referral/));
test('48 no Dealer mutation exists', () => assert.doesNotMatch(clicks, /INSERT INTO dealers|UPDATE dealers/));
test('49 no Points or Rewards mutation exists', () => assert.doesNotMatch(clicks, /INSERT INTO (?:point|reward)|UPDATE (?:point|reward)/i));
test('50 no Contribution or Tier mutation exists', () => assert.doesNotMatch(clicks, /contribution|tier/i));
test('51 no Commission or Payout mutation exists', () => assert.doesNotMatch(clicks, /commission|payout/i));
test('52 no Stage mutation exists', () => assert.doesNotMatch(clicks, /pipeline_stage|stage_event/i));
test('53 no Follow-up mutation exists', () => assert.doesNotMatch(clicks, /follow.?up/i));
test('54 no Tag or Profile mutation exists', () => assert.doesNotMatch(clicks, /INSERT INTO crm_(?:tags|profiles)|UPDATE crm_(?:tags|profiles)/i));
test('55 no open tracking exists', () => assert.doesNotMatch(`${clicks}\n${routes}`, /pixel|open_event|read_receipt/i));
test('56 no AI exists', () => assert.doesNotMatch(`${clicks}\n${routes}`, /gemini|openai|ai_score|classification/i));

test('migration is additive and contains no data rewrite or seed', () => {
  const executable = migration.replace(/^--.*$/gm, '');
  assert.doesNotMatch(executable, /^\s*(?:DROP\b|DELETE\s+FROM\b|UPDATE\s+(?:campaign|crm|member|point|reward))/im);
  assert.doesNotMatch(executable, /INSERT\s+INTO\s+(?:campaign_click_events|campaign_tracked_links|campaign_click_contexts)/i);
});
test('public route is registered and performs no LINE provider call', () => {
  assert.match(index, /registerCampaignClickRoutes/);
  assert.doesNotMatch(routes, /sendLine|push|broadcast|multicast|narrowcast/);
});
test('prepare registers links server-side and execution uses per-delivery resolver', () => {
  assert.match(campaigns, /trackedLinkRegistrationStatements/);
  assert.match(executions, /recipientTrackedContent/);
});
