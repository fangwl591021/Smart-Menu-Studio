import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCard } from '../src/crm/cards.ts';
import fs from 'node:fs';

test('personal card public projection is snapshot-only and excludes CRM and economy authority',()=>{
 const value=publicCard({status:'ACTIVE',version_no:2,display_name:'Ada',company_name:'Acme',mobile:'0912',email:'a@b.test',crm_person_id:'private',internal_note:'private',points:99,commission:3});
 assert.equal(value?.versionNo,2);assert.equal(value?.card.displayName,'Ada');assert.equal('crmPersonId' in (value||{}),false);assert.equal(JSON.stringify(value).includes('private'),false);assert.equal(JSON.stringify(value).includes('commission'),false);
});
test('0037 defines immutable pinned versions, hash-only shares, private collection and append-only OPENED evidence',()=>{
 const sql=fs.readFileSync(new URL('../migrations/0037_crm_cards_collection_share.sql',import.meta.url),'utf8');
 for(const needle of ['crm_personal_card_versions','CRM_PERSONAL_CARD_VERSION_IMMUTABLE','card_version_id','token_hash','crm_card_collections','private_note','crm_card_share_events','CRM_CARD_SHARE_EVENT_APPEND_ONLY'])assert.ok(sql.includes(needle));
 assert.equal(sql.includes('raw_token'),false);
});
test('card services and routes preserve member ownership and never use collection as person or referral authority',()=>{
 const service=fs.readFileSync(new URL('../src/crm/cards.ts',import.meta.url),'utf8'),routes=fs.readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
 assert.ok(service.includes('ownPerson'));assert.ok(service.includes('alreadyCollected:true'));assert.ok(service.includes('owner_person_id=?'));assert.ok(service.includes('createBusinessCard'));
 assert.ok(routes.includes("'/api/member/card-collection'"));assert.ok(routes.includes("'/api/member/personal-card/share/revoke'"));assert.equal(service.includes('member_referral_attributions'),false);
});