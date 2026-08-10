const FIELD_COLUMNS: Record<string, string> = {
  displayName: 'display_name', contactName: 'contact_name', englishName: 'english_name', companyName: 'company_name',
  department: 'department', jobTitle: 'job_title', mobile: 'mobile', companyPhone: 'company_phone', email: 'email',
  websiteUrl: 'website_url', lineUrl: 'line_url', address: 'address', birthday: 'birthday', gender: 'gender',
  region: 'region', preferredLanguage: 'preferred_language', serviceDescription: 'service_description', internalNote: 'internal_note',
  preferredContactChannel: 'preferred_contact_channel', contactable: 'contactable', doNotContact: 'do_not_contact', marketingConsent: 'marketing_consent',
};
export const CRM_EDITABLE_FIELDS = Object.keys(FIELD_COLUMNS);
export const MEMBER_SELF_EDITABLE_FIELDS = CRM_EDITABLE_FIELDS.filter(field => !['displayName', 'internalNote', 'contactable', 'doNotContact'].includes(field));
const MAX: Record<string, number> = { displayName:120,contactName:120,englishName:120,companyName:180,department:120,jobTitle:120,mobile:40,companyPhone:40,email:254,websiteUrl:2048,lineUrl:2048,address:500,birthday:10,gender:20,region:120,preferredLanguage:40,serviceDescription:2000,internalNote:4000,preferredContactChannel:40 };
const BOOLEAN_FIELDS = new Set(['contactable','doNotContact','marketingConsent']);
const GENDERS = new Set(['','FEMALE','MALE','OTHER','PREFER_NOT_TO_SAY']);

function clean(value: unknown, maximum = 120) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function flag(value: unknown, field: string) { if (typeof value !== 'boolean') throw new Error(`CRM_INVALID_${field.toUpperCase()}`); return value ? 1 : 0; }
export function normalizedMobile(value: unknown) { return clean(value, 40).replace(/[^0-9+]/g, ''); }
export function normalizedEmail(value: unknown) { return clean(value, 254).toLowerCase(); }
function publicRef() { return `crmp_${crypto.randomUUID().replace(/-/g, '')}`; }
function internalId() { return `crmp_${crypto.randomUUID()}`; }
function eventId() { return `crmfe_${crypto.randomUUID()}`; }

export type CrmScope = { workspaceId: string; lineAccountId?: string };
export type CrmActor = { sourceType: 'MEMBER_SELF_INPUT'|'CRM_MANUAL'; actorType: 'MEMBER'|'TENANT_USER'; actorUserId?: string|null; memberSelf?: boolean };

export async function createCrmPerson(db: D1Database, input: { workspaceId: string; status?: string }) {
  const status = input.status || 'ACTIVE'; if (!['ACTIVE','ARCHIVED'].includes(status)) throw new Error('CRM_PERSON_STATUS_INVALID');
  const id = internalId(), ref = publicRef();
  await db.batch([
    db.prepare('INSERT INTO crm_people(id,public_ref,workspace_id,status) VALUES(?,?,?,?)').bind(id,ref,input.workspaceId,status),
    db.prepare('INSERT INTO crm_profiles(crm_person_id) VALUES(?)').bind(id),
  ]);
  return { id, publicRef: ref, workspaceId: input.workspaceId, status };
}

