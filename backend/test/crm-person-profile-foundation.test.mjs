import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CRM_EDITABLE_FIELDS, MEMBER_SELF_EDITABLE_FIELDS, createCrmPerson, ensureCrmPersonForVerifiedMember, normalizedEmail, normalizedMobile, updateCrmProfile } from '../src/crm/index.ts';

const migrationUrl = new URL('../migrations/0035_unified_crm_person_profile_foundation.sql', import.meta.url);
const serviceUrl = new URL('../src/crm/index.ts', import.meta.url);
const indexUrl = new URL('../src/index.ts', import.meta.url);

test('0035 is additive, workspace-scoped, and creates only the CRM person identity profile provenance foundation', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const required of [
    'CREATE TABLE IF NOT EXISTS crm_people',
    'CREATE TABLE IF NOT EXISTS crm_person_identity_links',
    'CREATE TABLE IF NOT EXISTS crm_profiles',
    'CREATE TABLE IF NOT EXISTS crm_profile_field_events',
    'UNIQUE(workspace_id,line_account_id,line_member_id)',
    'crm_profile_field_events_no_update',
    'crm_profile_field_events_no_delete',
    'CRM_PROFILE_FIELD_EVENTS_APPEND_ONLY',
  ]) assert.equal(sql.includes(required), true);
  assert.doesNotMatch(sql, /(?:^|;)\s*(?:ALTER TABLE|DROP TABLE|UPDATE\s+(?!sqlite_)|DELETE\s+FROM|INSERT\s+INTO\s+line_oa_members)\b/im);
  assert.doesNotMatch(sql, /line_identity_hash|line_user_id|referrer|commission|point_balance|dealer_status/i);
});

test('CRM people have a stable opaque public reference, can exist without LINE identity, and verified LINE identity creation is idempotent', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  assert.match(source, /public_ref TEXT NOT NULL UNIQUE|publicRef\(\)/);
  assert.match(source, /INSERT INTO crm_people/);
  assert.match(source, /INSERT INTO crm_profiles/);
  assert.match(source, /ensureCrmPersonForVerifiedMember/);
  assert.match(source, /SELECT id FROM line_oa_members WHERE id=\? AND workspace_id=\? AND line_account_id=\?/);
  assert.doesNotMatch(source, /INSERT INTO\s+line_oa_members|UPDATE\s+line_oa_members|line_identity_hash|lineUserId|raw.*uid/i);
});

test('profile editable field allowlists and server normalizers keep system fields out', () => {
  for (const field of ['contactName','mobile','email','companyName','department','jobTitle','websiteUrl','address','birthday','gender','region','preferredLanguage','serviceDescription','marketingConsent']) assert.equal(CRM_EDITABLE_FIELDS.includes(field), true);
  for (const forbidden of ['lineMemberId','workspaceId','personId','points','commission','tier','referrer','normalizedMobile','normalizedEmail']) assert.equal(CRM_EDITABLE_FIELDS.includes(forbidden), false);
  assert.equal(MEMBER_SELF_EDITABLE_FIELDS.includes('internalNote'), false);
  assert.equal(MEMBER_SELF_EDITABLE_FIELDS.includes('doNotContact'), false);
  assert.equal(normalizedMobile(' +886 (912) 345-678 '), '+886912345678');
  assert.equal(normalizedEmail('  Member@Example.COM '), 'member@example.com');
});

