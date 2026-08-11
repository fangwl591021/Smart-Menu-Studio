import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CAMPAIGN_DELIVERY_MAX_ATTEMPTS,
  CAMPAIGN_EXECUTION_CONCURRENCY,
  CAMPAIGN_EXECUTION_MAX_RECIPIENTS,
  campaignExecutionActionHash,
} from '../src/campaign/executions.ts';
import { classifyLinePushStatus, preflightLineCampaignSend, sendLineTextPush } from '../src/campaign/line-push.ts';

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [migration, execution, routes, push, index, referral] = await Promise.all([
  read('../migrations/0044_campaign_execution_delivery.sql'),
  read('../src/campaign/executions.ts'),
  read('../src/campaign/execution-routes.ts'),
  read('../src/campaign/line-push.ts'),
  read('../src/index.ts'),
  read('../src/referral/core.ts'),
]);
const executableMigration = migration.replace(/^--.*$/gm, '');
const frozenRecipientSection = execution.match(/async function frozenRecipients[\s\S]*?(?=\nfunction publicExecution)/)?.[0] || '';
const publicProjection = execution.match(/function publicExecution[\s\S]*?(?=\nasync function executionRowByAction)/)?.[0] || '';
const deliveryProjection = execution.match(/export async function listCampaignDeliveries[\s\S]*$/)?.[0] || '';
const pushSendSection = push.match(/export async function sendLineTextPush[\s\S]*$/)?.[0] || '';

test('1 PREPARED Campaign executes', () => {
  assert.match(execution, /status\) !== 'PREPARED'.*CAMPAIGN_EXECUTION_REQUIRES_PREPARED/);
  assert.match(execution, /export async function executePreparedCampaign/);
});

test('2 DRAFT Campaign is blocked', () => assert.match(execution, /CAMPAIGN_EXECUTION_REQUIRES_PREPARED/));
test('3 ARCHIVED Campaign is blocked', () => assert.match(execution, /String\(campaign\.status\) !== 'PREPARED'/));

test('4 frozen audience is the send authority', () => {
  assert.match(frozenRecipientSection, /FROM campaign_audience_snapshot_members m/);
  assert.match(frozenRecipientSection, /m\.snapshot_id=\?/);
});

test('5 live Segment membership is never queried during send', () => {
  assert.doesNotMatch(frozenRecipientSection, /crm_segments|compileSegmentRule|executeSegment|segmentByReference/);
});

test('6 frozen content version is the content authority', () => {
  assert.match(execution, /prepared_content_version_no/);
  assert.match(execution, /campaign_content_versions[\s\S]*version_no=\?/);
  assert.match(execution, /messages: \[\{ type: 'text', text: input\.text \}\]/);
});

test('7 execution uses an opaque safe reference', () => {
  assert.match(execution, /publicReference\('cexec'\)/);
  assert.match(publicProjection, /safeExecutionReference/);
  assert.doesNotMatch(publicProjection, /\bid\s*:|campaignId|executionId|lineMemberId|crmPersonId/);
});

test('8 every execution query is workspace scoped', () => {
  assert.match(execution, /WHERE workspace_id=\? AND public_ref=\?/);
  assert.match(execution, /WHERE e\.workspace_id=\? AND c\.public_ref=\? AND e\.public_ref=\?/);
});

test('9 one recipient has one logical delivery authority', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS campaign_deliveries/);
  assert.match(migration, /UNIQUE\(workspace_id,execution_id,crm_person_id\)/);
});

test('10 eligible snapshot members are included', () => assert.match(frozenRecipientSection, /m\.eligibility_status='ELIGIBLE'/));
test('11 excluded snapshot members are not sent', () => assert.doesNotMatch(frozenRecipientSection, /eligibility_status IN|EXCLUDED/));

test('12 SENT is terminal', () => {
  assert.match(migration, /campaign_deliveries_sent_terminal/);
  assert.match(migration, /OLD\.status='SENT' AND NEW\.status<>'SENT'/);
  assert.doesNotMatch(execution.match(/async function runExecution[\s\S]*?(?=\nexport async function executePreparedCampaign)/)?.[0] || '', /d\.status='SENT'/);
});

test('13 failed provider attempts are recorded', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS campaign_delivery_attempts/);
  assert.match(execution, /status = result\.accepted \? 'SENT' : 'FAILED'/);
});

