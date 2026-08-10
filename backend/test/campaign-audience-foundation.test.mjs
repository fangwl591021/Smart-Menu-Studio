import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('0042 adds immutable tenant-scoped audience snapshots without messaging identity data', async () => {
  const migration = await read('../migrations/0042_campaign_audience_foundation.sql');
  for (const name of [
    'campaign_audiences',
    'campaign_audience_snapshots',
    'campaign_audience_snapshot_members',
    'campaign_audience_snapshot_sequence_guard',
    'campaign_audience_snapshots_no_update',
    'campaign_audience_snapshots_no_delete',
    'campaign_audience_members_no_update',
    'campaign_audience_members_no_delete',
  ]) assert.match(migration, new RegExp(name));
  assert.match(migration, /UNIQUE\(workspace_id,audience_id,snapshot_no\)/);
  assert.match(migration, /FOREIGN KEY\(workspace_id,audience_id\)/);
  assert.match(migration, /CHECK\(matched_count = eligible_count \+ excluded_count\)/);
  assert.match(migration, /current_snapshot_no=NEW.snapshot_no-1/);
  assert.doesNotMatch(migration, /line_user_id|line_member_id|reply_token|access_token|DROP TABLE|DELETE FROM/i);
});

test('audience materialization pins the segment version and applies fail-closed eligibility', async () => {
  const source = await read('../src/campaign/audiences.ts');
  for (const value of [
    "p.status='ACTIVE'",
    'pr.do_not_contact=0',
    'pr.contactable=1',
    'pr.marketing_consent=1',
    "verification_status='VERIFIED'",
    'source_segment_version_no',
    'rule_json',
    'MAX_AUDIENCE_MEMBERS',
  ]) assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const reason of ['PERSON_ARCHIVED', 'DO_NOT_CONTACT', 'NOT_CONTACTABLE', 'MARKETING_CONSENT_MISSING', 'NO_VERIFIED_LINE_IDENTITY']) {
    assert.match(source, new RegExp(reason));
  }
  assert.match(source, /compileSegmentRule\(executionRule, workspaceId\)/);
  assert.match(source, /INSERT INTO campaign_audience_snapshot_members[\s\S]*SELECT \?,\?,\?,p\.id/);
  assert.doesNotMatch(source, /mobile|email|line_member_id|line_user_id|replyToken|fetch\(/i);
});

test('audience APIs preserve tenant roles, bounded reads, safe references and no send surface', async () => {
  const route = await read('../src/campaign/audience-routes.ts');
  for (const path of [
    '/api/campaign/audiences',
    '/:safeAudienceReference/members',
    '/:safeAudienceReference/snapshots',
    '/:safeAudienceReference/status',
  ]) assert.match(route, new RegExp(path.replace(/[/?]/g, '\\$&')));
  assert.match(route, /requireRole\(c, 'viewer'\)/);
  assert.match(route, /requireRole\(c, 'admin'\)/);
  assert.match(route, /Math\.min\(Math\.max[\s\S]*, 1\), 100\)/);
  assert.match(route, /resolveSegmentReferences/);
  assert.doesNotMatch(route, /replyToken|pushMessage|multicast|broadcast|line.*send|\/export|\/csv|\/xlsx|gemini|openai/i);
});

test('7A routes are registered in the Worker entrypoint', async () => {
  const index = await read('../src/index.ts');
  assert.match(index, /import \{ registerCampaignAudienceRoutes \} from '\.\/campaign\/audience-routes';/);
  assert.match(index, /registerCampaignAudienceRoutes\(app,\{requireRole,workspaceIdOf,text\}\);/);
});
