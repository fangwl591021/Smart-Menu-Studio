import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CAMPAIGN_TRACKED_LINK_MAX_COUNT,
  createStructuredCampaignContent,
  humanizeTrackedLinkText,
  isValidTrackedLinkDestination,
  nextTrackedLinkToken,
  removeTrackedLinkPlaceholder,
  trackedLinkPlaceholder,
  validateStructuredLinkDraft,
} from '../src/utils/campaignStructuredLinks.js';

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [editor, structuredEditor, audience, analytics] = await Promise.all([
  read('../src/components/CampaignEditor.jsx'),
  read('../src/components/CampaignStructuredLinkEditor.jsx'),
  read('../src/components/CampaignAudiencePanel.jsx'),
  read('../src/components/CampaignClickEngagementPanel.jsx'),
]);
const source = `${editor}\n${structuredEditor}`;
const link = (token = 'link_1', destinationUrl = 'https://example.com/event', label = '活動報名') => ({ token, destinationUrl, label });

const cases = [
  ['1 add tracked link action exists', structuredEditor, /新增追蹤連結/],
  ['2 visual authoring section exists', structuredEditor, /data-testid="campaign-structured-link-editor"/],
  ['3 manual token entry is not required', structuredEditor, /aria-label="(?:token|權杖|代碼)"/i, false],
  ['4 link name field exists', structuredEditor, /aria-label="連結名稱"/],
  ['5 HTTPS destination field exists', structuredEditor, /aria-label="目的網址"[\s\S]*https:\/\/example\.com\/event/],
  ['6 deterministic token helper is used', structuredEditor, /nextTrackedLinkToken\(links\)/],
  ['7 max ten is visible and enforced', structuredEditor, /CAMPAIGN_TRACKED_LINK_MAX_COUNT[\s\S]*links\.length >= CAMPAIGN_TRACKED_LINK_MAX_COUNT/],
  ['8 insert action is cursor aware', editor, /trackedLinkPlaceholder[\s\S]*selectionStart[\s\S]*selectionEnd/],
  ['9 implementation token is not rendered as a normal label', structuredEditor, />\{link\.token\}</, false],
  ['10 structured content helper is submitted', editor, /createStructuredCampaignContent\(text, links\)[\s\S]*JSON\.stringify/],
  ['11 link chips show human label', structuredEditor, />\{link\.label\}</],
  ['12 link chips show destination host only', structuredEditor, /new URL\(link\.destinationUrl\)\.hostname/],
  ['13 edit action exists', structuredEditor, />編輯</],
  ['14 remove action exists', structuredEditor, />移除</],
  ['15 count is presented as current over ten', structuredEditor, /追蹤連結 \{links\.length\} \/ \{CAMPAIGN_TRACKED_LINK_MAX_COUNT\}/],
  ['16 legacy current content safely defaults links', editor, /Array\.isArray\(campaign\?\.currentContent\?\.links\)[\s\S]*: \[\]/],
  ['17 PATCH versioning route remains used', editor, /method: 'PATCH'[\s\S]*content/],
  ['18 old version remains read-only', editor, /內容版本歷程（唯讀）/],
  ['19 prepared content disables authoring', editor, /const canEdit = canManage && isDraft[\s\S]*disabled=\{!canEdit\}/],
  ['20 historical link mapping is visible', editor, /version\.links\.map[\s\S]*link\.label[\s\S]*link\.destinationUrl/],
  ['21 used-link removal requires confirmation', structuredEditor, /text\.includes\(placeholder\)[\s\S]*globalThis\.confirm/],
  ['22 unused-link removal remains available', structuredEditor, /onLinksChange\(links\.filter/],
  ['23 exact placeholder removal helper is used', structuredEditor, /removeTrackedLinkPlaceholder\(text, link\.token\)/],
  ['24 preview uses humanized content', structuredEditor, /humanizeTrackedLinkText\(text, links\)/],
  ['25 preview explains no recipient URL creation', structuredEditor, /不會建立或呼叫收件者專屬追蹤網址/],
  ['26 no frontend tracking redirect endpoint is constructed', source, /['"`]\/t\//, false],
  ['27 no redirect-link creation API is called', source, /redirect-link|tracked-links\/(?:create|register)/i, false],
  ['28 no tracked-link database ID is exposed', structuredEditor, /trackedLinkId|tracked_link_id/, false],
  ['29 no click context ID is exposed', structuredEditor, /clickContextId|click_context_id/, false],
  ['30 no execution or delivery ID is exposed', structuredEditor, /executionId|deliveryId|execution_id|delivery_id/, false],
  ['31 no CRM or LINE identity is exposed', structuredEditor, /crmPersonId|lineUid|lineUserId|identityHash/i, false],
  ['32 no signed tracking reference is exposed', structuredEditor, /signedTracking|trackingSignature|safeTrackingReference/i, false],
  ['33 no browser persistence is used', source, /localStorage|sessionStorage|indexedDB/, false],
  ['34 click semantics are engagement-only', structuredEditor, /只代表收件者曾點擊/],
  ['35 conversion is explicitly not claimed', structuredEditor, /不代表成交/],
  ['36 acquisition is explicitly not claimed', structuredEditor, /名單取得/],
  ['37 referral and economy are explicitly not claimed', structuredEditor, /推薦、獎勵或佣金結果/],
  ['38 Campaign create remains present', editor, /requestJson\(request, '\/api\/campaigns'[\s\S]*method: 'POST'/],
  ['39 TEXT editor remains present', editor, /<textarea[\s\S]*maxLength=\{5000\}/],
  ['40 content version history remains present', editor, /campaign\.contentVersions\.map/],
  ['41 audience preview remains present', editor, /<CampaignAudiencePanel/],
  ['42 prepare flow remains delegated', audience, /\/prepare`[\s\S]*method: 'POST'/],
  ['43 execution UI remains present', editor, /<CampaignExecutionPanel/],
  ['44 click analytics remains present', editor, /<CampaignClickEngagementPanel/],
  ['45 analytics remains separate and read-only', analytics, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/, false],
  ['46 normal raw URLs are explained as untracked', structuredEditor, /一般網址仍會保持原樣且不會自動追蹤/],
  ['47 frozen tracked links explain read-only behavior', structuredEditor, /內容已凍結或目前為唯讀，追蹤連結不可編輯/],
  ['48 visible terminology is zh-TW', structuredEditor, /追蹤連結[\s\S]*連結名稱[\s\S]*目的網址[\s\S]*插入訊息/],
  ['49 backend token terminology is not a visible field', structuredEditor, />\s*(?:Token|Placeholder|Tracking Reference|權杖|預留位置)\s*</i, false],
];

for (const [name, target, pattern, expected = true] of cases) {
  test(`7C-UI-A acceptance: ${name}`, () => expected ? assert.match(target, pattern) : assert.doesNotMatch(target, pattern));
}

test('safe deterministic tokens conform and remain bounded', () => {
  assert.equal(nextTrackedLinkToken([]), 'link_1');
  assert.equal(nextTrackedLinkToken([link('link_1')]), 'link_2');
  assert.match(nextTrackedLinkToken([]), /^[A-Za-z0-9_-]{1,40}$/);
  assert.equal(CAMPAIGN_TRACKED_LINK_MAX_COUNT, 10);
});

test('HTTPS validation accepts safe HTTPS and rejects unsafe schemes', () => {
  assert.equal(isValidTrackedLinkDestination('https://example.com/event'), true);
  for (const value of ['http://example.com', 'javascript:alert(1)', 'data:text/plain,x', 'file:///tmp/x', 'blob:https://example.com/x']) {
    assert.equal(isValidTrackedLinkDestination(value), false);
  }
});

test('duplicate, unused, unresolved, reused, and excess links fail closed', () => {
  assert.equal(validateStructuredLinkDraft('{{link:link_1}}', [link(), link()]), 'CAMPAIGN_CONTENT_LINK_TOKEN_DUPLICATE');
  assert.equal(validateStructuredLinkDraft('plain', [link()]), 'CAMPAIGN_CONTENT_LINK_UNUSED');
  assert.equal(validateStructuredLinkDraft('{{link:other}}', [link()]), 'CAMPAIGN_CONTENT_LINK_TOKEN_UNDECLARED');
  assert.equal(validateStructuredLinkDraft('{{link:link_1}} {{link:link_1}}', [link()]), 'CAMPAIGN_CONTENT_LINK_TOKEN_REUSED');
  const eleven = Array.from({ length: 11 }, (_, index) => link(`link_${index + 1}`));
  assert.equal(validateStructuredLinkDraft(eleven.map(item => trackedLinkPlaceholder(item.token)).join(' '), eleven), 'CAMPAIGN_CONTENT_LINKS_INVALID');
});

test('legacy content and raw URLs stay byte-for-byte untracked', () => {
  const text = '請看 https://example.com/event';
  assert.deepEqual(createStructuredCampaignContent(text, []), { contentType: 'TEXT', text });
  assert.equal(humanizeTrackedLinkText(text, []), text);
});

test('structured content submits exact backend shape', () => {
  const definition = link();
  assert.deepEqual(createStructuredCampaignContent('{{link:link_1}}', [definition]), {
    contentType: 'TEXT', text: '{{link:link_1}}', links: [definition],
  });
});

test('exact removal and human preview leave unrelated text and raw URLs untouched', () => {
  const text = '前文 {{link:link_1}} 中段 https://example.net 後文';
  assert.equal(removeTrackedLinkPlaceholder(text, 'link_1'), '前文  中段 https://example.net 後文');
  assert.equal(humanizeTrackedLinkText(text, [link()]), '前文 [活動報名] 中段 https://example.net 後文');
});
