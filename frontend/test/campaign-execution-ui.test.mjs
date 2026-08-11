import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [editor, panel, history, deliveries, presentation] = await Promise.all([
  read('../src/components/CampaignEditor.jsx'),
  read('../src/components/CampaignExecutionPanel.jsx'),
  read('../src/components/CampaignExecutionHistory.jsx'),
  read('../src/components/CampaignDeliveryList.jsx'),
  read('../src/utils/campaignExecutionPresentation.js'),
]);
const executionUi = `${panel}\n${history}\n${deliveries}\n${presentation}`;

const acceptance = [
  ['campaign detail imports execution panel', editor, /import CampaignExecutionPanel from '\.\/CampaignExecutionPanel'/],
  ['campaign detail renders execution panel', editor, /<CampaignExecutionPanel[\s\S]*campaign=\{campaign\}[\s\S]*request=\{request\}[\s\S]*userRole=\{userRole\}/],
  ['execution panel has stable landmark', panel, /data-testid="campaign-execution-panel"/],
  ['section title is localized', panel, />發送執行</],
  ['prepared snapshot frozen statement is exact', panel, /本次發送將使用已準備並凍結的受眾名單，不會重新查詢目前 CRM 分群。/],
  ['snapshot summary statement is exact', panel, /本次發送使用已凍結的受眾快照。/],
  ['draft receives precondition guidance', panel, /campaign\?\.status === 'DRAFT'[\s\S]*活動完成受眾準備後，才可執行發送。/],
  ['archived receives history-only guidance', panel, /campaign\?\.status === 'ARCHIVED'[\s\S]*此活動已封存，僅可查看發送歷程。/],
  ['owner and admin are managing roles', panel, /role === 'owner' \|\| role === 'admin'/],
  ['read-only roles receive explicit guidance', panel, /你目前具有唯讀權限，可查看發送狀態與歷程。/],
  ['execute control requires prepared campaign', panel, /campaign\?\.status === 'PREPARED' && canManage/],
  ['execute handler rechecks prepared authority', panel, /!canManage \|\| campaign\?\.status !== 'PREPARED'/],
  ['execute uses approved route', panel, /\/api\/campaigns\/\$\{encodeURIComponent\(campaignReference\)\}\/execute/],
  ['execute sends only transient action reference', panel, /body: JSON\.stringify\(\{ actionReference: actionReference\.current \}\)/],
  ['execute action reference uses crypto random UUID', panel, /campaign-execution-ui:\$\{crypto\.randomUUID\(\)\}/],
  ['execute dialog title is exact', panel, /確認發送 LINE 訊息/],
  ['execute confirmation is exact', panel, /確認要向此次已準備的受眾發送 LINE 訊息嗎？已成功送出的訊息無法撤回。/],
  ['execute confirmation includes eligible count', panel, /可發送人數：\{campaign\?\.eligibleCount \?\? 0\} 位/],
  ['execute confirmation includes message summary', panel, /訊息摘要：/],
  ['execute confirmation includes both frozen versions', panel, /內容版本 v[\s\S]*受眾版本 v/],
  ['precheck shows activity name', panel, />活動名稱</],
  ['precheck shows content version', panel, />內容版本</],
  ['precheck shows audience version', panel, />受眾版本</],
  ['precheck shows eligible and excluded counts', panel, /可發送／排除[\s\S]*eligibleCount[\s\S]*excludedCount/],
  ['precheck shows prepared time', panel, /準備時間[\s\S]*preparedAt/],
  ['execution list uses approved route', panel, /\/executions`\)/],
  ['execution detail uses approved route', panel, /\/executions\/\$\{encodeURIComponent\(executionReference\)\}`/],
  ['delivery list uses bounded pagination', panel, /\/deliveries\?limit=25&offset=\$\{offset\}/],
  ['delivery pagination uses backend next offset', panel, /setNextOffset\(payload\.nextOffset \?\? null\)/],
  ['running polling is seven seconds', panel, /setInterval[\s\S]*7000/],
  ['polling only starts for running', panel, /selectedExecution\?\.status !== 'RUNNING'/],
  ['polling cleanup clears interval', panel, /return \(\) => globalThis\.clearInterval\(timer\)/],
  ['history maps pending status', presentation, /PENDING: '等待執行'/],
  ['history maps running status', presentation, /RUNNING: '發送中'/],
  ['history maps completed status', presentation, /COMPLETED: '已完成'/],
  ['history maps partial failure status', presentation, /PARTIAL_FAILED: '部分失敗'/],
  ['history maps failed status', presentation, /FAILED: '發送失敗'/],
  ['history maps cancelled status', presentation, /CANCELLED: '已取消'/],
  ['history shows all approved counters', panel, /'總數'[\s\S]*'已發送'[\s\S]*'失敗'[\s\S]*'待處理'[\s\S]*'已取消'[\s\S]*'已略過'/],
  ['history does not render execution reference text', history, />\{execution\.safeExecutionReference\}</, false],
  ['delivery maps pending status', presentation, /PENDING: '待發送'/],
  ['delivery maps sending status', presentation, /SENDING: '發送中'/],
  ['delivery maps sent status', presentation, /SENT: '已發送'/],
  ['delivery maps failed status', presentation, /FAILED: '發送失敗'/],
  ['delivery maps cancelled status', presentation, /CANCELLED: '已取消'/],
  ['delivery maps skipped status', presentation, /SKIPPED: '已略過'/],
  ['delivery renders safe person label', deliveries, /delivery\.personLabel/],
  ['delivery renders backend attempt count', deliveries, /delivery\.attemptCount/],
  ['delivery renders only translated safe errors', deliveries, /safeDeliveryErrorLabel\(delivery\.safeErrorCode\)/],
  ['delivery renders attempted time', deliveries, /delivery\.attemptedAt/],
  ['rate limit error is localized', presentation, /LINE_RATE_LIMITED: 'LINE 發送頻率受限，可稍後重試。'/],
  ['timeout error is localized', presentation, /LINE_TIMEOUT: 'LINE 服務暫時無回應，可稍後重試。'/],
  ['server error is localized', presentation, /LINE_SERVER_ERROR: 'LINE 服務暫時異常，可稍後重試。'/],
  ['invalid recipient error is localized', presentation, /LINE_INVALID_RECIPIENT: '此收件人目前無法接收 LINE 訊息。'/],
  ['invalid credential error is localized', presentation, /LINE_INVALID_CREDENTIAL: 'LINE 官方帳號驗證失敗，請確認 Messaging API 設定。'/],
  ['invalid payload error is localized', presentation, /LINE_PAYLOAD_INVALID: '訊息內容格式不符合 LINE 發送規格。'/],
  ['provider rejection error is localized', presentation, /LINE_PROVIDER_REJECTED: 'LINE 拒絕此次發送。'/],
  ['unknown delivery error is safe and localized', presentation, /發送失敗，請稍後再試。/],
  ['resume button uses exact backend boolean authority', panel, /selectedExecution\.canResume === true && canManage[\s\S]*繼續未完成發送/],
  ['resume handler uses exact backend boolean authority', panel, /selectedExecution\?\.canResume !== true/],
  ['resume remaining count uses backend field', panel, /尚有 \{selectedExecution\.retryableRemaining \?\? 0\} 位可繼續處理/],
  ['resume explanation promises no duplicate sent recipients', panel, /系統只會繼續處理尚未成功的收件人，已發送成功者不會重複發送。/],
  ['resume uses approved execution endpoint', panel, /safeExecutionReference\)\}\/resume/],
  ['cancel control is execution-level', panel, /停止後續發送/],
  ['cancel confirmation preserves sent deliveries', panel, /已成功送出的訊息無法撤回；停止後僅取消尚未送出的收件人。/],
  ['cancel uses approved execution endpoint', panel, /safeExecutionReference\)\}\/cancel/],
  ['no delivery-level retry control exists', deliveries, /繼續未完成發送|resume|retry/i, false],
  ['retry eligibility is not inferred from attempt count', panel, /attemptCount/, false],
  ['retry eligibility is not inferred from safe error code', panel, /safeErrorCode/, false],
  ['retry eligibility is not inferred from execution status comparisons', panel, /status\s*===\s*'(?:FAILED|PARTIAL_FAILED)'[\s\S]*canResume|canResume[\s\S]*status\s*===\s*'(?:FAILED|PARTIAL_FAILED)'/, false],
  ['no browser persistence is used', executionUi, /localStorage|sessionStorage|indexedDB/, false],
  ['no LINE credential or token field is exposed', executionUi, /channelAccessToken|authorization|replyToken/i, false],
  ['no raw recipient identifier is exposed', executionUi, /providerRecipientId|lineMemberId|crmPersonId|userId|recipientHash/i, false],
  ['no schedule feature is added', executionUi, /scheduleAt|scheduledFor|排程發送/, false],
  ['no tracking feature is added', executionUi, /openTracking|clickTracking|追蹤開信/, false],
  ['no referral points commission or stage mutation exists', executionUi, /referral|points|commission|pipelineStage/i, false],
];

for (const [name, source, pattern, expected = true] of acceptance) {
  test(`7B-UI acceptance: ${name}`, () => {
    if (expected) assert.match(source, pattern);
    else assert.doesNotMatch(source, pattern);
  });
}

test('7B-UI focused suite contains at least 52 named acceptance checks', () => {
  assert.ok(acceptance.length >= 52, `expected at least 52 checks, received ${acceptance.length}`);
});
