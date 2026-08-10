import { compileSegmentRule } from '../crm/segments';

const MAX_AUDIENCE_MEMBERS = 10000;
const clean = (value: unknown, maximum = 160) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const internalId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const publicReference = () => `campa_${crypto.randomUUID().replace(/-/g, '')}`;

const VERIFIED_LINE_SQL = "EXISTS(SELECT 1 FROM crm_person_identity_links l WHERE l.workspace_id=p.workspace_id AND l.crm_person_id=p.id AND l.identity_type='LINE_MEMBER' AND l.verification_status='VERIFIED')";
const ELIGIBLE_SQL = `p.status='ACTIVE' AND pr.do_not_contact=0 AND pr.contactable=1 AND pr.marketing_consent=1 AND ${VERIFIED_LINE_SQL}`;
const EXCLUSION_SQL = `CASE
  WHEN p.status<>'ACTIVE' THEN 'PERSON_ARCHIVED'
  WHEN pr.do_not_contact=1 THEN 'DO_NOT_CONTACT'
  WHEN pr.contactable<>1 THEN 'NOT_CONTACTABLE'
  WHEN pr.marketing_consent<>1 THEN 'MARKETING_CONSENT_MISSING'
  WHEN NOT ${VERIFIED_LINE_SQL} THEN 'NO_VERIFIED_LINE_IDENTITY'
  ELSE NULL END`;

export type CampaignAudienceSource = {
  segmentId: string;
  safeSegmentReference: string;
  segmentVersionNo: number;
  ruleVersion: number;
  rule: unknown;
  ruleJson: string;
};

type AudienceRow = Record<string, unknown> & {
  id: string;
  public_ref: string;
  name: string;
  description?: string | null;
  status: string;
  source_segment_ref: string;
  current_snapshot_no: number;
  snapshot_source_segment_version_no?: number | null;
  matched_count?: number | null;
  eligible_count?: number | null;
  excluded_count?: number | null;
  snapshot_created_at?: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
};

type SnapshotCountRow = { matched_count?: number | string; eligible_count?: number | string };

function publicAudience(row: AudienceRow) {
  const snapshotNo = Number(row.current_snapshot_no || 0);
  return {
    safeAudienceReference: clean(row.public_ref, 80),
    name: clean(row.name, 120),
    description: clean(row.description, 1000) || null,
    status: clean(row.status, 20),
    safeSegmentReference: clean(row.source_segment_ref, 80),
    currentSnapshotNo: snapshotNo,
    currentSnapshot: snapshotNo ? {
      snapshotNo,
      sourceSegmentVersion: Number(row.snapshot_source_segment_version_no || 0),
      matchedCount: Number(row.matched_count || 0),
      eligibleCount: Number(row.eligible_count || 0),
      excludedCount: Number(row.excluded_count || 0),
      createdAt: row.snapshot_created_at || null,
    } : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    archivedAt: row.archived_at || null,
  };
}

const AUDIENCE_SELECT = `SELECT a.*,s.public_ref source_segment_ref,
  snap.source_segment_version_no snapshot_source_segment_version_no,
  snap.matched_count,snap.eligible_count,snap.excluded_count,
  snap.created_at snapshot_created_at
  FROM campaign_audiences a
  JOIN crm_segments s ON s.id=a.source_segment_id AND s.workspace_id=a.workspace_id
  LEFT JOIN campaign_audience_snapshots snap
    ON snap.workspace_id=a.workspace_id AND snap.audience_id=a.id AND snap.snapshot_no=a.current_snapshot_no`;