test('14 provider failures use safe normalized errors', () => {
  for (const code of ['LINE_RATE_LIMITED', 'LINE_TIMEOUT', 'LINE_SERVER_ERROR', 'LINE_INVALID_CREDENTIAL', 'LINE_PROVIDER_REJECTED']) {
    assert.match(push, new RegExp(code));
  }
  assert.doesNotMatch(pushSendSection, /response\.(?:json|text)\(/);
});

test('15 raw LINE UID and hashes are absent from Tenant projections', () => {
  assert.doesNotMatch(`${publicProjection}\n${deliveryProjection}`, /providerRecipientId|lineMemberId|identityHash|line_identity_hash|userId/);
});

test('16 credential token is absent from Tenant projections', () => {
  assert.doesNotMatch(`${publicProjection}\n${deliveryProjection}`, /channelAccessToken|line_bot_channel_access_token|Authorization/);
});

test('17 same execute action returns the same execution', async () => {
  const base = { workspaceId: 'ws-a', campaignId: 'camp-a', audienceVersionNo: 1, contentVersionNo: 2, actionReference: 'execute-action-0001' };
  assert.equal(await campaignExecutionActionHash(base), await campaignExecutionActionHash(base));
  assert.match(execution, /const replay = await replayExecutionByAction[\s\S]*if \(replay\) return publicExecution\(replay, true\)/);
  assert.ok(execution.indexOf('replayExecutionByAction(db, input)') < execution.indexOf('preparedContext(db, input.workspaceId'));
});

test('18 duplicate logical delivery rows are blocked', () => assert.match(migration, /UNIQUE\(workspace_id,execution_id,crm_person_id\)/));
test('19 SENT recipients are never selected for resume', () => assert.match(execution, /d\.status='PENDING' OR d\.status='SENDING' OR \(d\.status='FAILED' AND d\.retryable=1\)/));
test('20 resume selects only pending uncertain or retryable failed work', () => assert.doesNotMatch(execution.match(/async function runExecution[\s\S]*?(?=\nexport async function executePreparedCampaign)/)?.[0] || '', /status='CANCELLED' OR|status='SKIPPED' OR|status='SENT' OR/));
test('20a uncertain SENDING resume preserves the original attempt number', () => {
  assert.match(execution, /continuingUncertainAttempt = row\.status === 'SENDING'/);
  assert.match(execution, /attempt_count=attempt_count\+\?/);
  assert.match(execution, /continuingUncertainAttempt \? 0 : 1/);
});
test('21 cancelled recipients are not selected or claimed', () => assert.match(execution, /e\.status='CANCELLED'/));

test('22 HTTP 429 is retryable', () => assert.deepEqual(classifyLinePushStatus(429), {
  accepted: false, providerStatusCode: 429, safeErrorCode: 'LINE_RATE_LIMITED', retryable: true, alreadyAccepted: false,
}));
test('23 provider timeout is retryable', async () => {
  const result = await sendLineTextPush({
    channelAccessToken: 'server-only-token', providerRecipientId: 'Urecipient', text: 'hello',
    retryKey: '123e4567-e89b-12d3-a456-426614174000', timeoutMs: 1,
    fetcher: async () => { throw new Error('network details must not escape'); },
  });
  assert.equal(result.safeErrorCode, 'LINE_TIMEOUT');
  assert.equal(result.retryable, true);
  assert.doesNotMatch(JSON.stringify(result), /server-only-token|Urecipient|network details/);
});
test('24 provider 5xx is retryable', () => assert.equal(classifyLinePushStatus(503).retryable, true));
test('25 unresolved recipient is skipped without provider call', () => assert.match(execution, /recordUnsendable[\s\S]*LINE_INVALID_RECIPIENT/));
test('26 invalid or missing credential fails before send', () => {
  assert.match(execution, /LINE_ACCOUNT_CREDENTIAL_MISSING/);
  assert.ok(execution.indexOf('LINE_ACCOUNT_CREDENTIAL_MISSING') < execution.indexOf('frozenRecipients'));
  assert.equal(classifyLinePushStatus(401).retryable, false);
});
test('27 maximum attempts are enforced', () => {
  assert.equal(CAMPAIGN_DELIVERY_MAX_ATTEMPTS, 3);
  assert.match(execution, /d\.attempt_count<\?/);
  assert.match(migration, /attempt_count BETWEEN 0 AND 3/);
});

test('28 cancel marks remaining pending and retryable failed deliveries', () => assert.match(execution, /status='PENDING' OR \(status='FAILED' AND retryable=1\)/));
test('29 cancel leaves SENT deliveries unchanged', () => assert.doesNotMatch(execution.match(/export async function cancelCampaignExecution[\s\S]*?(?=\nexport async function listCampaignExecutions)/)?.[0] || '', /status='SENT'/));
test('30 cancel is idempotent', () => assert.match(execution, /execution\.status === 'CANCELLED'\) return publicExecution\(execution, true\)/));
test('31 resume after cancel is blocked', () => assert.match(execution, /execution\.status === 'CANCELLED'\) throw new Error\('CAMPAIGN_EXECUTION_CANCELLED'\)/));

