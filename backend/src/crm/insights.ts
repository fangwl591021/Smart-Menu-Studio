const safe = (value: unknown, maximum = 500) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const tagRef = () => `crmt_${crypto.randomUUID().replace(/-/g, '')}`;
const TAG_STATUSES = new Set(['ACTIVE', 'ARCHIVED']);

export function zodiacFromBirthday(value: unknown) {
  const birthday = safe(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || parsed.getTime() > Date.now()) return null;
  const md = month * 100 + day;
  const ranges: Array<[number, string]> = [[119, 'CAPRICORN'], [218, 'AQUARIUS'], [320, 'PISCES'], [419, 'ARIES'], [520, 'TAURUS'], [621, 'GEMINI'], [722, 'CANCER'], [822, 'LEO'], [922, 'VIRGO'], [1022, 'LIBRA'], [1121, 'SCORPIO'], [1221, 'SAGITTARIUS'], [1231, 'CAPRICORN']];
  return ranges.find(([maximum]) => md <= maximum)?.[1] || null;
}

export async function listCrmTags(db: D1Database, workspaceId: string) {
  const rows: any[] = (await db.prepare('SELECT public_ref,name,description,status,created_at,updated_at FROM crm_tags WHERE workspace_id=? ORDER BY name ASC').bind(workspaceId).all()).results || [];
  return rows.map(row => ({ tagReference: safe(row.public_ref, 80), name: safe(row.name, 120), description: safe(row.description, 1000) || null, status: safe(row.status, 20), createdAt: row.created_at || null, updatedAt: row.updated_at || null }));
}

export async function createCrmTag(db: D1Database, input: { workspaceId: string; name: unknown; description?: unknown; createdByUserId?: string | null }) {
  const name = safe(input.name, 120); if (!name) throw new Error('CRM_TAG_NAME_REQUIRED');
  const existing = await db.prepare('SELECT id FROM crm_tags WHERE workspace_id=? AND name=? LIMIT 1').bind(input.workspaceId, name).first<any>();
  if (existing) throw new Error('CRM_TAG_DUPLICATE');
  const publicRef = tagRef();
  await db.prepare("INSERT INTO crm_tags(id,public_ref,workspace_id,name,description,status,created_by_user_id) VALUES(?,?,?,?,?,'ACTIVE',?)").bind(id('crmtag'), publicRef, input.workspaceId, name, safe(input.description, 1000) || null, input.createdByUserId || null).run();
  return { tagReference: publicRef, name, description: safe(input.description, 1000) || null, status: 'ACTIVE' };
}

export async function setCrmTagStatus(db: D1Database, input: { workspaceId: string; tagReference: string; status: unknown }) {
  const status = safe(input.status, 20).toUpperCase(); if (!TAG_STATUSES.has(status)) throw new Error('CRM_TAG_STATUS_INVALID');
  const result = await db.prepare('UPDATE crm_tags SET status=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND public_ref=?').bind(status, input.workspaceId, input.tagReference).run();
  if (!result.meta.changes) throw new Error('CRM_TAG_NOT_FOUND');
  return { tagReference: input.tagReference, status };
}

export async function listPersonTags(db: D1Database, workspaceId: string, personId: string) {
  const rows: any[] = (await db.prepare(`SELECT t.public_ref,t.name,t.description,t.status,pt.source_type,pt.assigned_at FROM crm_person_tags pt JOIN crm_tags t ON t.id=pt.crm_tag_id AND t.workspace_id=pt.workspace_id WHERE pt.workspace_id=? AND pt.crm_person_id=? AND pt.removed_at IS NULL ORDER BY t.name ASC`).bind(workspaceId, personId).all()).results || [];
  return rows.map(row => ({ tagReference: safe(row.public_ref, 80), name: safe(row.name, 120), description: safe(row.description, 1000) || null, status: safe(row.status, 20), sourceType: safe(row.source_type, 40), assignedAt: row.assigned_at || null }));
}

export async function assignPersonTag(db: D1Database, input: { workspaceId: string; personId: string; tagReference: string; assignedByUserId?: string | null }) {
  const tag: any = await db.prepare("SELECT id,status FROM crm_tags WHERE workspace_id=? AND public_ref=? LIMIT 1").bind(input.workspaceId, input.tagReference).first();
  if (!tag) throw new Error('CRM_TAG_NOT_FOUND'); if (tag.status !== 'ACTIVE') throw new Error('CRM_TAG_ARCHIVED');
  const existing: any = await db.prepare('SELECT id FROM crm_person_tags WHERE workspace_id=? AND crm_person_id=? AND crm_tag_id=? AND removed_at IS NULL LIMIT 1').bind(input.workspaceId, input.personId, tag.id).first();
  if (existing) return { code: 'ALREADY_ASSIGNED' };
  await db.prepare("INSERT INTO crm_person_tags(id,workspace_id,crm_person_id,crm_tag_id,source_type,assigned_by_user_id) VALUES(?,?,?,?, 'CRM_MANUAL',?)").bind(id('crmpt'), input.workspaceId, input.personId, tag.id, input.assignedByUserId || null).run();
  return { code: 'ASSIGNED' };
}

