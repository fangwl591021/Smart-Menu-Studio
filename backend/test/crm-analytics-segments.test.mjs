import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('0041 is additive, keeps immutable rule versions, and has no member snapshot table', async () => {
  const migration = await read('../migrations/0041_crm_analytics_segments.sql');
  for (const name of ['crm_segments', 'crm_segment_versions', 'crm_segment_versions_no_update', 'crm_segment_versions_no_delete']) assert.match(migration, new RegExp(name));
  assert.match(migration, /UNIQUE\(workspace_id,segment_id,version_no\)/);
  assert.doesNotMatch(migration, /crm_segment_members|DROP TABLE|DELETE FROM|INSERT INTO crm_people/i);
});

test('analytics remains aggregate-only and derives facts from current CRM truth', async () => {
  const source = await read('../src/crm/analytics.ts');
  for (const value of ['crm_people', 'crm_person_identity_links', 'member_referral_attributions', 'crm_person_stage_assignments', 'crm_acquisition_events', 'crm_person_tags', 'crm_person_relationships', 'crm_follow_up_tasks']) assert.match(source, new RegExp(value));
  assert.match(source, /ROW_NUMBER\(\) OVER\(PARTITION BY a\.crm_person_id ORDER BY a\.occurred_at DESC,a\.id DESC\)/);
  assert.match(source, /status='OPEN' AND due_at<\?/);
  assert.doesNotMatch(source, /return \{[^}]*phone|return \{[^}]*email|return \{[^}]*source_ref/i);
});

test('saved DSL is normalized, bound, flat AND-only, capped, and excludes Five Insights', async () => {
  const source = await read('../src/crm/segments.ts');
  for (const value of ['status', 'acquisition.firstSource', 'acquisition.latestSource', 'hasReferrer', 'tag', 'stage', 'assignedOwner', 'region', 'preferredLanguage', 'hasVerifiedLineIdentity', 'followUp.overdue', 'followUp.hasOpen', 'trait.zodiac', 'createdAt', 'updatedAt']) assert.match(source, new RegExp(value.replace('.', '\\.')));
  assert.match(source, /raw\.conditions\.length>LIST/); assert.match(source, /IN_MAX=50/); assert.match(source, /keys\.join\(','\)/);
  assert.match(source, /INSERT INTO crm_segment_versions/); assert.match(source, /UPDATE crm_segments SET current_version_no/);
  assert.doesNotMatch(source, /personality|wealth|health|career|interest|LIKE|REGEX|source_ref|memberId|line_identity_hash/i);
  assert.match(source, /bind\(\.\.\.args\)/);
});

test('owner, tag, and stage references are resolved server-side against current workspace truth', async () => {
  const route = await read('../src/crm/segment-routes.ts');
  assert.match(route, /verifyAssigneeHandle/); assert.match(route, /assigneeReference/); assert.match(route, /matches\.length!==1/);
  assert.match(route, /SELECT id FROM users WHERE workspace_id=\? AND status='ACTIVE'/);
  assert.match(route, /crm_tags/); assert.match(route, /crm_pipeline_stages/); assert.match(route, /CRM_SEGMENT_REFERENCE_INVALID/);
  assert.match(route, /resolved=await resolveReferences[\s\S]*rule:resolved\.stored/);
  assert.match(route, /rule:resolved\.execution/);
  assert.doesNotMatch(route, /related_user_id.*c\.value.*request/i);
});

test('saved-segment people cursor is opaque, signed, scoped and emits no private pagination state', async () => {
  const route = await read('../src/crm/segment-routes.ts');
  assert.match(route, /crm-segment-cursor:v1/); assert.match(route, /crm-segment-cursor-person:v1/);
  assert.match(route, /workspaceId,segmentRef/); assert.match(route, /CRM_SEGMENT_CURSOR_INVALID/);
  assert.match(route, /people:publicPeople\(page\)/); assert.match(route, /nextCursor:/);
  const segmentSource = await read('../src/crm/segments.ts'); assert.match(segmentSource, /ORDER BY p\.updated_at DESC,p\.public_ref ASC/); assert.match(segmentSource, /__segmentCursor/);
  assert.doesNotMatch(route, /crm_person_id.*nextCursor|personId.*nextCursor|segment_id.*nextCursor/i);
});

test('segment routes preserve tenant roles, bounded preview, live execution and no mutation surface', async () => {
  const route = await read('../src/crm/segment-routes.ts');
  for (const path of ['/api/crm/analytics-summary', '/api/crm/segments/preview', '/api/crm/segments', '/people']) assert.match(route, new RegExp(path.replace(/[/?]/g, '\\$&')));
  assert.match(route, /requireRole\(c,'viewer'\)/); assert.match(route, /requireRole\(c,'admin'\)/);
  assert.match(route, /slice\(0,25\)/); assert.match(route, /Math\.min\(Math\.max\(Number\(c\.req\.query\('limit'\)\|\|25\),1\),100\)/);
  assert.match(route, /executeSegment/);
  assert.doesNotMatch(route, /\/campaign|\/broadcast|\/export|\/csv|\/xlsx|\/gemini|\/openai|line.*send/i);
});
