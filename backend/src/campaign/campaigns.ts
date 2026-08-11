import {
  buildCampaignAudienceSnapshot,
  CAMPAIGN_EXCLUSION_REASONS,
  evaluateCampaignAudience,
  type CampaignAudienceSource,
} from './audiences';
import {
  publicCampaignTextContent,
  validateCampaignContent,
} from './content.ts';
import { trackedLinkRegistrationStatements } from './clicks.ts';

export { CAMPAIGN_TEXT_MAX_LENGTH, validateCampaignContent } from './content.ts';

const clean = (value: unknown, maximum = 160) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const internalId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const publicReference = () => `camp_${crypto.randomUUID().replace(/-/g, '')}`;
const encoder = new TextEncoder();

type CampaignRow = Record<string, unknown> & {
  id: string;
  public_ref: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  status: string;
  current_content_version_no: number;
  current_audience_id?: string | null;
  current_audience_snapshot_no?: number | null;
  prepared_content_version_no?: number | null;
  prepared_segment_id?: string | null;
  prepared_segment_version_no?: number | null;
  matched_count?: number | null;
  eligible_count?: number | null;
  excluded_count?: number | null;
  exclusion_breakdown_json?: string | null;
  source_segment_ref?: string | null;
  created_at: string;
  updated_at: string;
  prepared_at?: string | null;
  archived_at?: string | null;
};

type ContentVersionRow = Record<string, unknown> & {
  version_no: number;
  content_type: string;
  payload_json: string;
  created_at: string;
};

type PrepareActionRow = Record<string, unknown> & {
  content_version_no: number;
  audience_snapshot_no: number;
  segment_version_no: number;
  matched_count: number;
  eligible_count: number;
  excluded_count: number;
  exclusion_breakdown_json: string;
  prepared_at: string;
  source_segment_ref?: string | null;
};


export async function campaignPrepareActionHash(input: {
  workspaceId: string;
  campaignId: string;
  actionReference: unknown;
}) {
  if (typeof input.actionReference !== 'string') throw new Error('CAMPAIGN_ACTION_REFERENCE_INVALID');
  const actionReference = input.actionReference.trim();
  if (actionReference.length < 16 || actionReference.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(actionReference)) {
    throw new Error('CAMPAIGN_ACTION_REFERENCE_INVALID');
  }
  const payload = encoder.encode(`smart-menu-campaign-prepare:v1:${input.workspaceId}:${input.campaignId}:${actionReference}`);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function parseBreakdown(raw: unknown) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && CAMPAIGN_EXCLUSION_REASONS.includes(item.reason) && Number.isSafeInteger(item.count) && item.count >= 0)
      .map(item => ({ reason: String(item.reason), count: Number(item.count) }));
  } catch {
    return [];
  }
}

function parseContent(row: ContentVersionRow) {
  let content: ReturnType<typeof publicCampaignTextContent> = { text: '' };
  try {
    content = publicCampaignTextContent(row.content_type, row.payload_json);
  } catch {
    content = { text: '' };
  }
  return {
    versionNo: Number(row.version_no),
    contentType: 'TEXT',
    ...content,
    createdAt: row.created_at || null,
  };
}

function publicCampaign(row: CampaignRow) {
  const prepared = row.current_audience_id ? {
    contentVersion: Number(row.prepared_content_version_no || 0),
    audienceVersion: Number(row.current_audience_snapshot_no || 0),
    safeSegmentReference: clean(row.source_segment_ref, 80) || null,
    segmentVersion: Number(row.prepared_segment_version_no || 0),
    totalCandidates: Number(row.matched_count || 0),
    eligibleCount: Number(row.eligible_count || 0),
    excludedCount: Number(row.excluded_count || 0),
    exclusionBreakdown: parseBreakdown(row.exclusion_breakdown_json),
    preparedAt: row.prepared_at || null,
  } : null;
  return {
    safeCampaignReference: clean(row.public_ref, 80),
    name: clean(row.name, 120),
    description: clean(row.description, 1000) || null,
    status: clean(row.status, 20),
    currentContentVersion: Number(row.current_content_version_no || 0),
    currentAudienceVersion: prepared?.audienceVersion || 0,
    prepared,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    preparedAt: row.prepared_at || null,
    archivedAt: row.archived_at || null,
  };
}

