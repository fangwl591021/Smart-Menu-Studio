import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const root=new URL('../src/',import.meta.url);
test('6D uses deterministic safe acquisition and computed referral projections',()=>{
 const s=fs.readFileSync(new URL('crm/acquisition.ts',root),'utf8'),r=fs.readFileSync(new URL('index.ts',root),'utf8');
 assert.ok(s.includes('member_referral_attributions'));assert.ok(s.includes('ORDER BY occurred_at ASC,id ASC'));assert.ok(s.includes('ORDER BY occurred_at DESC,id DESC'));
 assert.ok(r.includes('firstAcquisitionSource'));assert.ok(r.includes('relationships:{referredBy,assignedOwner}'));assert.equal(r.includes('/referrer'),false);
});
test('6D acquisition relationship migration remains append-only and assignment history scoped',()=>{
 const m=fs.readFileSync(new URL('../migrations/0038_crm_acquisition_relationship_foundation.sql',import.meta.url),'utf8');
 for(const x of ['crm_acquisition_events','CRM_ACQUISITION_EVENT_APPEND_ONLY','crm_person_relationships','idx_crm_person_assignment_active'])assert.ok(m.includes(x));
});
test('6D projections do not serialize private acquisition or relationship identifiers',()=>{
 const s=fs.readFileSync(new URL('crm/acquisition.ts',root),'utf8');assert.equal(s.includes('sourceRef:'),false);assert.equal(s.includes('attributionId'),false);
});