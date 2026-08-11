import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [app, workspace, editor, audience, labels] = await Promise.all([
  read('../src/App.jsx'),
  read('../src/components/CampaignWorkspace.jsx'),
  read('../src/components/CampaignEditor.jsx'),
  read('../src/components/CampaignAudiencePanel.jsx'),
  read('../src/utils/presentationLabels.js'),
]);
const campaignUi = `${workspace}\n${editor}\n${audience}`;

const acceptance = [
  ['tenant navigation contains campaign entry', app, /id: 'campaigns', label: '行銷活動'/],
  ['tenant navigation permits campaign view', app, /'crm', 'campaigns', 'commerce', 'travel', 'ai-usage'/],
  ['application imports campaign workspace', app, /import CampaignWorkspace from '\.\/components\/CampaignWorkspace'/],
  ['application renders campaign workspace', app, /currentView === 'campaigns'[\s\S]*<CampaignWorkspace request=\{authFetch\} userRole=\{activeRole\}/],
  ['campaign workspace exposes stable test landmark', workspace, /data-testid="campaign-workspace"/],
  ['campaign list uses actual list contract', workspace, /requestJson\(request, '\/api\/campaigns'\)/],
  ['campaign list has loading state', workspace, /載入行銷活動中/],
  ['campaign list has error state', workspace, /無法載入行銷活動/],
  ['campaign list has empty state', workspace, /尚無行銷活動/],
  ['campaign list includes required columns', workspace, /活動名稱'[\s\S]*'狀態'[\s\S]*'內容版本'[\s\S]*'受眾版本'[\s\S]*'建立時間'[\s\S]*'更新時間'[\s\S]*'準備時間/],
  ['campaign detail uses safe campaign reference contract', workspace, /encodeURIComponent\(campaign\.safeCampaignReference\)/],
  ['owner and admin are the only managing roles', workspace, /role === 'owner' \|\| role === 'admin'/],
  ['read-only roles receive explicit guidance', workspace, /目前為唯讀權限/],
  ['campaign create uses actual create contract', editor, /requestJson\(request, '\/api\/campaigns',[\s\S]*method: 'POST'/],
  ['campaign draft update uses actual patch contract', editor, /safeCampaignReference\)\}`,[\s\S]*method: 'PATCH'/],
  ['campaign archive uses status contract', editor, /safeCampaignReference\)\}\/status`[\s\S]*status: 'ARCHIVED'/],
  ['campaign archive requires confirmation', editor, /confirm\?\.\('確定要封存此活動嗎/],
  ['prepared campaign is frozen and read-only', editor, /campaign\?\.status === 'PREPARED'[\s\S]*此版本已凍結/],
  ['archived campaign is read-only', editor, /campaign\?\.status === 'ARCHIVED'[\s\S]*目前僅供查看/],
  ['prepared status has zh-TW label', labels, /PREPARED: '已準備'/],
  ['content contract is TEXT only', editor, /content = \{ contentType: 'TEXT', text \}/],
  ['content textarea is limited to 5000 characters', editor, /<textarea[\s\S]*maxLength=\{5000\}/],
  ['content length is displayed', editor, /\{textLength\} \/ 5000/],
  ['invalid empty or oversized content is rejected', editor, /!text\.trim\(\) \|\| textLength > 5000/],
  ['draft save explains immutable version creation', editor, /儲存會建立新的不可變版本，舊版本不會被覆寫/],
  ['content version history is read-only', editor, /內容版本歷程（唯讀）/],
  ['content version history renders backend versions', editor, /campaign\.contentVersions\.map/],
  ['saved segments use the actual CRM contract', workspace, /requestJson\(request, '\/api\/crm\/segments'\)/],
  ['segment failure does not block campaign list', workspace, /活動清單仍可繼續使用/],
  ['only active saved segments are selectable', audience, /segments\.filter\(\(segment\) => segment\.status === 'ACTIVE'\)/],
  ['segment selection uses safe references', audience, /value=\{segment\.safeSegmentReference\}/],
  ['segment picker displays segment version', audience, /segment\.currentVersion/],
  ['live preview uses campaign preview contract', audience, /\/preview`[\s\S]*safeSegmentReference: selectedSegmentReference/],
  ['live preview explains current CRM calculation', audience, /預覽依目前 CRM 資料即時計算。/],
  ['live preview explicitly creates no snapshot', audience, /預覽不會建立受眾快照。/],
  ['live preview shows candidate eligible excluded counts', audience, /候選人數[\s\S]*可發送人數[\s\S]*排除人數/],
  ['live preview is capped at 25 visible people', audience, /預覽名單（最多 \{preview\.maxPreview \|\| 25\} 人）/],
  ['truncated preview explains full-count authority', audience, /名單僅顯示前 25 人，統計數字仍以完整即時計算為準/],
  ['archived person exclusion is translated', audience, /PERSON_ARCHIVED: '客戶已封存'/],
  ['do-not-contact exclusion is translated', audience, /DO_NOT_CONTACT: '已設定不聯絡'/],
  ['not-contactable exclusion is translated', audience, /NOT_CONTACTABLE: '目前不可聯絡'/],
  ['missing marketing consent exclusion is translated', audience, /MARKETING_CONSENT_MISSING: '尚未取得行銷同意'/],
  ['missing verified LINE identity exclusion is translated', audience, /NO_VERIFIED_LINE_IDENTITY: '尚未連結已驗證 LINE 身分'/],
  ['eligibility disclaimer says no message was sent', audience, /可發送僅代表目前具備系統所需的 LINE 身分條件，尚未發送任何訊息/],
  ['prepare uses actual prepare contract', audience, /\/prepare`[\s\S]*method: 'POST'/],
  ['prepare requires explicit freeze confirmation', audience, /準備後會凍結此次內容版本與受眾快照/],
  ['prepare sends the safe segment reference', audience, /safeSegmentReference: selectedSegmentReference/],
  ['prepare uses a transient idempotency reference', audience, /useRef\(''\)[\s\S]*campaign-ui:\$\{crypto\.randomUUID\(\)\}/],
  ['prepared audience uses actual read contract', audience, /\/audience`/],
  ['prepared audience shows frozen safe summary', audience, /後續 CRM 資料變更不會改寫目前受眾/],
  ['prepared audience shows content and audience versions', audience, /內容版本[\s\S]*受眾版本[\s\S]*準備時間/],
  ['campaign UI never persists campaign state in browser storage', campaignUi, /localStorage|sessionStorage|indexedDB/, false],
  ['campaign UI does not expose raw internal identifiers', campaignUi, /campaignId|audienceId|snapshotId|crm_person_id|line_member_id|source_ref|actionHash/, false],
  ['campaign UI contains no LINE Messaging API execution', campaignUi, /api\.line\.me|pushMessage|broadcast|multicast|narrowcast/, false],
  ['campaign UI contains no delivery scheduling or retry controls', campaignUi, /deliveryAt|scheduleAt|retryMessage|deliveryStatus/, false],
  ['campaign UI contains no AI generation action', campaignUi, /OpenAI|generateCampaign|AI 生成|自動生成文案/i, false],
  ['campaign UI contains no referral mutation', campaignUi, /referral|referrer|推薦關係|推薦人異動/i, false],
  ['campaign UI contains no points mutation', campaignUi, /points|pointLedger|點數異動|增減點數/i, false],
  ['campaign UI contains no commission mutation', campaignUi, /commission|佣金異動|新增佣金/i, false],
  ['campaign UI contains no stage mutation', campaignUi, /pipelineStage|stageReference|變更階段/i, false],
];

for (const [name, source, pattern, expected = true] of acceptance) {
  test(`7A-UI acceptance: ${name}`, () => {
    if (expected) assert.match(source, pattern);
    else assert.doesNotMatch(source, pattern);
  });
}

test('7A-UI focused suite contains at least 42 named acceptance checks', () => {
  assert.ok(acceptance.length >= 42, `expected at least 42 checks, received ${acceptance.length}`);
});