const CAMPAIGN_SELECT = `SELECT c.*,s.public_ref source_segment_ref
  FROM campaigns c
  LEFT JOIN crm_segments s ON s.id=c.prepared_segment_id AND s.workspace_id=c.workspace_id`;

async function campaignRowByReference(db: D1Database, workspaceId: string, safeCampaignReference: string) {
  const row = await db.prepare(`${CAMPAIGN_SELECT}
    WHERE c.workspace_id=? AND c.public_ref=? LIMIT 1`).bind(workspaceId, safeCampaignReference).first<CampaignRow>();
  if (!row) throw new Error('CAMPAIGN_NOT_FOUND');
  return row;
}

async function contentHistory(db: D1Database, workspaceId: string, campaignId: string) {
  const versions = await db.prepare(`SELECT version_no,content_type,payload_json,created_at
    FROM campaign_content_versions WHERE workspace_id=? AND campaign_id=?
    ORDER BY version_no DESC LIMIT 100`).bind(workspaceId, campaignId).all<ContentVersionRow>();
  return (versions.results || []).map(parseContent);
}

export async function listCampaigns(db: D1Database, workspaceId: string) {
  const rows = await db.prepare(`${CAMPAIGN_SELECT}
    WHERE c.workspace_id=? ORDER BY c.updated_at DESC,c.public_ref ASC`).bind(workspaceId).all<CampaignRow>();
  return (rows.results || []).map(publicCampaign);
}

export async function campaignByReference(db: D1Database, workspaceId: string, safeCampaignReference: string) {
  const row = await campaignRowByReference(db, workspaceId, safeCampaignReference);
  const versions = await contentHistory(db, workspaceId, row.id);
  return {
    ...publicCampaign(row),
    currentContent: versions.find(version => version.versionNo === Number(row.current_content_version_no)) || null,
    contentVersions: versions.map(version => ({
      ...version,
      prepared: Number(row.prepared_content_version_no || 0) === version.versionNo,
    })),
  };
}

export async function createCampaign(db: D1Database, input: {
  workspaceId: string;
  name: unknown;
  description?: unknown;
  content: unknown;
  userId?: string | null;
}) {
  const name = clean(input.name, 120);
  if (!name) throw new Error('CAMPAIGN_NAME_REQUIRED');
  const conflict = await db.prepare('SELECT id FROM campaigns WHERE workspace_id=? AND lower(name)=lower(?) LIMIT 1')
    .bind(input.workspaceId, name).first();
  if (conflict) throw new Error('CAMPAIGN_NAME_CONFLICT');
  const content = validateCampaignContent(input.content);
  const description = clean(input.description, 1000) || null;
  const campaignId = internalId('camp');
  const campaignRef = publicReference();
  const contentId = internalId('campcv');
  const results = await db.batch([
    db.prepare(`INSERT INTO campaigns(
      id,public_ref,workspace_id,name,description,status,current_content_version_no,created_by_user_id
    ) VALUES(?,?,?,?,?,'DRAFT',0,?)`).bind(
      campaignId, campaignRef, input.workspaceId, name, description, input.userId || null,
    ),
    db.prepare(`INSERT INTO campaign_content_versions(
      id,workspace_id,campaign_id,version_no,content_type,payload_json,text_length,created_by_user_id
    ) VALUES(?,?,?,1,'TEXT',?,?,?)`).bind(
      contentId, input.workspaceId, campaignId, content.payloadJson, content.textLength, input.userId || null,
    ),
    db.prepare(`UPDATE campaigns SET current_content_version_no=1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND workspace_id=? AND public_ref=? AND status='DRAFT' AND current_content_version_no=0`)
      .bind(campaignId, input.workspaceId, campaignRef),
  ]);
  if (Number(results[2]?.meta?.changes || 0) !== 1) throw new Error('CAMPAIGN_CREATE_CONFLICT');
  return campaignByReference(db, input.workspaceId, campaignRef);
}

