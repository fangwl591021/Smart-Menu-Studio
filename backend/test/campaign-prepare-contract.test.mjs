import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('0043 is additive and creates only Campaign content and prepare contract tables', async () => {
  const migration = await read('../migrations/0043_campaign_content_prepare_contract.sql');
  for (const name of ['campaigns', 'campaign_content_versions', 'campaign_prepare_actions']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}`));
  }
  assert.match(migration, /CHECK\(status IN \('DRAFT','PREPARED','ARCHIVED'\)\)/);
  assert.match(migration, /UNIQUE\(workspace_id,campaign_id,action_reference_hash\)/);
  assert.match(migration, /FOREIGN KEY\(workspace_id,current_audience_id\) REFERENCES campaign_audiences/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS campaign_audiences|campaign_audience_snapshot_members\s*\(/);
  const executableSql = migration.replace(/^--.*$/gm, '');
  assert.doesNotMatch(executableSql, /DROP TABLE|ALTER TABLE|INSERT INTO crm_|UPDATE crm_|DELETE FROM/i);
});

test('TEXT content versions are immutable, bounded, and sequence guarded', async () => {
  const migration = await read('../migrations/0043_campaign_content_prepare_contract.sql');
  const source = await read('../src/campaign/campaigns.ts');
  const contentContract = await read('../src/campaign/content.ts');
  for (const token of [
    "content_type TEXT NOT NULL CHECK(content_type='TEXT')",
    'campaign_content_version_sequence_guard',
    'campaign_content_versions_no_update',
    'campaign_content_versions_no_delete',
  ]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(contentContract, /CAMPAIGN_TEXT_MAX_LENGTH = 5000/);
  assert.match(contentContract, /raw\.contentType !== 'TEXT'/);
  assert.match(contentContract, /Array\.from\(text\)\.length/);
  assert.match(source, /INSERT INTO campaign_content_versions[\s\S]*nextVersion/);
  assert.doesNotMatch(source, /UPDATE campaign_content_versions|DELETE FROM campaign_content_versions/);
});

test('Campaign aggregate supports scoped DRAFT CRUD and archive with safe projection', async () => {
  const source = await read('../src/campaign/campaigns.ts');
  for (const fn of ['listCampaigns', 'campaignByReference', 'createCampaign', 'updateCampaign', 'archiveCampaign']) {
    assert.match(source, new RegExp(`export async function ${fn}`));
  }
  assert.match(source, /status='DRAFT'/);
  assert.match(source, /status='ARCHIVED'/);
  assert.match(source, /WHERE c\.workspace_id=\? AND c\.public_ref=\?/);
  assert.match(source, /safeCampaignReference: clean\(row\.public_ref/);
  const projection = source.match(/function publicCampaign[\s\S]*?\n}\n\nconst CAMPAIGN_SELECT/)?.[0] || '';
  assert.doesNotMatch(projection, /\bid\s*:|campaignId|audienceId|snapshotId|source_ref|line_member|uid/i);
});

test('Campaign detail exposes immutable content history and identifies the prepared version', async () => {
  const source = await read('../src/campaign/campaigns.ts');
  assert.match(source, /ORDER BY version_no DESC LIMIT 100/);
  assert.match(source, /contentVersions: versions\.map/);
  assert.match(source, /prepared: Number\(row\.prepared_content_version_no/);
  assert.match(source, /currentContent: versions\.find/);
  assert.match(source, /if \(current\.status !== 'DRAFT'\) throw new Error\('CAMPAIGN_NOT_DRAFT'\)/);
});

test('live preview uses current Segment authority, returns bounded safe people, and writes no snapshot', async () => {
  const audience = await read('../src/campaign/audiences.ts');
  const campaign = await read('../src/campaign/campaigns.ts');
  assert.match(audience, /compileSegmentRule\(executionRule, workspaceId\)/);
  assert.match(audience, /Math\.min\(Math\.max\(Math\.trunc\(previewLimit\), 0\), 25\)/);
  assert.match(campaign, /currentSegmentVersion: input\.source\.segmentVersionNo/);
  assert.match(campaign, /currentContentVersion: Number\(campaign\.current_content_version_no\)/);
  const preview = campaign.match(/export async function previewCampaignAudience[\s\S]*?(?=\nasync function preparedActionByHash)/)?.[0] || '';
  assert.match(preview, /evaluateCampaignAudience/);
  assert.doesNotMatch(preview, /INSERT INTO|UPDATE |DELETE FROM|buildCampaignAudienceSnapshot/);
  const previewProjection = audience.match(/previewPeople = rows\.slice[\s\S]*?\n    }\)\);/)?.[0] || '';
  for (const field of ['displayName', 'companyName', 'eligibilityStatus', 'exclusionReason']) assert.match(previewProjection, new RegExp(field));
  assert.doesNotMatch(previewProjection, /personId|safePersonReference|mobile|email|line|uid|hash|source_ref/i);
});

test('preview and prepare share fail-closed eligibility and safe exclusion breakdown', async () => {
  const source = await read('../src/campaign/audiences.ts');
  for (const value of ["p.status='ACTIVE'", 'pr.do_not_contact=0', 'pr.contactable=1', 'pr.marketing_consent=1', "verification_status='VERIFIED'"]) {
    assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const reason of ['PERSON_ARCHIVED', 'DO_NOT_CONTACT', 'NOT_CONTACTABLE', 'MARKETING_CONSENT_MISSING', 'NO_VERIFIED_LINE_IDENTITY']) {
    assert.match(source, new RegExp(reason));
  }
  assert.match(source, /exclusionBreakdown/);
  assert.match(source, /matchedCount - eligibleCount/);
});

test('prepare reuses 0042 materialization and atomically freezes content Segment audience and counts', async () => {
  const audience = await read('../src/campaign/audiences.ts');
  const campaign = await read('../src/campaign/campaigns.ts');
  assert.match(audience, /export async function buildCampaignAudienceSnapshot/);
  assert.match(audience, /createCampaignAudience[\s\S]*buildCampaignAudienceSnapshot/);
  assert.match(campaign, /buildCampaignAudienceSnapshot/);
  assert.doesNotMatch(campaign, /INSERT INTO campaign_audiences|INSERT INTO campaign_audience_snapshots|INSERT INTO campaign_audience_snapshot_members/);
  assert.match(campaign, /status='PREPARED'/);
  for (const field of ['prepared_content_version_no', 'prepared_segment_id', 'prepared_segment_version_no', 'current_audience_snapshot_no', 'matched_count', 'eligible_count', 'excluded_count', 'prepared_at']) {
    assert.match(campaign, new RegExp(field));
  }
  assert.match(campaign, /await db\.batch\(statements\)/);
  assert.match(campaign, /CAMPAIGN_REPREPARE_UNSUPPORTED/);
});

test('prepare idempotency stores only a scoped action hash and returns the same immutable result', async () => {
  const migration = await read('../migrations/0043_campaign_content_prepare_contract.sql');
  const source = await read('../src/campaign/campaigns.ts');
  assert.match(source, /smart-menu-campaign-prepare:v1:\$\{input\.workspaceId}:\$\{input\.campaignId}/);
  assert.match(source, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(source, /const previous = await preparedActionByHash/);
  assert.match(source, /if \(previous\) return publicPrepareResult\(campaign\.public_ref, previous, true\)/);
  assert.match(source, /const duplicate = await preparedActionByHash/);
  assert.match(migration, /action_reference_hash TEXT NOT NULL CHECK\(length\(action_reference_hash\)=64\)/);
  assert.doesNotMatch(migration, /action_reference TEXT|raw_action|action_payload/i);
});

test('Campaign routes enforce viewer reads admin mutation and expose the complete safe contract', async () => {
  const route = await read('../src/campaign/campaign-routes.ts');
  for (const path of [
    '/api/campaigns',
    '/:safeCampaignReference',
    '/:safeCampaignReference/status',
    '/:safeCampaignReference/preview',
    '/:safeCampaignReference/prepare',
    '/:safeCampaignReference/audience',
  ]) assert.match(route, new RegExp(path.replace(/[/?]/g, '\\$&')));
  assert.match(route, /app\.patch\('\/api\/campaigns\/\:safeCampaignReference'/);
  assert.match(route, /requireRole\(c, 'viewer'\)/);
  assert.match(route, /requireRole\(c, 'admin'\)/);
  assert.match(route, /resolveSegmentReferences/);
  assert.match(route, /loadCampaignAudienceSource/);
});

test('7A-B has no LINE execution delivery retry AI or protected-domain mutation surface', async () => {
  const files = await Promise.all([
    read('../src/campaign/campaigns.ts'),
    read('../src/campaign/campaign-routes.ts'),
    read('../migrations/0043_campaign_content_prepare_contract.sql'),
  ]);
  const source = files.join('\n');
  assert.doesNotMatch(source, /replyToken|api\.line\.me|\/v2\/bot\/message|pushMessage|multicast|narrowcast|broadcast|provider_message|delivery_status|delivery retry|schedule_at|gemini|openai/i);
  assert.doesNotMatch(source, /(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(referral|dealer|points?|reward|contribution|tier|commission|payout|crm_person_stage|follow_up|crm_person_tags|crm_profiles)/i);
  assert.doesNotMatch(source, /line_member_id|line_user_id|identity_hash|source_ref|crm_person_id/i);
});

test('7A-B routes are registered without removing the low-level 0042 routes', async () => {
  const index = await read('../src/index.ts');
  assert.match(index, /import \{ registerCampaignAudienceRoutes \} from '\.\/campaign\/audience-routes';/);
  assert.match(index, /import \{ registerCampaignRoutes \} from '\.\/campaign\/campaign-routes';/);
  assert.match(index, /registerCampaignAudienceRoutes\(app,\{requireRole,workspaceIdOf,text\}\);/);
  assert.match(index, /registerCampaignRoutes\(app,\{requireRole,workspaceIdOf,text\}\);/);
});