test('profile update uses a strict payload allowlist, backend generated normalized values, and atomic masked provenance events', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  assert.match(source, /keys\.some\(key => !allowed\.includes\(key\)\)/);
  assert.match(source, /normalized_mobile=\?/);
  assert.match(source, /normalized_email=\?/);
  assert.match(source, /crm_profile_field_events/);
  assert.match(source, /sourceType:'MEMBER_SELF_INPUT'|'CRM_MANUAL'/);
  assert.match(source, /db\.batch\(\[/);
  assert.match(source, /\*\*\*/);
  assert.match(source, /CRM_DO_NOT_CONTACT_CLEAR_REQUIRES_MEMBER/);
  assert.doesNotMatch(source, /previous_value.*input\.patch|new_value.*input\.patch/i);
});

test('tenant CRM APIs are workspace scoped, role constrained, and expose only safe public references', async () => {
  const source = await readFile(indexUrl, 'utf8');
  for (const route of ["app.get('/api/crm/people'", "app.get('/api/crm/people/:safePersonReference'", "app.patch('/api/crm/people/:safePersonReference/profile'"]) assert.equal(source.includes(route), true);
  const slice = source.slice(source.indexOf("function crmRouteError"), source.indexOf("app.get('/api/member/crm-profile'"));
  assert.match(slice, /requireRole\(c,'viewer'\)/);
  assert.match(slice, /requireRole\(c,'editor'\)/);
  assert.match(slice, /workspaceIdOf\(c\)/);
  assert.match(slice, /crmLineAccountScope/);
  assert.match(slice, /publicCrmPerson/);
  assert.doesNotMatch(slice, /line_identity_hash|lineMemberId|identity_link_id|referrer|commission|pointAccountId/i);
});

test('member CRM profile uses only verified LIFF context, resolves the caller own person, and never accepts a person selector', async () => {
  const source = await readFile(indexUrl, 'utf8');
  const slice = source.slice(source.indexOf("app.get('/api/member/crm-profile'"), source.indexOf("export default app;"));
  assert.match(slice, /verifiedReferralMember/);
  assert.match(slice, /ensureCrmPersonForVerifiedMember/);
  assert.match(slice, /MEMBER_SELF_INPUT/);
  assert.match(slice, /includeInternalNote:false/);
  assert.doesNotMatch(slice, /body\.personId|body\.crmPersonId|c\.req\.query\('personId'\)|body\.lineMemberId|body\.memberId/);
});

test('CRM routes do not mutate referral, dealer, points, rewards, contribution, commission, settlement, or payout truth', async () => {
  const source = await readFile(indexUrl, 'utf8');
  const slice = source.slice(source.indexOf("function crmRouteError"), source.indexOf("export default app;"));
  assert.doesNotMatch(slice, /member_referral_attributions|dealer_|member_point_|point_rewards|contribution|commission_|settlement|payout|payment/i);
});

function crmServiceDb(options = {}) {
  const statements = [], batches = []; let profileReads = 0;
  const db = {
    statements, batches,
    prepare(sql) {
      const statement = {
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('FROM line_oa_members')) return options.member === false ? null : { id: 'member_1' };
          if (sql.includes('FROM crm_person_identity_links')) return options.existing || null;
          if (sql.includes('FROM crm_people WHERE')) return { id: 'person_1' };
          if (sql.includes('FROM crm_profiles')) {
            profileReads += 1;
            return profileReads === 1
              ? { crm_person_id:'person_1', mobile:'', email:'', do_not_contact:options.doNotContact ? 1 : 0, contactable:1, marketing_consent:0 }
              : { crm_person_id:'person_1', mobile:'+886912345678', normalized_mobile:'+886912345678', email:'member@example.com', normalized_email:'member@example.com', do_not_contact:0, contactable:1, marketing_consent:1, updated_at:'now' };
          }
          return null;
        },
        async all() { return { results: [] }; },
      };
      statements.push(statement);
      return statement;
    },
    async batch(items) { batches.push(items); return []; },
  };
  return db;
}

test('service creates a workspace-scoped CRM person with exactly one empty profile and no LINE identity', async () => {
  const db = crmServiceDb();
  const person = await createCrmPerson(db, { workspaceId:'workspace_1' });
  assert.match(person.publicRef, /^crmp_[a-f0-9]{32}$/);
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].some(item => item.sql.includes('INSERT INTO crm_people')), true);
  assert.equal(db.batches[0].some(item => item.sql.includes('INSERT INTO crm_profiles')), true);
  assert.equal(db.batches[0].some(item => item.sql.includes('crm_person_identity_links')), false);
});

test('verified LINE retry resolves an existing CRM person without a second create or arbitrary identity source', async () => {
  const db = crmServiceDb({ existing:{ id:'person_existing', public_ref:'crmp_existing', workspace_id:'workspace_1', status:'ACTIVE' } });
  const person = await ensureCrmPersonForVerifiedMember(db, { workspaceId:'workspace_1', lineAccountId:'account_1', lineMemberId:'member_1' });
  assert.deepEqual(person, { id:'person_existing', publicRef:'crmp_existing', workspaceId:'workspace_1', status:'ACTIVE', created:false });
  assert.equal(db.batches.length, 0);
  assert.equal(db.statements.some(item => item.sql.includes('line_identity_hash')), false);
});

test('profile update batches normalized contact values with masked MEMBER_SELF_INPUT provenance and preserves opt-out policy', async () => {
  const db = crmServiceDb();
  await updateCrmProfile(db, { workspaceId:'workspace_1', crmPersonId:'person_1', patch:{ mobile:' +886 (912) 345-678 ', email:' Member@Example.COM ', marketingConsent:true }, actor:{ sourceType:'MEMBER_SELF_INPUT', actorType:'MEMBER', memberSelf:true } });
  assert.equal(db.batches.length, 1);
  const batch = db.batches[0];
  const profileUpdate = batch.find(item => item.sql.startsWith('UPDATE crm_profiles'));
  assert.match(profileUpdate.sql, /normalized_mobile=\?/);
  assert.match(profileUpdate.sql, /normalized_email=\?/);
  assert.equal(profileUpdate.args.includes('+886912345678'), true);
  assert.equal(profileUpdate.args.includes('member@example.com'), true);
  const events = batch.filter(item => item.sql.includes('crm_profile_field_events'));
  assert.equal(events.length, 3);
  assert.equal(events.every(item => item.args.includes('MEMBER_SELF_INPUT')), true);
  assert.equal(events.some(item => item.args.includes('Member@Example.COM')), false);
  await assert.rejects(() => updateCrmProfile(crmServiceDb({ doNotContact:true }), { workspaceId:'workspace_1', crmPersonId:'person_1', patch:{ doNotContact:false }, actor:{ sourceType:'CRM_MANUAL', actorType:'TENANT_USER' } }), /CRM_DO_NOT_CONTACT_CLEAR_REQUIRES_MEMBER/);
});