export async function updateCampaign(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  patch: unknown;
  userId?: string | null;
}) {
  if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) throw new Error('CAMPAIGN_PATCH_INVALID');
  const patch = input.patch as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(key => !['name', 'description', 'content'].includes(key))) throw new Error('CAMPAIGN_PATCH_INVALID');
  const current = await campaignRowByReference(db, input.workspaceId, input.safeCampaignReference);
  if (current.status !== 'DRAFT') throw new Error('CAMPAIGN_NOT_DRAFT');
  const name = Object.prototype.hasOwnProperty.call(patch, 'name') ? clean(patch.name, 120) : clean(current.name, 120);
  if (!name) throw new Error('CAMPAIGN_NAME_REQUIRED');
  const conflict = await db.prepare('SELECT id FROM campaigns WHERE workspace_id=? AND lower(name)=lower(?) AND id<>? LIMIT 1')
    .bind(input.workspaceId, name, current.id).first();
  if (conflict) throw new Error('CAMPAIGN_NAME_CONFLICT');
  const description = Object.prototype.hasOwnProperty.call(patch, 'description') ? clean(patch.description, 1000) || null : current.description || null;
  const statements: D1PreparedStatement[] = [];
  let nextVersion = Number(current.current_content_version_no);
  if (Object.prototype.hasOwnProperty.call(patch, 'content')) {
    const content = validateCampaignContent(patch.content);
    const latest = await db.prepare(`SELECT payload_json FROM campaign_content_versions
      WHERE workspace_id=? AND campaign_id=? AND version_no=? LIMIT 1`)
      .bind(input.workspaceId, current.id, current.current_content_version_no).first<Record<string, unknown>>();
    if (!latest) throw new Error('CAMPAIGN_CONTENT_NOT_FOUND');
    if (String(latest.payload_json) !== content.payloadJson) {
      nextVersion += 1;
      statements.push(db.prepare(`INSERT INTO campaign_content_versions(
        id,workspace_id,campaign_id,version_no,content_type,payload_json,text_length,created_by_user_id
      ) VALUES(?,?,?,?, 'TEXT',?,?,?)`).bind(
        internalId('campcv'), input.workspaceId, current.id, nextVersion,
        content.payloadJson, content.textLength, input.userId || null,
      ));
    }
  }
  statements.push(db.prepare(`UPDATE campaigns SET name=?,description=?,current_content_version_no=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND workspace_id=? AND public_ref=? AND status='DRAFT' AND current_content_version_no=?`).bind(
    name, description, nextVersion, current.id, input.workspaceId, input.safeCampaignReference, current.current_content_version_no,
  ));
  const results = await db.batch(statements);
  if (Number(results[results.length - 1]?.meta?.changes || 0) !== 1) throw new Error('CAMPAIGN_UPDATE_CONFLICT');
  return campaignByReference(db, input.workspaceId, input.safeCampaignReference);
}

export async function archiveCampaign(db: D1Database, workspaceId: string, safeCampaignReference: string) {
  const current = await campaignRowByReference(db, workspaceId, safeCampaignReference);
  if (current.status === 'ARCHIVED') return campaignByReference(db, workspaceId, safeCampaignReference);
  const result = await db.prepare(`UPDATE campaigns SET status='ARCHIVED',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND workspace_id=? AND public_ref=? AND status IN ('DRAFT','PREPARED')`)
    .bind(current.id, workspaceId, safeCampaignReference).run();
  if (Number(result.meta.changes || 0) !== 1) throw new Error('CAMPAIGN_ARCHIVE_CONFLICT');
  return campaignByReference(db, workspaceId, safeCampaignReference);
}