export async function loadCampaignAudienceSource(
  db: D1Database,
  workspaceId: string,
  safeSegmentReference: string,
): Promise<CampaignAudienceSource> {
  const row = await db.prepare(`SELECT s.id,s.public_ref,s.current_version_no,v.rule_version,v.rule_json
    FROM crm_segments s
    JOIN crm_segment_versions v ON v.workspace_id=s.workspace_id AND v.segment_id=s.id AND v.version_no=s.current_version_no
    WHERE s.workspace_id=? AND s.public_ref=? AND s.status='ACTIVE' LIMIT 1`)
    .bind(workspaceId, safeSegmentReference).first<Record<string, unknown>>();
  if (!row) throw new Error('CAMPAIGN_AUDIENCE_SEGMENT_NOT_FOUND');
  const ruleJson = String(row.rule_json || '');
  try {
    return {
      segmentId: String(row.id),
      safeSegmentReference: String(row.public_ref),
      segmentVersionNo: Number(row.current_version_no),
      ruleVersion: Number(row.rule_version),
      rule: JSON.parse(ruleJson),
      ruleJson,
    };
  } catch {
    throw new Error('CAMPAIGN_AUDIENCE_SEGMENT_RULE_INVALID');
  }
}

async function snapshotCounts(db: D1Database, workspaceId: string, executionRule: unknown) {
  const compiled = compileSegmentRule(executionRule, workspaceId);
  const row = await db.prepare(`SELECT COUNT(*) matched_count,
    COALESCE(SUM(CASE WHEN ${ELIGIBLE_SQL} THEN 1 ELSE 0 END),0) eligible_count
    FROM crm_people p JOIN crm_profiles pr ON pr.crm_person_id=p.id
    WHERE p.workspace_id=?${compiled.where}`)
    .bind(...compiled.args).first<SnapshotCountRow>();
  const matchedCount = Number(row?.matched_count || 0);
  const eligibleCount = Number(row?.eligible_count || 0);
  if (!Number.isSafeInteger(matchedCount) || matchedCount < 0 || matchedCount > MAX_AUDIENCE_MEMBERS) {
    throw new Error('CAMPAIGN_AUDIENCE_TOO_LARGE');
  }
  if (!Number.isSafeInteger(eligibleCount) || eligibleCount < 0 || eligibleCount > matchedCount) {
    throw new Error('CAMPAIGN_AUDIENCE_COUNT_INVALID');
  }
  return { compiled, matchedCount, eligibleCount, excludedCount: matchedCount - eligibleCount };
}

function snapshotMemberInsert(
  db: D1Database,
  workspaceId: string,
  audienceId: string,
  snapshotId: string,
  compiled: ReturnType<typeof compileSegmentRule>,
) {
  return db.prepare(`INSERT INTO campaign_audience_snapshot_members(
    workspace_id,audience_id,snapshot_id,crm_person_id,eligibility_status,exclusion_reason
  ) SELECT ?,?,?,p.id,
    CASE WHEN ${ELIGIBLE_SQL} THEN 'ELIGIBLE' ELSE 'EXCLUDED' END,
    ${EXCLUSION_SQL}
    FROM crm_people p JOIN crm_profiles pr ON pr.crm_person_id=p.id
    WHERE p.workspace_id=?${compiled.where}`)
    .bind(workspaceId, audienceId, snapshotId, ...compiled.args);
}