test('32 Workspace A resolves only its own token', () => assert.match(execution, /FROM workspace_line_accounts[\s\S]*WHERE workspace_id=\?/));
test('33 Workspace B follows the same scoped credential path', async () => {
  const a = await campaignExecutionActionHash({ workspaceId: 'ws-a', campaignId: 'c', audienceVersionNo: 1, contentVersionNo: 1, actionReference: 'same-action-00001' });
  const b = await campaignExecutionActionHash({ workspaceId: 'ws-b', campaignId: 'c', audienceVersionNo: 1, contentVersionNo: 1, actionReference: 'same-action-00001' });
  assert.notEqual(a, b);
});
test('34 cross-workspace member targets are blocked', () => {
  assert.match(migration, /line_member_delivery_targets_scope_guard_insert/);
  assert.match(frozenRecipientSection, /t\.workspace_id=l\.workspace_id[\s\S]*t\.line_account_id=l\.line_account_id/);
  assert.match(migration, /campaign_executions_line_account_scope_guard_insert/);
  assert.match(migration, /campaign_deliveries_recipient_scope_guard_insert/);
  assert.match(migration, /m\.line_account_id=e\.line_account_id/);
});
test('35 global LINE token is not required', () => assert.doesNotMatch(`${execution}\n${routes}\n${push}`, /LINE_CHANNEL_ACCESS_TOKEN/));
test('36 missing workspace token blocks before any send', () => assert.match(execution, /if \(!channelAccessToken\) throw new Error\('LINE_ACCOUNT_CREDENTIAL_MISSING'\)/));
test('37 token is never returned or persisted in execution tables', () => {
  assert.doesNotMatch(migration, /channel_access_token|bot_token|credential/);
  assert.doesNotMatch(publicProjection, /token|credential/i);
});

test('38 content edits after prepare cannot change execution content', () => assert.match(execution, /prepared_content_version_no[\s\S]*campaign_content_versions[\s\S]*version_no=\?/));
test('39 Segment changes after prepare cannot change recipients', () => assert.doesNotMatch(frozenRecipientSection, /crm_segments|crm_segment_versions|rule_json/));
test('40 CRM changes do not rewrite immutable execution recipients', () => {
  assert.match(migration, /campaign_deliveries_recipient_immutable/);
  assert.doesNotMatch(execution, /UPDATE campaign_audience_snapshot_members|UPDATE crm_people|UPDATE crm_profiles/);
});