export async function ensureCrmPersonForVerifiedMember(db: D1Database, input: { workspaceId: string; lineAccountId: string; lineMemberId: string }) {
  const member = await db.prepare('SELECT id FROM line_oa_members WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(input.lineMemberId,input.workspaceId,input.lineAccountId).first<any>();
  if (!member) throw new Error('CRM_LINE_MEMBER_SCOPE_INVALID');
  const existing = await db.prepare(`SELECT p.id,p.public_ref,p.workspace_id,p.status FROM crm_person_identity_links l JOIN crm_people p ON p.id=l.crm_person_id WHERE l.workspace_id=? AND l.line_account_id=? AND l.line_member_id=? AND l.identity_type='LINE_MEMBER' LIMIT 1`).bind(input.workspaceId,input.lineAccountId,input.lineMemberId).first<any>();
  if (existing) return { id:String(existing.id), publicRef:String(existing.public_ref), workspaceId:String(existing.workspace_id), status:String(existing.status), created:false };
  const id = internalId(), ref = publicRef(), linkId = `crmil_${crypto.randomUUID()}`;
  try {
    await db.batch([
      db.prepare("INSERT INTO crm_people(id,public_ref,workspace_id,status) VALUES(?,?,?,'ACTIVE')").bind(id,ref,input.workspaceId),
      db.prepare('INSERT INTO crm_profiles(crm_person_id) VALUES(?)').bind(id),
      db.prepare("INSERT INTO crm_person_identity_links(id,workspace_id,crm_person_id,identity_type,line_account_id,line_member_id,verification_status) VALUES(?,?,?,'LINE_MEMBER',?,?,'VERIFIED')").bind(linkId,input.workspaceId,id,input.lineAccountId,input.lineMemberId),
    ]);
    return { id, publicRef:ref, workspaceId:input.workspaceId, status:'ACTIVE', created:true };
  } catch (error) {
    const raced = await db.prepare(`SELECT p.id,p.public_ref,p.workspace_id,p.status FROM crm_person_identity_links l JOIN crm_people p ON p.id=l.crm_person_id WHERE l.workspace_id=? AND l.line_account_id=? AND l.line_member_id=? AND l.identity_type='LINE_MEMBER' LIMIT 1`).bind(input.workspaceId,input.lineAccountId,input.lineMemberId).first<any>();
    if (raced) return { id:String(raced.id), publicRef:String(raced.public_ref), workspaceId:String(raced.workspace_id), status:String(raced.status), created:false };
    throw error;
  }
}

export function crmProfileProjection(row: any, options: { includeInternalNote?: boolean; includePii?: boolean } = {}) {
  const pii = options.includePii !== false;
  return { displayName:clean(row.display_name,120),contactName:clean(row.contact_name,120),englishName:clean(row.english_name,120),companyName:clean(row.company_name,180),department:clean(row.department,120),jobTitle:clean(row.job_title,120),mobile:pii?clean(row.mobile,40):'',companyPhone:pii?clean(row.company_phone,40):'',email:pii?clean(row.email,254):'',websiteUrl:clean(row.website_url,2048),lineUrl:clean(row.line_url,2048),address:pii?clean(row.address,500):'',birthday:pii?clean(row.birthday,10):'',gender:clean(row.gender,20),region:clean(row.region,120),preferredLanguage:clean(row.preferred_language,40),serviceDescription:clean(row.service_description,2000),preferredContactChannel:clean(row.preferred_contact_channel,40),contactable:Boolean(row.contactable),doNotContact:Boolean(row.do_not_contact),marketingConsent:Boolean(row.marketing_consent),...(options.includeInternalNote?{internalNote:clean(row.internal_note,4000)}:{}),updatedAt:row.updated_at||null };
}
function masked(field: string, value: unknown) {
  const text = String(value ?? ''); if (!text) return '';
  if (BOOLEAN_FIELDS.has(field)) return text;
  if (field === 'email') { const [local, domain] = text.split('@'); return domain ? `${local.slice(0,1)}***@${domain}` : '***'; }
  if (field === 'mobile' || field === 'companyPhone') return `***${text.slice(-4)}`;
  return '[changed]';
}

export async function updateCrmProfile(db: D1Database, input: CrmScope & { crmPersonId: string; patch: Record<string, unknown>; actor: CrmActor }) {
  const allowed = input.actor.memberSelf ? MEMBER_SELF_EDITABLE_FIELDS : CRM_EDITABLE_FIELDS;
  const keys = Object.keys(input.patch || {}); if (!keys.length) throw new Error('CRM_PROFILE_PATCH_EMPTY');
  if (keys.some(key => !allowed.includes(key))) throw new Error('CRM_PROFILE_FIELD_FORBIDDEN');
  const person = await db.prepare('SELECT id FROM crm_people WHERE id=? AND workspace_id=? LIMIT 1').bind(input.crmPersonId,input.workspaceId).first<any>(); if (!person) throw new Error('CRM_PERSON_NOT_FOUND');
  const before:any = await db.prepare('SELECT * FROM crm_profiles WHERE crm_person_id=? LIMIT 1').bind(input.crmPersonId).first(); if (!before) throw new Error('CRM_PROFILE_NOT_FOUND');
  if (!input.actor.memberSelf && Object.prototype.hasOwnProperty.call(input.patch,'doNotContact') && input.patch.doNotContact === false && Boolean(before.do_not_contact)) throw new Error('CRM_DO_NOT_CONTACT_CLEAR_REQUIRES_MEMBER');
  const assignments: string[] = [], values: unknown[] = [], events: any[] = [];
  for (const field of keys) {
    let value: unknown;
    if (BOOLEAN_FIELDS.has(field)) value = flag(input.patch[field],field);
    else if (field === 'gender') { value = clean(input.patch[field],20).toUpperCase(); if (!GENDERS.has(String(value))) throw new Error('CRM_INVALID_GENDER'); }
    else value = clean(input.patch[field],MAX[field]);
    const column = FIELD_COLUMNS[field], prior = before[column]; if (String(prior ?? '') === String(value ?? '')) continue;
    assignments.push(`${column}=?`); values.push(value);
    if (field === 'mobile') { assignments.push('normalized_mobile=?'); values.push(normalizedMobile(value)); }
    if (field === 'email') { assignments.push('normalized_email=?'); values.push(normalizedEmail(value)); }
    events.push(db.prepare('INSERT INTO crm_profile_field_events(id,workspace_id,crm_person_id,field_name,source_type,actor_type,actor_user_id,previous_value,new_value) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(eventId(),input.workspaceId,input.crmPersonId,field,input.actor.sourceType,input.actor.actorType,input.actor.actorUserId||null,masked(field,prior),masked(field,value)));
  }
  if (!assignments.length) return crmProfileProjection(before,{includeInternalNote:!input.actor.memberSelf});
  assignments.push('updated_at=CURRENT_TIMESTAMP');
  await db.batch([
    db.prepare(`UPDATE crm_profiles SET ${assignments.join(',')} WHERE crm_person_id=?`).bind(...values,input.crmPersonId),
    db.prepare('UPDATE crm_people SET updated_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(input.crmPersonId,input.workspaceId),
    ...events,
  ]);
  const after:any = await db.prepare('SELECT * FROM crm_profiles WHERE crm_person_id=? LIMIT 1').bind(input.crmPersonId).first();
  return crmProfileProjection(after,{includeInternalNote:!input.actor.memberSelf});
}

export async function crmPersonByReference(db: D1Database, input: CrmScope & { publicRef: string }) {
  return db.prepare("SELECT p.id,p.public_ref,p.workspace_id,p.status,p.created_at,p.updated_at,pr.*,EXISTS(SELECT 1 FROM crm_person_identity_links l WHERE l.crm_person_id=p.id AND l.workspace_id=p.workspace_id AND l.identity_type='LINE_MEMBER' AND l.verification_status='VERIFIED') has_verified_line_identity FROM crm_people p JOIN crm_profiles pr ON pr.crm_person_id=p.id WHERE p.workspace_id=? AND p.public_ref=? LIMIT 1").bind(input.workspaceId,input.publicRef).first<any>();
}
export async function listCrmPeople(db: D1Database, input: CrmScope & { search?: string; status?: string }) {
  const clauses=['p.workspace_id=?'], args:unknown[]=[input.workspaceId];
  if (input.status) { if (!['ACTIVE','ARCHIVED'].includes(input.status)) throw new Error('CRM_PERSON_STATUS_INVALID'); clauses.push('p.status=?'); args.push(input.status); }
  if (input.lineAccountId) { clauses.push("EXISTS(SELECT 1 FROM crm_person_identity_links fl WHERE fl.crm_person_id=p.id AND fl.workspace_id=p.workspace_id AND fl.line_account_id=? AND fl.identity_type='LINE_MEMBER')"); args.push(input.lineAccountId); }
  const q=clean(input.search,100); if (q) { const like=`%${q.replace(/[\\%_]/g,'\\$&')}%`; clauses.push("(pr.display_name LIKE ? ESCAPE '\\' OR pr.contact_name LIKE ? ESCAPE '\\' OR pr.company_name LIKE ? ESCAPE '\\')"); args.push(like,like,like); }
  const sql=`SELECT p.id,p.public_ref,p.workspace_id,p.status,p.created_at,p.updated_at,pr.*,EXISTS(SELECT 1 FROM crm_person_identity_links l WHERE l.crm_person_id=p.id AND l.workspace_id=p.workspace_id AND l.identity_type='LINE_MEMBER' AND l.verification_status='VERIFIED') has_verified_line_identity FROM crm_people p JOIN crm_profiles pr ON pr.crm_person_id=p.id WHERE ${clauses.join(' AND ')} ORDER BY p.updated_at DESC,p.id DESC LIMIT 100`;
  return ((await db.prepare(sql).bind(...args).all<any>()).results||[]);
}
export function publicCrmPerson(row: any, options: { includePii?: boolean; includeInternalNote?: boolean } = {}) { return { personRef:clean(row.public_ref,80),status:clean(row.status,20),hasVerifiedLineIdentity:Boolean(row.has_verified_line_identity),profile:crmProfileProjection(row,options),createdAt:row.created_at||null,updatedAt:row.updated_at||null }; }
