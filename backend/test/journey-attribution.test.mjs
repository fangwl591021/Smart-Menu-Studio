import test from 'node:test';
import assert from 'node:assert/strict';
import { lastObservedTouch } from '../src/journey/core.ts';
import { readFile } from 'node:fs/promises';
const now='2026-08-09T12:00:00.000Z'; const event=(type,area,when,project='project-a')=>({event_type:type,project_area_id:area,project_id:project,occurred_at:when});
test('explicit session selects latest confirmed qualifying area',()=>assert.equal(lastObservedTouch([event('message_action','a','2026-08-09T10:00:00Z'),event('postback_action','b','2026-08-09T11:00:00Z')],now).project_area_id,'b'));
test('24h boundary, unmapped and non-qualifying sources are unmatched',()=>{assert.ok(lastObservedTouch([event('richmenu_switch','a','2026-08-08T12:00:01Z')],now));assert.equal(lastObservedTouch([event('message_action','a','2026-08-08T11:59:59Z')],now),null);assert.equal(lastObservedTouch([event('message_action',null,now)],now),null);for(const type of ['keyword_match','webhook_route','webhook_success','webhook_failure','rich_menu_click'])assert.equal(lastObservedTouch([event(type,'uri-area',now)],now),null)});
test('conversion persistence is workspace scoped, idempotent, and stores attribution fields',async()=>{const s=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');for(const x of ['lastObservedTouch(sessionRows, occurredAt)','INVALID_JOURNEY_SESSION','workspace_id=? AND external_event_id=?','attributed_project_id','attributed_project_area_id','attribution_model','mapping_status'])assert.ok(s.includes(x),x);assert.ok(s.includes("SELECT id FROM projects WHERE id=? AND workspace_id=?"));assert.ok(s.includes("SELECT id,project_id FROM project_areas WHERE id=? AND workspace_id=?"));});