export async function removePersonTag(db: D1Database, input: { workspaceId: string; personId: string; tagReference: string }) {
  const result = await db.prepare(`UPDATE crm_person_tags SET removed_at=CURRENT_TIMESTAMP WHERE id=(SELECT pt.id FROM crm_person_tags pt JOIN crm_tags t ON t.id=pt.crm_tag_id AND t.workspace_id=pt.workspace_id WHERE pt.workspace_id=? AND pt.crm_person_id=? AND t.public_ref=? AND pt.removed_at IS NULL LIMIT 1) AND removed_at IS NULL`).bind(input.workspaceId, input.personId, input.tagReference).run();
  return { code: result.meta.changes ? 'REMOVED' : 'NOT_ASSIGNED' };
}

export async function listPersonInsights(db: D1Database, workspaceId: string, personId: string) {
  const rows: any[] = (await db.prepare('SELECT insight_type,dimension,label,summary,score,source_type,model_or_rule_version,status,generated_at,reviewed_at FROM crm_person_insights WHERE workspace_id=? AND crm_person_id=? ORDER BY generated_at DESC,id DESC').bind(workspaceId, personId).all()).results || [];
  return rows.map(row => ({ insightType: safe(row.insight_type, 80), dimension: safe(row.dimension, 80), label: safe(row.label, 120), summary: safe(row.summary, 2000), score: Number.isFinite(Number(row.score)) ? Number(row.score) : null, sourceType: safe(row.source_type, 40), version: safe(row.model_or_rule_version, 120), status: safe(row.status, 20), generatedAt: row.generated_at || null, reviewedAt: row.reviewed_at || null }));
}

export async function listPersonTraits(db: D1Database, workspaceId: string, personId: string, currentOnly = false) {
  const suffix = currentOnly ? ' AND superseded_at IS NULL' : '';
  const rows: any[] = (await db.prepare(`SELECT trait_type,trait_value,source_type,derivation_version,generated_at,superseded_at FROM crm_person_traits WHERE workspace_id=? AND crm_person_id=?${suffix} ORDER BY generated_at DESC,id DESC`).bind(workspaceId, personId).all()).results || [];
  return rows.map(row => ({ traitType: safe(row.trait_type, 80), traitValue: safe(row.trait_value, 120), sourceType: safe(row.source_type, 40), derivationVersion: safe(row.derivation_version, 120), generatedAt: row.generated_at || null, supersededAt: row.superseded_at || null }));
}

export async function deriveZodiacTrait(db: D1Database, input: { workspaceId: string; personId: string }) {
  const profile: any = await db.prepare('SELECT birthday FROM crm_profiles WHERE crm_person_id=? LIMIT 1').bind(input.personId).first();
  const zodiac = zodiacFromBirthday(profile?.birthday); if (!zodiac) throw new Error('CRM_BIRTHDAY_INVALID');
  const existing: any = await db.prepare("SELECT id,trait_value FROM crm_person_traits WHERE workspace_id=? AND crm_person_id=? AND trait_type='ZODIAC' AND superseded_at IS NULL LIMIT 1").bind(input.workspaceId, input.personId).first();
  if (existing?.trait_value === zodiac) return { code: 'UNCHANGED', traitType: 'ZODIAC', traitValue: zodiac, derivationVersion: 'zodiac:v1' };
  const statements = [] as any[];
  if (existing) statements.push(db.prepare('UPDATE crm_person_traits SET superseded_at=CURRENT_TIMESTAMP WHERE id=? AND superseded_at IS NULL').bind(existing.id));
  statements.push(db.prepare("INSERT INTO crm_person_traits(id,workspace_id,crm_person_id,trait_type,trait_value,source_type,derivation_version) VALUES(?,?,?,?,?,'DETERMINISTIC_RULE','zodiac:v1')").bind(id('crmtrait'), input.workspaceId, input.personId, 'ZODIAC', zodiac));
  await db.batch(statements);
  return { code: 'DERIVED', traitType: 'ZODIAC', traitValue: zodiac, derivationVersion: 'zodiac:v1' };
}