export async function previewCampaignAudience(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  source: CampaignAudienceSource;
  executionRule: unknown;
}) {
  const campaign = await campaignRowByReference(db, input.workspaceId, input.safeCampaignReference);
  if (campaign.status !== 'DRAFT') throw new Error('CAMPAIGN_NOT_DRAFT');
  if (Number(campaign.current_content_version_no || 0) < 1) throw new Error('CAMPAIGN_CONTENT_NOT_FOUND');
  const evaluation = await evaluateCampaignAudience(db, input.workspaceId, input.executionRule, 25);
  return {
    safeCampaignReference: clean(campaign.public_ref, 80),
    safeSegmentReference: input.source.safeSegmentReference,
    totalCandidates: evaluation.matchedCount,
    eligibleCount: evaluation.eligibleCount,
    excludedCount: evaluation.excludedCount,
    exclusionBreakdown: evaluation.exclusionBreakdown,
    previewPeople: evaluation.previewPeople,
    truncated: evaluation.truncated,
    maxPreview: 25,
    currentSegmentVersion: input.source.segmentVersionNo,
    currentContentVersion: Number(campaign.current_content_version_no),
  };
}

async function preparedActionByHash(db: D1Database, workspaceId: string, campaignId: string, hash: string) {
  return db.prepare(`SELECT a.*,s.public_ref source_segment_ref FROM campaign_prepare_actions a
    JOIN crm_segments s ON s.id=a.segment_id AND s.workspace_id=a.workspace_id
    WHERE a.workspace_id=? AND a.campaign_id=? AND a.action_reference_hash=? LIMIT 1`)
    .bind(workspaceId, campaignId, hash).first<PrepareActionRow>();
}

function publicPrepareResult(campaignReference: string, row: PrepareActionRow, idempotent: boolean) {
  return {
    safeCampaignReference: clean(campaignReference, 80),
    status: 'PREPARED',
    contentVersion: Number(row.content_version_no),
    audienceVersion: Number(row.audience_snapshot_no),
    safeSegmentReference: clean(row.source_segment_ref, 80),
    segmentVersion: Number(row.segment_version_no),
    totalCandidates: Number(row.matched_count),
    eligibleCount: Number(row.eligible_count),
    excludedCount: Number(row.excluded_count),
    exclusionBreakdown: parseBreakdown(row.exclusion_breakdown_json),
    preparedAt: row.prepared_at || null,
    idempotent,
  };
}

export async function replayPreparedCampaign(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  actionReference: unknown;
}) {
  const campaign = await campaignRowByReference(db, input.workspaceId, input.safeCampaignReference);
  const actionHash = await campaignPrepareActionHash({
    workspaceId: input.workspaceId,
    campaignId: campaign.id,
    actionReference: input.actionReference,
  });
  const previous = await preparedActionByHash(db, input.workspaceId, campaign.id, actionHash);
  if (previous) return publicPrepareResult(campaign.public_ref, previous, true);
  if (campaign.status === 'PREPARED') throw new Error('CAMPAIGN_REPREPARE_UNSUPPORTED');
  if (campaign.status !== 'DRAFT') throw new Error('CAMPAIGN_NOT_DRAFT');
  return null;
}

