import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { crmTimeline } from '../src/crm/timeline.ts';
const file=(relative)=>fileURLToPath(new URL(relative,import.meta.url));

function dbWith(rowsByNeedle){return {prepare(sql){return {bind(){return {all:async()=>({results:Object.entries(rowsByNeedle).find(([needle])=>sql.includes(needle))?.[1]||[]})}}}}};}

test('timeline is computed, latest-first, and cursor pagination contains no source identity',async()=>{
  const db=dbWith({
    'crm_acquisition_events':[{id:'internal-acquisition-1',source_type:'QR',channel:'LINE',occurred_at:'2026-08-10T12:00:00.000Z'}],
    'crm_person_stage_events':[{id:'internal-stage-1',occurred_at:'2026-08-10T13:00:00.000Z',from_name:'Lead',to_name:'Won'}],
    'crm_profile_field_events':[{id:'internal-profile-1',changed_at:'2026-08-10T11:00:00.000Z',changed_count:2}],
  });
  const first=await crmTimeline(db,{workspaceId:'workspace-a',personId:'person-a',limit:2});
  assert.equal(first.items.length,2);assert.equal(first.items[0].eventType,'STAGE_CHANGED');assert.ok(first.nextCursor);assert.doesNotMatch(first.nextCursor,/internal|person-a|workspace-a|source_ref/i);
  const second=await crmTimeline(db,{workspaceId:'workspace-a',personId:'person-a',limit:2,cursor:first.nextCursor});
  assert.equal(second.items.length,1);assert.equal(second.items[0].eventType,'PROFILE_UPDATED');
});

test('timeline source contract is read-only and projects trusted domains without raw source payloads',async()=>{
  const source=await readFile(file('../src/crm/timeline.ts'),'utf8');
  for(const table of ['crm_profile_field_events','crm_acquisition_events','member_referral_attributions','crm_import_rows','crm_personal_cards','crm_person_tags','crm_person_insights','crm_person_traits','crm_person_stage_events','crm_follow_up_task_events','member_point_ledger_entries','point_redemptions','member_contribution_events','member_tier_qualification_events','commission_ledger_entries','commission_settlements','commission_payout_requests','commission_payment_attempts'])assert.ok(source.includes(table));
  assert.match(source,/Computed projection only/);assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE)\s+INTO\s+crm_timeline/i);assert.doesNotMatch(source,/source_ref\s*:/i);assert.doesNotMatch(source,/previous_value|new_value|task\.note|provider_payload|raw_prompt|line_identity_hash/i);
  assert.match(source,/PAYMENT_SIMULATED_SUCCEEDED/);assert.match(source,/Simulated payment only/);
});

test('timeline tenant route is viewer-readable, workspace scoped, bounded, and has no member or manual timeline API',async()=>{
  const source=await readFile(file('../src/crm/timeline-routes.ts'),'utf8');
  assert.match(source,/app\.get\('\/api\/crm\/people\/:safePersonReference\/timeline'/);assert.match(source,/requireRole\(c,'viewer'\)/);assert.match(source,/workspaceIdOf\(c\)/);assert.match(source,/crmPersonByReference/);assert.match(source,/requested>100/);assert.match(source,/CRM_TIMELINE_LIMIT_INVALID/);
  assert.doesNotMatch(source,/app\.post\([^\n]*timeline/);assert.doesNotMatch(source,/member\/|dealer\/|referralFlowToken|source_ref|line_identity_hash/i);
});

test('viewer projection is minimized and excludes summary and metadata',async()=>{
  const db=dbWith({'crm_acquisition_events':[{id:'internal-a',source_type:'QR',channel:'LINE',occurred_at:'2026-08-10T12:00:00.000Z'}]});
  const result=await crmTimeline(db,{workspaceId:'workspace-a',personId:'person-a',viewer:true});
  assert.deepEqual(result.items[0],{eventType:'ACQUISITION_RECORDED',sourceDomain:'ACQUISITION',title:'Acquisition recorded',summary:null,occurredAt:'2026-08-10T12:00:00.000Z',metadata:{}});
});