export async function createCampaignAudience(db: D1Database, input: {
  workspaceId: string;
  name: unknown;
  description?: unknown;
  source: CampaignAudienceSource;
  executionRule: unknown;
  userId?: string | null;
}) {
  const name = clean(input.name, 120);
  if (!name) throw new Error('CAMPAIGN_AUDIENCE_NAME_REQUIRED');
  const conflict = await db.prepare('SELECT id FROM campaign_audiences WHERE workspace_id=? AND lower(name)=lower(?) LIMIT 1')
    .bind(input.workspaceId, name).first();
  if (conflict) throw new Error('CAMPAIGN_AUDIENCE_NAME_CONFLICT');
  const description = clean(input.description, 1000) || null;
  const audienceId = internalId('campa');
  const audienceRef = publicReference();
  const snapshotId = internalId('camps');
  const counts = await snapshotCounts(db, input.workspaceId, input.executionRule);
  await db.batch([
    db.prepare(`INSERT INTO campaign_audiences(
      id,public_ref,workspace_id,name,description,status,source_segment_id,current_snapshot_no,created_by_user_id
    ) VALUES(?,?,?,?,?,'ACTIVE',?,0,?)`).bind(
      audienceId, audienceRef, input.workspaceId, name, description, input.source.segmentId, input.userId || null,
    ),
    db.prepare(`INSERT INTO campaign_audience_snapshots(
      id,workspace_id,audience_id,snapshot_no,source_segment_id,source_segment_version_no,
      rule_version,rule_json,matched_count,eligible_count,excluded_count,created_by_user_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      snapshotId, input.workspaceId, audienceId, 1, input.source.segmentId, input.source.segmentVersionNo,
      input.source.ruleVersion, input.source.ruleJson, counts.matchedCount, counts.eligibleCount,
      counts.excludedCount, input.userId || null,
    ),
    snapshotMemberInsert(db, input.workspaceId, audienceId, snapshotId, counts.compiled),
    db.prepare(`UPDATE campaign_audiences SET current_snapshot_no=1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND workspace_id=? AND public_ref=? AND status='ACTIVE' AND current_snapshot_no=0`)
      .bind(audienceId, input.workspaceId, audienceRef),
  ]);
  return campaignAudienceByReference(db, input.workspaceId, audienceRef);
}

export async function campaignAudienceRefreshContext(db: D1Database, workspaceId: string, safeAudienceReference: string) {
  const audience = await db.prepare(`SELECT a.id,a.current_snapshot_no,s.public_ref source_segment_ref
    FROM campaign_audiences a JOIN crm_segments s ON s.id=a.source_segment_id AND s.workspace_id=a.workspace_id
    WHERE a.workspace_id=? AND a.public_ref=? AND a.status='ACTIVE' LIMIT 1`)
    .bind(workspaceId, safeAudienceReference).first<Record<string, unknown>>();
  if (!audience) throw new Error('CAMPAIGN_AUDIENCE_NOT_FOUND');
  return {
    audienceId: String(audience.id),
    currentSnapshotNo: Number(audience.current_snapshot_no),
    source: await loadCampaignAudienceSource(db, workspaceId, String(audience.source_segment_ref)),
  };
}

export async function refreshCampaignAudience(db: D1Database, input: {
  workspaceId: string;
  safeAudienceReference: string;
  audienceId: string;
  currentSnapshotNo: number;
  source: CampaignAudienceSource;
  executionRule: unknown;
  userId?: string | null;
}) {
  const snapshotNo = input.currentSnapshotNo + 1;
  const snapshotId = internalId('camps');
  const counts = await snapshotCounts(db, input.workspaceId, input.executionRule);
  await db.batch([
    db.prepare(`INSERT INTO campaign_audience_snapshots(
      id,workspace_id,audience_id,snapshot_no,source_segment_id,source_segment_version_no,
      rule_version,rule_json,matched_count,eligible_count,excluded_count,created_by_user_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      snapshotId, input.workspaceId, input.audienceId, snapshotNo, input.source.segmentId,
      input.source.segmentVersionNo, input.source.ruleVersion, input.source.ruleJson,
      counts.matchedCount, counts.eligibleCount, counts.excludedCount, input.userId || null,
    ),
    snapshotMemberInsert(db, input.workspaceId, input.audienceId, snapshotId, counts.compiled),
    db.prepare(`UPDATE campaign_audiences SET current_snapshot_no=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND workspace_id=? AND public_ref=? AND status='ACTIVE' AND current_snapshot_no=?`)
      .bind(snapshotNo, input.audienceId, input.workspaceId, input.safeAudienceReference, input.currentSnapshotNo),
  ]);
  return campaignAudienceByReference(db, input.workspaceId, input.safeAudienceReference);
}

export async function listCampaignAudiences(db: D1Database, workspaceId: string) {
  const result = await db.prepare(`${AUDIENCE_SELECT}
    WHERE a.workspace_id=? ORDER BY a.updated_at DESC,a.public_ref ASC`).bind(workspaceId).all<AudienceRow>();
  return (result.results || []).map(publicAudience);
}

export async function campaignAudienceByReference(db: D1Database, workspaceId: string, safeAudienceReference: string) {
  const row = await db.prepare(`${AUDIENCE_SELECT}
    WHERE a.workspace_id=? AND a.public_ref=? LIMIT 1`).bind(workspaceId, safeAudienceReference).first<AudienceRow>();
  if (!row) throw new Error('CAMPAIGN_AUDIENCE_NOT_FOUND');
  const history = await db.prepare(`SELECT snapshot_no,source_segment_version_no,matched_count,eligible_count,excluded_count,created_at
    FROM campaign_audience_snapshots WHERE workspace_id=? AND audience_id=?
    ORDER BY snapshot_no DESC LIMIT 50`).bind(workspaceId, row.id).all<Record<string, unknown>>();
  return {
    ...publicAudience(row),
    snapshots: (history.results || []).map(snapshot => ({
      snapshotNo: Number(snapshot.snapshot_no),
      sourceSegmentVersion: Number(snapshot.source_segment_version_no),
      matchedCount: Number(snapshot.matched_count),
      eligibleCount: Number(snapshot.eligible_count),
      excludedCount: Number(snapshot.excluded_count),
      createdAt: snapshot.created_at || null,
    })),
  };
}

export async function listCampaignAudienceMembers(db: D1Database, input: {
  workspaceId: string;
  safeAudienceReference: string;
  eligibility: string;
  limit: number;
}) {
  const audience = await db.prepare(`SELECT id,current_snapshot_no FROM campaign_audiences
    WHERE workspace_id=? AND public_ref=? LIMIT 1`).bind(input.workspaceId, input.safeAudienceReference)
    .first<Record<string, unknown>>();
  if (!audience) throw new Error('CAMPAIGN_AUDIENCE_NOT_FOUND');
  const snapshot = await db.prepare(`SELECT id FROM campaign_audience_snapshots
    WHERE workspace_id=? AND audience_id=? AND snapshot_no=? LIMIT 1`)
    .bind(input.workspaceId, audience.id, audience.current_snapshot_no).first<Record<string, unknown>>();
  if (!snapshot) throw new Error('CAMPAIGN_AUDIENCE_SNAPSHOT_NOT_FOUND');
  const filter = input.eligibility === 'ALL' ? '' : ' AND m.eligibility_status=?';
  const args: unknown[] = [input.workspaceId, audience.id, snapshot.id];
  if (filter) args.push(input.eligibility);
  args.push(input.limit + 1);
  const result = await db.prepare(`SELECT p.public_ref,m.eligibility_status,m.exclusion_reason
    FROM campaign_audience_snapshot_members m
    JOIN crm_people p ON p.id=m.crm_person_id AND p.workspace_id=m.workspace_id
    WHERE m.workspace_id=? AND m.audience_id=? AND m.snapshot_id=?${filter}
    ORDER BY p.public_ref ASC LIMIT ?`).bind(...args).all<Record<string, unknown>>();
  const rows = result.results || [];
  return {
    members: rows.slice(0, input.limit).map(row => ({
      safePersonReference: clean(row.public_ref, 80),
      eligibilityStatus: clean(row.eligibility_status, 20),
      exclusionReason: clean(row.exclusion_reason, 80) || null,
    })),
    truncated: rows.length > input.limit,
  };
}

export async function archiveCampaignAudience(db: D1Database, workspaceId: string, safeAudienceReference: string) {
  const result = await db.prepare(`UPDATE campaign_audiences
    SET status='ARCHIVED',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE workspace_id=? AND public_ref=? AND status='ACTIVE'`).bind(workspaceId, safeAudienceReference).run();
  if (!result.meta.changes) throw new Error('CAMPAIGN_AUDIENCE_NOT_FOUND');
  return { safeAudienceReference, status: 'ARCHIVED' };
}