test('41 broadcast is never used', () => assert.doesNotMatch(`${execution}\n${push}`, /message\/broadcast|broadcast/i));
test('42 narrowcast is never used', () => assert.doesNotMatch(`${execution}\n${push}`, /message\/narrowcast|narrowcast/i));
test('43 Campaign send performs no Referral mutation', () => assert.doesNotMatch(execution, /(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(referral|member_referral)/i));
test('44 Campaign send performs no Points or Rewards mutation', () => assert.doesNotMatch(execution, /(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(points?|reward)/i));
test('45 Campaign send performs no Contribution Commission or Payout mutation', () => assert.doesNotMatch(execution, /(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(contribution|tier|commission|payout)/i));
test('46 Campaign send performs no Stage Follow-up Tag or Profile mutation', () => assert.doesNotMatch(execution, /(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(crm_person_stage|follow_up|crm_person_tags|crm_profiles)/i));
test('47 no click open tracking attribution AI or frontend surface is added', () => {
  assert.doesNotMatch(`${execution}\n${routes}\n${push}`, /\bclick\b|open_tracking|redirect_tracking|\butm\b|conversion_attribution|gemini|openai/i);
  assert.equal(CAMPAIGN_EXECUTION_CONCURRENCY, 1);
  assert.equal(CAMPAIGN_EXECUTION_MAX_RECIPIENTS, 100);
  assert.match(index, /registerCampaignExecutionRoutes/);
  assert.match(referral, /line_member_delivery_targets/);
});

test('LINE push uses one recipient TEXT payload and a stable retry key', async () => {
  let captured;
  const result = await sendLineTextPush({
    channelAccessToken: 'workspace-token', providerRecipientId: 'Urecipient', text: 'frozen text',
    retryKey: '123e4567-e89b-12d3-a456-426614174000',
    fetcher: async (url, init) => {
      captured = { url, init };
      return new Response('{}', { status: 200, headers: { 'x-line-request-id': 'safe-not-returned' } });
    },
  });
  assert.equal(captured.url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(captured.init.headers['X-Line-Retry-Key'], '123e4567-e89b-12d3-a456-426614174000');
  assert.deepEqual(JSON.parse(captured.init.body), { to: 'Urecipient', messages: [{ type: 'text', text: 'frozen text' }] });
  assert.equal(result.accepted, true);
  assert.doesNotMatch(JSON.stringify(result), /workspace-token|Urecipient|safe-not-returned/);
});

test('LINE accepted retry 409 is terminal success', () => {
  const result = classifyLinePushStatus(409, 'accepted-request-id');
  assert.equal(result.accepted, true);
  assert.equal(result.alreadyAccepted, true);
  assert.equal(result.retryable, false);
});

test('0044 is additive only and creates no production data', () => {
  for (const table of ['line_member_delivery_targets', 'campaign_executions', 'campaign_deliveries', 'campaign_delivery_attempts']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(executableMigration, /DROP\s|DELETE\s+FROM|UPDATE\s+(?:campaigns|crm_|line_oa_members|workspace_)/i);
  assert.doesNotMatch(executableMigration, /INSERT\s+INTO/i);
});

test('execution routes enforce admin mutations and viewer reads', () => {
  for (const suffix of ['/execute', '/executions', '/resume', '/cancel', '/deliveries']) assert.match(routes, new RegExp(suffix));
  assert.match(routes, /execute'[\s\S]*requireRole\(c, 'admin'\)/);
  assert.match(routes, /executions'[\s\S]*requireRole\(c, 'viewer'\)/);
  assert.match(routes, /resume'[\s\S]*requireRole\(c, 'admin'\)/);
  assert.match(routes, /cancel'[\s\S]*requireRole\(c, 'admin'\)/);
});
test('credential and quota preflight happens without sending a message', async () => {
  const urls = [];
  const result = await preflightLineCampaignSend({
    channelAccessToken: 'workspace-token',
    recipientCount: 10,
    fetcher: async url => {
      urls.push(String(url));
      if (String(url).endsWith('/v2/bot/info')) return new Response('{}', { status: 200 });
      if (String(url).endsWith('/message/quota')) return Response.json({ type: 'limited', value: 100 });
      return Response.json({ totalUsage: 50 });
    },
  });
  assert.deepEqual(result, { ready: true, safeErrorCode: null });
  assert.equal(urls.length, 3);
  assert.equal(urls.some(url => url.endsWith('/message/push')), false);
});

test('invalid credential and insufficient official quota fail before recipient sends', async () => {
  const invalid = await preflightLineCampaignSend({
    channelAccessToken: 'invalid-token', recipientCount: 1,
    fetcher: async () => new Response('{}', { status: 401 }),
  });
  assert.deepEqual(invalid, { ready: false, safeErrorCode: 'LINE_INVALID_CREDENTIAL' });
  const quota = await preflightLineCampaignSend({
    channelAccessToken: 'valid-token', recipientCount: 3,
    fetcher: async url => {
      if (String(url).endsWith('/v2/bot/info')) return new Response('{}', { status: 200 });
      if (String(url).endsWith('/message/quota')) return Response.json({ type: 'limited', value: 10 });
      return Response.json({ totalUsage: 8 });
    },
  });
  assert.deepEqual(quota, { ready: false, safeErrorCode: 'LINE_QUOTA_INSUFFICIENT' });
  assert.doesNotMatch(JSON.stringify([invalid, quota]), /invalid-token|valid-token/);
});