export async function prepareCampaign(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  source: CampaignAudienceSource;
  executionRule: unknown;
  actionReference: unknown;
  userId?: string | null;
  signingSecret: string;
}) {
  const campaign = await campaignRowByReference(db, input.workspaceId, input.safeCampaignReference);
  const actionHash = await campaignPrepareActionHash({
    workspaceId: input.workspaceId,
    campaignId: campaign.id,
    actionReference: input.actionReference,
  });
  const previous = await preparedActionByHash(db, input.workspaceId, campaign.id, actionHash);
  if (previous) return publicPrepareResult(campaign.public_ref, previous, true);
  if (campaign.status !== 'DRAFT') throw new Error(campaign.status === 'PREPARED' ? 'CAMPAIGN_REPREPARE_UNSUPPORTED' : 'CAMPAIGN_NOT_DRAFT');
  const contentVersion = Number(campaign.current_content_version_no || 0);
  if (contentVersion < 1) throw new Error('CAMPAIGN_CONTENT_NOT_FOUND');
  const content = await db.prepare(`SELECT content_type,payload_json FROM campaign_content_versions
    WHERE workspace_id=? AND campaign_id=? AND version_no=? LIMIT 1`)
    .bind(input.workspaceId, campaign.id, contentVersion).first<Record<string, unknown>>();
  if (!content) throw new Error('CAMPAIGN_CONTENT_NOT_FOUND');
  const trackedLinkStatements = await trackedLinkRegistrationStatements(db, {
    workspaceId: input.workspaceId, campaignId: campaign.id, contentVersionNo: contentVersion,
    contentType: content.content_type, payloadJson: content.payload_json, signingSecret: input.signingSecret,
  });
  const materialization = await buildCampaignAudienceSnapshot(db, {
    workspaceId: input.workspaceId,
    name: `campaign:${campaign.public_ref}:prepared`,
    description: `Prepared audience for ${campaign.public_ref}`,
    source: input.source,
    executionRule: input.executionRule,
    userId: input.userId,
  });
  const preparedAt = new Date().toISOString();
  const breakdownJson = JSON.stringify(materialization.exclusionBreakdown);
  const actionId = internalId('camppa');
  const statements = [
    ...materialization.statements,
    ...trackedLinkStatements,
    db.prepare(`UPDATE campaigns SET status='PREPARED',current_audience_id=?,current_audience_snapshot_no=?,
      prepared_content_version_no=?,prepared_segment_id=?,prepared_segment_version_no=?,matched_count=?,eligible_count=?,
      excluded_count=?,exclusion_breakdown_json=?,prepared_at=?,updated_at=?
      WHERE id=? AND workspace_id=? AND public_ref=? AND status='DRAFT' AND current_content_version_no=?`).bind(
      materialization.audienceId, materialization.snapshotNo, contentVersion, input.source.segmentId,
      input.source.segmentVersionNo, materialization.matchedCount, materialization.eligibleCount,
      materialization.excludedCount, breakdownJson, preparedAt, preparedAt,
      campaign.id, input.workspaceId, campaign.public_ref, contentVersion,
    ),
    db.prepare(`INSERT INTO campaign_prepare_actions(
      id,workspace_id,campaign_id,action_reference_hash,audience_id,audience_snapshot_no,content_version_no,
      segment_id,segment_version_no,matched_count,eligible_count,excluded_count,exclusion_breakdown_json,
      prepared_at,created_by_user_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      actionId, input.workspaceId, campaign.id, actionHash, materialization.audienceId, materialization.snapshotNo,
      contentVersion, input.source.segmentId, input.source.segmentVersionNo, materialization.matchedCount,
      materialization.eligibleCount, materialization.excludedCount, breakdownJson, preparedAt, input.userId || null,
    ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const duplicate = await preparedActionByHash(db, input.workspaceId, campaign.id, actionHash);
    if (duplicate) return publicPrepareResult(campaign.public_ref, duplicate, true);
    const latest = await campaignRowByReference(db, input.workspaceId, campaign.public_ref);
    if (latest.status === 'PREPARED') throw new Error('CAMPAIGN_REPREPARE_UNSUPPORTED');
    throw error;
  }
  const created = await preparedActionByHash(db, input.workspaceId, campaign.id, actionHash);
  if (!created) throw new Error('CAMPAIGN_PREPARE_FAILED');
  return publicPrepareResult(campaign.public_ref, created, false);
}

export async function campaignAudienceRead(db: D1Database, workspaceId: string, safeCampaignReference: string) {
  const campaign = await campaignRowByReference(db, workspaceId, safeCampaignReference);
  const base = {
    safeCampaignReference: clean(campaign.public_ref, 80),
    campaignStatus: clean(campaign.status, 20),
  };
  if (!campaign.current_audience_id) return { ...base, audience: null };
  return {
    ...base,
    audience: {
      audienceVersion: Number(campaign.current_audience_snapshot_no || 0),
      contentVersion: Number(campaign.prepared_content_version_no || 0),
      safeSegmentReference: clean(campaign.source_segment_ref, 80),
      segmentVersion: Number(campaign.prepared_segment_version_no || 0),
      totalCandidates: Number(campaign.matched_count || 0),
      eligibleCount: Number(campaign.eligible_count || 0),
      excludedCount: Number(campaign.excluded_count || 0),
      exclusionBreakdown: parseBreakdown(campaign.exclusion_breakdown_json),
      preparedAt: campaign.prepared_at || null,
    },
  };
}
