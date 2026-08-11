import { preflightLineCampaignSend, sendLineTextPush, type LinePushResult } from './line-push.ts';
import { loadFrozenTrackedLinks, recipientTrackedContent, type FrozenTrackedLink } from './clicks.ts';

export const CAMPAIGN_EXECUTION_MAX_RECIPIENTS = 100;
export const CAMPAIGN_DELIVERY_MAX_ATTEMPTS = 3;
export const CAMPAIGN_EXECUTION_CONCURRENCY = 1;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const encoder = new TextEncoder();

type ExecutionRow = Record<string, unknown> & {
  id: string;
  public_ref: string;
  workspace_id: string;
  campaign_id: string;
  audience_id: string;
  audience_version_no: number;
  content_version_no: number;
  line_account_id: string;
  status: string;
  total_recipient_count: number;
  eligible_recipient_count: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  cancelled_count: number;
  safe_error_code?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  campaign_status?: string;
  tracking_base_url?: string | null;
};

type ResumeAuthorityDelivery = {
  execution_id?: string;
  status: string;
  attempt_count: number;
  retryable: number;
  created_at: string;
};

type CampaignExecutionContext = {
  campaignId: string;
  campaignReference: string;
  audienceId: string;
  audienceVersionNo: number;
  snapshotId: string;
  contentVersionNo: number;
  contentType: unknown;
  payloadJson: unknown;
  trackedLinks: FrozenTrackedLink[];
  totalRecipientCount: number;
  eligibleRecipientCount: number;
  lineAccountId: string;
  channelAccessToken: string;
};

type RecipientCandidate = {
  crmPersonId: string;
  lineMemberId: string | null;
  providerRecipientId: string | null;
};

type DeliveryWorkRow = Record<string, unknown> & {
  id: string;
  execution_id: string;
  campaign_id: string;
  audience_version_no: number;
  crm_person_id: string;
  line_member_id?: string | null;
  status: string;
  attempt_count: number;
  retryable: number;
  provider_retry_key: string;
  provider_request_hash: string;
  provider_recipient_id?: string | null;
  created_at: string;
};

const clean = (value: unknown, maximum = 160) => String(value ?? '').trim().slice(0, maximum);
const internalId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const publicReference = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const now = () => new Date().toISOString();

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateActionReference(value: unknown) {
  if (typeof value !== 'string') throw new Error('CAMPAIGN_EXECUTION_ACTION_REFERENCE_INVALID');
  const reference = value.trim();
  if (reference.length < 16 || reference.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(reference)) {
    throw new Error('CAMPAIGN_EXECUTION_ACTION_REFERENCE_INVALID');
  }
  return reference;
}

export async function campaignExecutionActionHash(input: {
  workspaceId: string;
  campaignId: string;
  audienceVersionNo: number;
  contentVersionNo: number;
  actionReference: unknown;
}) {
  const actionReference = validateActionReference(input.actionReference);
  return sha256Hex(`smart-menu-campaign-execute:v1:${input.workspaceId}:${input.campaignId}:${input.audienceVersionNo}:${input.contentVersionNo}:${actionReference}`);
}

export async function campaignProviderRequestHash(input: {
  workspaceId: string;
  executionId: string;
  crmPersonId: string;
  lineMemberId: string | null;
  providerRecipientId: string | null;
  contentVersionNo: number;
  text: string;
}) {
  return sha256Hex(JSON.stringify({
    version: 1,
    workspaceId: input.workspaceId,
    executionId: input.executionId,
    crmPersonId: input.crmPersonId,
    lineMemberId: input.lineMemberId,
    providerRecipientId: input.providerRecipientId,
    contentVersionNo: input.contentVersionNo,
    messages: [{ type: 'text', text: input.text }],
  }));
}


async function replayExecutionByAction(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  actionReference: unknown;
}) {
  const campaign = await db.prepare(`SELECT id,current_audience_snapshot_no,prepared_content_version_no
    FROM campaigns WHERE workspace_id=? AND public_ref=? LIMIT 1`)
    .bind(input.workspaceId, input.safeCampaignReference).first<Record<string, unknown>>();
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  const audienceVersionNo = Number(campaign.current_audience_snapshot_no || 0);
  const contentVersionNo = Number(campaign.prepared_content_version_no || 0);
  if (audienceVersionNo < 1 || contentVersionNo < 1) return null;
  const actionHash = await campaignExecutionActionHash({
    workspaceId: input.workspaceId,
    campaignId: clean(campaign.id),
    audienceVersionNo,
    contentVersionNo,
    actionReference: input.actionReference,
  });
  return executionRowByAction(db, input.workspaceId, clean(campaign.id), actionHash);
}
async function preparedContext(db: D1Database, workspaceId: string, safeCampaignReference: string, signingSecret: string): Promise<CampaignExecutionContext> {
  const campaign = await db.prepare(`SELECT id,public_ref,status,current_audience_id,current_audience_snapshot_no,
      prepared_content_version_no,matched_count,eligible_count
    FROM campaigns WHERE workspace_id=? AND public_ref=? LIMIT 1`)
    .bind(workspaceId, safeCampaignReference).first<Record<string, unknown>>();
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  if (String(campaign.status) !== 'PREPARED') throw new Error('CAMPAIGN_EXECUTION_REQUIRES_PREPARED');

  const campaignId = clean(campaign.id);
  const audienceId = clean(campaign.current_audience_id);
  const audienceVersionNo = Number(campaign.current_audience_snapshot_no || 0);
  const contentVersionNo = Number(campaign.prepared_content_version_no || 0);
  if (!audienceId || audienceVersionNo < 1 || contentVersionNo < 1) throw new Error('CAMPAIGN_EXECUTION_PREPARED_BINDING_INVALID');

  const [snapshot, content, account] = await Promise.all([
    db.prepare(`SELECT id,matched_count,eligible_count FROM campaign_audience_snapshots
      WHERE workspace_id=? AND audience_id=? AND snapshot_no=? LIMIT 1`)
      .bind(workspaceId, audienceId, audienceVersionNo).first<Record<string, unknown>>(),
    db.prepare(`SELECT content_type,payload_json FROM campaign_content_versions
      WHERE workspace_id=? AND campaign_id=? AND version_no=? LIMIT 1`)
      .bind(workspaceId, campaignId, contentVersionNo).first<Record<string, unknown>>(),
    db.prepare(`SELECT id,line_bot_channel_access_token FROM workspace_line_accounts
      WHERE workspace_id=? ORDER BY created_at ASC,id ASC LIMIT 1`)
      .bind(workspaceId).first<Record<string, unknown>>(),
  ]);
  if (!snapshot) throw new Error('CAMPAIGN_EXECUTION_AUDIENCE_NOT_FOUND');
  if (!content) throw new Error('CAMPAIGN_EXECUTION_CONTENT_NOT_FOUND');
  if (!account || !clean(account.id)) throw new Error('LINE_ACCOUNT_CREDENTIAL_MISSING');
  const channelAccessToken = clean(account.line_bot_channel_access_token, 4096);
  if (!channelAccessToken) throw new Error('LINE_ACCOUNT_CREDENTIAL_MISSING');

  const matched = Number(snapshot.matched_count || 0);
  const eligible = Number(snapshot.eligible_count || 0);
  if (matched !== Number(campaign.matched_count || 0) || eligible !== Number(campaign.eligible_count || 0)) {
    throw new Error('CAMPAIGN_EXECUTION_AUDIENCE_BINDING_INVALID');
  }
  if (eligible > CAMPAIGN_EXECUTION_MAX_RECIPIENTS) throw new Error('CAMPAIGN_EXECUTION_TOO_LARGE');

  const trackedLinks = await loadFrozenTrackedLinks(db, {
    workspaceId, campaignId, contentVersionNo, contentType: content.content_type,
    payloadJson: content.payload_json, signingSecret,
  });

  return {
    campaignId,
    campaignReference: clean(campaign.public_ref, 100),
    audienceId,
    audienceVersionNo,
    snapshotId: clean(snapshot.id),
    contentVersionNo,
    contentType: content.content_type,
    payloadJson: content.payload_json,
    trackedLinks,
    totalRecipientCount: matched,
    eligibleRecipientCount: eligible,
    lineAccountId: clean(account.id),
    channelAccessToken,
  };
}

async function frozenRecipients(db: D1Database, workspaceId: string, context: CampaignExecutionContext) {
  const result = await db.prepare(`SELECT m.crm_person_id,
      (SELECT l.line_member_id FROM crm_person_identity_links l
        JOIN line_oa_members lm ON lm.id=l.line_member_id AND lm.workspace_id=l.workspace_id
          AND lm.line_account_id=l.line_account_id AND lm.status='active'
        WHERE l.workspace_id=m.workspace_id AND l.crm_person_id=m.crm_person_id
          AND l.identity_type='LINE_MEMBER' AND l.verification_status='VERIFIED'
          AND l.line_account_id=? ORDER BY l.id ASC LIMIT 1) line_member_id,
      (SELECT t.provider_recipient_id FROM crm_person_identity_links l
        JOIN line_oa_members lm ON lm.id=l.line_member_id AND lm.workspace_id=l.workspace_id
          AND lm.line_account_id=l.line_account_id AND lm.status='active'
        JOIN line_member_delivery_targets t ON t.workspace_id=l.workspace_id
          AND t.line_account_id=l.line_account_id AND t.line_member_id=l.line_member_id
        WHERE l.workspace_id=m.workspace_id AND l.crm_person_id=m.crm_person_id
          AND l.identity_type='LINE_MEMBER' AND l.verification_status='VERIFIED'
          AND l.line_account_id=? ORDER BY l.id ASC LIMIT 1) provider_recipient_id
    FROM campaign_audience_snapshot_members m
    WHERE m.workspace_id=? AND m.audience_id=? AND m.snapshot_id=? AND m.eligibility_status='ELIGIBLE'
    ORDER BY m.crm_person_id ASC LIMIT ?`)
    .bind(context.lineAccountId, context.lineAccountId, workspaceId, context.audienceId, context.snapshotId, CAMPAIGN_EXECUTION_MAX_RECIPIENTS + 1)
    .all<Record<string, unknown>>();
  const rows = result.results || [];
  if (rows.length > CAMPAIGN_EXECUTION_MAX_RECIPIENTS || rows.length !== context.eligibleRecipientCount) {
    throw new Error('CAMPAIGN_EXECUTION_AUDIENCE_COUNT_MISMATCH');
  }
  return rows.map((row): RecipientCandidate => ({
    crmPersonId: clean(row.crm_person_id),
    lineMemberId: clean(row.line_member_id) || null,
    providerRecipientId: clean(row.provider_recipient_id, 100) || null,
  }));
}

function publicExecution(
  row: ExecutionRow,
  idempotent = false,
  authority = { canResume: false, retryableRemaining: 0 },
) {
  return {
    safeExecutionReference: clean(row.public_ref, 100),
    status: clean(row.status, 30),
    audienceVersion: Number(row.audience_version_no),
    contentVersion: Number(row.content_version_no),
    total: Number(row.total_recipient_count || 0),
    eligible: Number(row.eligible_recipient_count || 0),
    pending: Number(row.queued_count || 0),
    sent: Number(row.sent_count || 0),
    failed: Number(row.failed_count || 0),
    skipped: Number(row.skipped_count || 0),
    cancelled: Number(row.cancelled_count || 0),
    safeErrorCode: clean(row.safe_error_code, 80) || null,
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    cancelledAt: row.cancelled_at || null,
    canResume: authority.canResume,
    retryableRemaining: authority.retryableRemaining,
    idempotent,
  };
}

async function executionRowByAction(db: D1Database, workspaceId: string, campaignId: string, actionHash: string) {
  return db.prepare(`SELECT e.*,c.status campaign_status FROM campaign_executions e
    JOIN campaigns c ON c.id=e.campaign_id AND c.workspace_id=e.workspace_id
    WHERE e.workspace_id=? AND e.campaign_id=? AND e.action_reference_hash=? LIMIT 1`)
    .bind(workspaceId, campaignId, actionHash).first<ExecutionRow>();
}

async function executionRowByReference(db: D1Database, workspaceId: string, campaignReference: string, executionReference: string) {
  const row = await db.prepare(`SELECT e.*,c.status campaign_status FROM campaign_executions e
    JOIN campaigns c ON c.id=e.campaign_id AND c.workspace_id=e.workspace_id
    WHERE e.workspace_id=? AND c.public_ref=? AND e.public_ref=? LIMIT 1`)
    .bind(workspaceId, campaignReference, executionReference).first<ExecutionRow>();
  if (!row) throw new Error('CAMPAIGN_EXECUTION_NOT_FOUND');
  return row;
}

async function executionRowById(db: D1Database, workspaceId: string, executionId: string) {
  return db.prepare(`SELECT e.*,c.status campaign_status FROM campaign_executions e
    JOIN campaigns c ON c.id=e.campaign_id AND c.workspace_id=e.workspace_id
    WHERE e.workspace_id=? AND e.id=? LIMIT 1`)
    .bind(workspaceId, executionId).first<ExecutionRow>();
}

async function createExecution(db: D1Database, input: {
  workspaceId: string;
  context: CampaignExecutionContext;
  recipients: RecipientCandidate[];
  actionReference: unknown;
  userId?: string | null;
  signingSecret: string;
  trackingBaseUrl: string;
}) {
  const actionHash = await campaignExecutionActionHash({
    workspaceId: input.workspaceId,
    campaignId: input.context.campaignId,
    audienceVersionNo: input.context.audienceVersionNo,
    contentVersionNo: input.context.contentVersionNo,
    actionReference: input.actionReference,
  });
  const previous = await executionRowByAction(db, input.workspaceId, input.context.campaignId, actionHash);
  if (previous) return { row: previous, idempotent: true };
  const existingVersion = await db.prepare(`SELECT id FROM campaign_executions
    WHERE workspace_id=? AND campaign_id=? AND audience_version_no=? AND content_version_no=? LIMIT 1`)
    .bind(input.workspaceId, input.context.campaignId, input.context.audienceVersionNo, input.context.contentVersionNo).first();
  if (existingVersion) throw new Error('CAMPAIGN_EXECUTION_ALREADY_EXISTS');

  const executionId = internalId('campexe');
  const executionReference = publicReference('cexec');
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO campaign_executions(
      id,public_ref,workspace_id,campaign_id,audience_id,audience_version_no,content_version_no,line_account_id,
      action_reference_hash,status,total_recipient_count,eligible_recipient_count,queued_count,created_by_user_id,tracking_base_url
    ) VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?,?,?,?)`).bind(
      executionId, executionReference, input.workspaceId, input.context.campaignId, input.context.audienceId,
      input.context.audienceVersionNo, input.context.contentVersionNo, input.context.lineAccountId, actionHash,
      input.context.totalRecipientCount, input.recipients.length, input.recipients.length, input.userId || null, input.trackingBaseUrl,
    ),
  ];
  for (const recipient of input.recipients) {
    const deliveryId = internalId('campdel');
    const retryKey = crypto.randomUUID();
    const rendered = await recipientTrackedContent({
      db, workspaceId: input.workspaceId, campaignId: input.context.campaignId, executionId, deliveryId,
      contentType: input.context.contentType, payloadJson: input.context.payloadJson, links: input.context.trackedLinks,
      signingSecret: input.signingSecret, trackingBaseUrl: input.trackingBaseUrl, createContexts: true,
    });
    const requestHash = await campaignProviderRequestHash({
      workspaceId: input.workspaceId,
      executionId,
      crmPersonId: recipient.crmPersonId,
      lineMemberId: recipient.lineMemberId,
      providerRecipientId: recipient.providerRecipientId,
      contentVersionNo: input.context.contentVersionNo,
      text: rendered.text,
    });
    statements.push(db.prepare(`INSERT INTO campaign_deliveries(
      id,public_ref,execution_id,workspace_id,campaign_id,audience_id,audience_version_no,crm_person_id,
      line_member_id,status,provider_retry_key,provider_request_hash
    ) VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?)`).bind(
      deliveryId, publicReference('cdel'), executionId, input.workspaceId, input.context.campaignId,
      input.context.audienceId, input.context.audienceVersionNo, recipient.crmPersonId,
      recipient.lineMemberId, retryKey, requestHash,
    ));
    statements.push(...rendered.statements);
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const duplicate = await executionRowByAction(db, input.workspaceId, input.context.campaignId, actionHash);
    if (duplicate) return { row: duplicate, idempotent: true };
    throw error;
  }
  const created = await executionRowByAction(db, input.workspaceId, input.context.campaignId, actionHash);
  if (!created) throw new Error('CAMPAIGN_EXECUTION_CREATE_FAILED');
  return { row: created, idempotent: false };
}

async function refreshExecutionSummary(db: D1Database, workspaceId: string, executionId: string) {
  const execution = await executionRowById(db, workspaceId, executionId);
  if (!execution) throw new Error('CAMPAIGN_EXECUTION_NOT_FOUND');
  const counts = await db.prepare(`SELECT
      COUNT(*) total_count,
      COALESCE(SUM(CASE WHEN status IN ('PENDING','SENDING') THEN 1 ELSE 0 END),0) queued_count,
      COALESCE(SUM(CASE WHEN status='SENT' THEN 1 ELSE 0 END),0) sent_count,
      COALESCE(SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END),0) failed_count,
      COALESCE(SUM(CASE WHEN status='SKIPPED' THEN 1 ELSE 0 END),0) skipped_count,
      COALESCE(SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END),0) cancelled_count
    FROM campaign_deliveries WHERE workspace_id=? AND execution_id=?`)
    .bind(workspaceId, executionId).first<Record<string, unknown>>();
  const queued = Number(counts?.queued_count || 0);
  const sent = Number(counts?.sent_count || 0);
  const failed = Number(counts?.failed_count || 0);
  const skipped = Number(counts?.skipped_count || 0);
  const cancelled = Number(counts?.cancelled_count || 0);
  let status = String(execution.status);
  let completedAt = execution.completed_at || null;
  if (status !== 'CANCELLED') {
    if (queued > 0 && failed + skipped === 0) status = 'PENDING';
    else if (sent > 0 && failed + skipped + queued > 0) status = 'PARTIAL_FAILED';
    else if (failed + skipped + queued > 0) status = 'FAILED';
    else status = 'COMPLETED';
    completedAt = ['COMPLETED', 'PARTIAL_FAILED', 'FAILED'].includes(status) ? now() : null;
  }
  await db.prepare(`UPDATE campaign_executions SET status=?,queued_count=?,sent_count=?,failed_count=?,
      skipped_count=?,cancelled_count=?,completed_at=? WHERE workspace_id=? AND id=?`)
    .bind(status, queued, sent, failed, skipped, cancelled, completedAt, workspaceId, executionId).run();
  return executionRowById(db, workspaceId, executionId);
}

function retryWindowOpen(createdAt: string, atMs = Date.now()) {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && atMs - created < RETRY_WINDOW_MS;
}

function executionStatusMayResume(executionStatus: string, campaignStatus: string) {
  return campaignStatus === 'PREPARED' && ['PENDING', 'RUNNING', 'FAILED', 'PARTIAL_FAILED'].includes(executionStatus);
}

export function campaignDeliveryCanResume(delivery: ResumeAuthorityDelivery, atMs = Date.now()) {
  const attempts = Number(delivery.attempt_count);
  if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts >= CAMPAIGN_DELIVERY_MAX_ATTEMPTS) return false;
  if (delivery.status === 'PENDING') return true;
  if (!retryWindowOpen(delivery.created_at, atMs)) return false;
  if (delivery.status === 'SENDING') return true;
  return delivery.status === 'FAILED' && Number(delivery.retryable) === 1;
}

export function campaignExecutionRetryAuthority(input: {
  executionStatus: string;
  campaignStatus: string;
  deliveries: readonly ResumeAuthorityDelivery[];
  atMs?: number;
}) {
  if (!executionStatusMayResume(input.executionStatus, input.campaignStatus)) {
    return { canResume: false, retryableRemaining: 0 };
  }
  const retryableRemaining = input.deliveries.filter(delivery => campaignDeliveryCanResume(delivery, input.atMs)).length;
  return { canResume: retryableRemaining > 0, retryableRemaining };
}

async function resumeCandidateRows(db: D1Database, workspaceId: string, executionIds: string[]) {
  if (!executionIds.length) return [] as ResumeAuthorityDelivery[];
  const placeholders = executionIds.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT execution_id,status,attempt_count,retryable,created_at
    FROM campaign_deliveries WHERE workspace_id=? AND execution_id IN (${placeholders})
      AND status IN ('PENDING','SENDING','FAILED')`)
    .bind(workspaceId, ...executionIds).all<ResumeAuthorityDelivery>();
  return rows.results || [];
}

async function projectExecutions(db: D1Database, workspaceId: string, executions: ExecutionRow[], idempotent = false) {
  const candidates = await resumeCandidateRows(
    db,
    workspaceId,
    executions.filter(row => executionStatusMayResume(String(row.status), String(row.campaign_status))).map(row => row.id),
  );
  return executions.map(row => {
    const authority = campaignExecutionRetryAuthority({
      executionStatus: String(row.status),
      campaignStatus: String(row.campaign_status),
      deliveries: candidates.filter(delivery => delivery.execution_id === row.id),
    });
    return publicExecution(row, idempotent, authority);
  });
}

async function projectExecution(db: D1Database, workspaceId: string, execution: ExecutionRow, idempotent = false) {
  const projected = await projectExecutions(db, workspaceId, [execution], idempotent);
  return projected[0];
}

async function resumeWorkRows(db: D1Database, input: {
  workspaceId: string;
  execution: ExecutionRow;
  lineAccountId: string;
}) {
  const rows = await db.prepare(`SELECT d.*,t.provider_recipient_id FROM campaign_deliveries d
    LEFT JOIN line_member_delivery_targets t ON t.workspace_id=d.workspace_id
      AND t.line_account_id=? AND t.line_member_id=d.line_member_id
    WHERE d.workspace_id=? AND d.execution_id=? AND d.status IN ('PENDING','SENDING','FAILED')
    ORDER BY d.created_at ASC,d.id ASC`)
    .bind(input.lineAccountId, input.workspaceId, input.execution.id).all<DeliveryWorkRow>();
  const candidates = rows.results || [];
  const authority = campaignExecutionRetryAuthority({
    executionStatus: String(input.execution.status),
    campaignStatus: String(input.execution.campaign_status),
    deliveries: candidates,
  });
  if (!authority.canResume) return [];
  return candidates.filter(delivery => campaignDeliveryCanResume(delivery));
}

async function recordUnsendable(db: D1Database, workspaceId: string, deliveryId: string) {
  await db.prepare(`UPDATE campaign_deliveries SET status='SKIPPED',retryable=0,safe_error_code='LINE_INVALID_RECIPIENT',
      failed_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=? AND status IN ('PENDING','FAILED')`)
    .bind(workspaceId, deliveryId).run();
}

async function recordProviderResult(db: D1Database, workspaceId: string, row: DeliveryWorkRow, attemptNo: number, result: LinePushResult) {
  const completedAt = now();
  const status = result.accepted ? 'SENT' : 'FAILED';
  const retryable = result.retryable && attemptNo < CAMPAIGN_DELIVERY_MAX_ATTEMPTS;
  const attemptId = internalId('campatt');
  await db.batch([
    db.prepare(`INSERT INTO campaign_delivery_attempts(
      id,execution_id,delivery_id,workspace_id,campaign_id,audience_version_no,attempt_no,status,
      provider_request_hash,provider_status_code,safe_error_code,retryable,attempted_at,completed_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      attemptId, row.execution_id, row.id, workspaceId, row.campaign_id, row.audience_version_no,
      attemptNo, status, row.provider_request_hash, result.providerStatusCode,
      result.safeErrorCode, retryable ? 1 : 0, completedAt, completedAt,
    ),
    db.prepare(`UPDATE campaign_deliveries SET status=?,retryable=?,provider_status_code=?,safe_error_code=?,
      succeeded_at=?,failed_at=? WHERE workspace_id=? AND id=? AND status='SENDING'`).bind(
      status, retryable ? 1 : 0, result.providerStatusCode, result.safeErrorCode,
      result.accepted ? completedAt : null, result.accepted ? null : completedAt, workspaceId, row.id,
    ),
  ]);
}

async function runExecution(db: D1Database, input: {
  workspaceId: string;
  execution: ExecutionRow;
  context: CampaignExecutionContext;
  work: DeliveryWorkRow[];
  signingSecret: string;
  fetcher?: typeof fetch;
}) {
  await db.prepare(`UPDATE campaign_executions SET status='RUNNING',started_at=COALESCE(started_at,CURRENT_TIMESTAMP),completed_at=NULL
    WHERE workspace_id=? AND id=? AND status IN ('PENDING','RUNNING','FAILED','PARTIAL_FAILED')`)
    .bind(input.workspaceId, input.execution.id).run();

  for (const row of input.work) {
    const state = await db.prepare('SELECT status FROM campaign_executions WHERE workspace_id=? AND id=? LIMIT 1')
      .bind(input.workspaceId, input.execution.id).first<Record<string, unknown>>();
    if (String(state?.status) === 'CANCELLED') break;
    const recipient = clean(row.provider_recipient_id, 100);
    if (!row.line_member_id || !recipient) {
      await recordUnsendable(db, input.workspaceId, row.id);
      continue;
    }
    const rendered = await recipientTrackedContent({
      db, workspaceId: input.workspaceId, campaignId: input.context.campaignId,
      executionId: row.execution_id, deliveryId: row.id, contentType: input.context.contentType,
      payloadJson: input.context.payloadJson, links: input.context.trackedLinks, signingSecret: input.signingSecret,
      trackingBaseUrl: clean(input.execution.tracking_base_url, 500), createContexts: false,
    });
    const currentRequestHash = await campaignProviderRequestHash({
      workspaceId: input.workspaceId,
      executionId: row.execution_id,
      crmPersonId: row.crm_person_id,
      lineMemberId: clean(row.line_member_id) || null,
      providerRecipientId: recipient,
      contentVersionNo: input.context.contentVersionNo,
      text: rendered.text,
    });
    if (currentRequestHash !== row.provider_request_hash) {
      await recordUnsendable(db, input.workspaceId, row.id);
      continue;
    }
    if (row.status !== 'PENDING' && !retryWindowOpen(row.created_at)) {
      await db.prepare(`UPDATE campaign_deliveries SET status='FAILED',retryable=0,safe_error_code='LINE_RETRY_WINDOW_EXPIRED',
        failed_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=? AND status<>'SENT'`)
        .bind(input.workspaceId, row.id).run();
      continue;
    }
    const continuingUncertainAttempt = row.status === 'SENDING';
    const attemptNo = Number(row.attempt_count || 0) + (continuingUncertainAttempt ? 0 : 1);
    const claimed = await db.prepare(`UPDATE campaign_deliveries SET status='SENDING',retryable=0,
        attempt_count=attempt_count+?,attempted_at=CURRENT_TIMESTAMP
      WHERE workspace_id=? AND id=? AND attempt_count=? AND status IN ('PENDING','SENDING','FAILED')
        AND NOT EXISTS(SELECT 1 FROM campaign_executions e WHERE e.id=execution_id AND e.workspace_id=workspace_id AND e.status='CANCELLED')`)
      .bind(continuingUncertainAttempt ? 0 : 1, input.workspaceId, row.id, row.attempt_count).run();
    if (Number(claimed.meta.changes || 0) !== 1) continue;
    const result = await sendLineTextPush({
      channelAccessToken: input.context.channelAccessToken,
      providerRecipientId: recipient,
      text: rendered.text,
      retryKey: row.provider_retry_key,
      fetcher: input.fetcher,
    });
    await recordProviderResult(db, input.workspaceId, row, attemptNo, result);
    if (result.safeErrorCode === 'LINE_RATE_LIMITED' || result.safeErrorCode === 'LINE_INVALID_CREDENTIAL') break;
  }
  return refreshExecutionSummary(db, input.workspaceId, input.execution.id);
}

export async function executePreparedCampaign(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  actionReference: unknown;
  userId?: string | null;
  signingSecret: string;
  trackingBaseUrl: string;
  fetcher?: typeof fetch;
}) {
  const replay = await replayExecutionByAction(db, input);
  if (replay) return projectExecution(db, input.workspaceId, replay, true);
  const context = await preparedContext(db, input.workspaceId, input.safeCampaignReference, input.signingSecret);
  const preflight = await preflightLineCampaignSend({
    channelAccessToken: context.channelAccessToken,
    recipientCount: context.eligibleRecipientCount,
    fetcher: input.fetcher,
  });
  if (!preflight.ready) throw new Error(preflight.safeErrorCode || 'LINE_CREDENTIAL_PREFLIGHT_FAILED');
  const recipients = await frozenRecipients(db, input.workspaceId, context);
  const created = await createExecution(db, { ...input, context, recipients });
  if (created.idempotent) return projectExecution(db, input.workspaceId, created.row, true);
  const work = await resumeWorkRows(db, { workspaceId: input.workspaceId, execution: created.row, lineAccountId: context.lineAccountId });
  const completed = await runExecution(db, { workspaceId: input.workspaceId, execution: created.row, context, work, signingSecret: input.signingSecret, fetcher: input.fetcher });
  if (!completed) throw new Error('CAMPAIGN_EXECUTION_READ_FAILED');
  return projectExecution(db, input.workspaceId, completed, false);
}

async function contextForExecution(db: D1Database, workspaceId: string, campaignReference: string, execution: ExecutionRow, signingSecret: string) {
  const context = await preparedContext(db, workspaceId, campaignReference, signingSecret);
  if (context.campaignId !== execution.campaign_id || context.audienceId !== execution.audience_id
    || context.audienceVersionNo !== Number(execution.audience_version_no)
    || context.contentVersionNo !== Number(execution.content_version_no)
    || context.lineAccountId !== execution.line_account_id) {
    throw new Error('CAMPAIGN_EXECUTION_VERSION_BINDING_INVALID');
  }
  return context;
}

export async function resumeCampaignExecution(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  safeExecutionReference: string;
  signingSecret: string;
  fetcher?: typeof fetch;
}) {
  const execution = await executionRowByReference(db, input.workspaceId, input.safeCampaignReference, input.safeExecutionReference);
  if (execution.status === 'CANCELLED') throw new Error('CAMPAIGN_EXECUTION_CANCELLED');
  if (execution.status === 'COMPLETED') throw new Error('CAMPAIGN_EXECUTION_COMPLETED');
  if (!executionStatusMayResume(String(execution.status), String(execution.campaign_status))) {
    throw new Error('CAMPAIGN_EXECUTION_NOT_RESUMABLE');
  }
  const context = await contextForExecution(db, input.workspaceId, input.safeCampaignReference, execution, input.signingSecret);
  const work = await resumeWorkRows(db, { workspaceId: input.workspaceId, execution, lineAccountId: context.lineAccountId });
  if (!work.length) throw new Error('CAMPAIGN_EXECUTION_NOT_RESUMABLE');
  const preflight = await preflightLineCampaignSend({
    channelAccessToken: context.channelAccessToken,
    recipientCount: work.length,
    fetcher: input.fetcher,
  });
  if (!preflight.ready) throw new Error(preflight.safeErrorCode || 'LINE_CREDENTIAL_PREFLIGHT_FAILED');
  const result = await runExecution(db, { workspaceId: input.workspaceId, execution, context, work, signingSecret: input.signingSecret, fetcher: input.fetcher });
  if (!result) throw new Error('CAMPAIGN_EXECUTION_READ_FAILED');
  return projectExecution(db, input.workspaceId, result);
}

export async function cancelCampaignExecution(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  safeExecutionReference: string;
}) {
  const execution = await executionRowByReference(db, input.workspaceId, input.safeCampaignReference, input.safeExecutionReference);
  if (execution.status === 'CANCELLED') return publicExecution(execution, true);
  if (execution.status === 'COMPLETED') throw new Error('CAMPAIGN_EXECUTION_COMPLETED');
  const cancelledAt = now();
  await db.batch([
    db.prepare(`UPDATE campaign_deliveries SET status='CANCELLED',retryable=0,safe_error_code=NULL
      WHERE workspace_id=? AND execution_id=? AND (status='PENDING' OR (status='FAILED' AND retryable=1))`)
      .bind(input.workspaceId, execution.id),
    db.prepare(`UPDATE campaign_executions SET status='CANCELLED',cancelled_at=?,completed_at=?
      WHERE workspace_id=? AND id=? AND status<>'COMPLETED'`).bind(cancelledAt, cancelledAt, input.workspaceId, execution.id),
  ]);
  const refreshed = await refreshExecutionSummary(db, input.workspaceId, execution.id);
  if (!refreshed) throw new Error('CAMPAIGN_EXECUTION_READ_FAILED');
  return publicExecution(refreshed);
}

export async function listCampaignExecutions(db: D1Database, workspaceId: string, safeCampaignReference: string) {
  const campaign = await db.prepare('SELECT id FROM campaigns WHERE workspace_id=? AND public_ref=? LIMIT 1')
    .bind(workspaceId, safeCampaignReference).first<Record<string, unknown>>();
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  const rows = await db.prepare(`SELECT e.*,c.status campaign_status FROM campaign_executions e
    JOIN campaigns c ON c.id=e.campaign_id AND c.workspace_id=e.workspace_id
    WHERE e.workspace_id=? AND e.campaign_id=? ORDER BY e.created_at DESC,e.public_ref ASC LIMIT 100`)
    .bind(workspaceId, campaign.id).all<ExecutionRow>();
  return projectExecutions(db, workspaceId, rows.results || []);
}

export async function campaignExecutionByReference(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  safeExecutionReference: string;
}) {
  const execution = await executionRowByReference(db, input.workspaceId, input.safeCampaignReference, input.safeExecutionReference);
  return projectExecution(db, input.workspaceId, execution);
}

export async function listCampaignDeliveries(db: D1Database, input: {
  workspaceId: string;
  safeCampaignReference: string;
  safeExecutionReference: string;
  limit: number;
  offset: number;
}) {
  const execution = await executionRowByReference(db, input.workspaceId, input.safeCampaignReference, input.safeExecutionReference);
  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
  const offset = Math.max(Math.trunc(input.offset), 0);
  const rows = await db.prepare(`SELECT d.status,d.attempt_count,d.safe_error_code,d.attempted_at,
      COALESCE(NULLIF(p.display_name,''),NULLIF(p.contact_name,''),'LINE member') person_label
    FROM campaign_deliveries d JOIN crm_profiles p ON p.crm_person_id=d.crm_person_id
    WHERE d.workspace_id=? AND d.execution_id=? ORDER BY d.created_at ASC,d.public_ref ASC LIMIT ? OFFSET ?`)
    .bind(input.workspaceId, execution.id, limit + 1, offset).all<Record<string, unknown>>();
  const results = rows.results || [];
  return {
    deliveries: results.slice(0, limit).map(row => ({
      personLabel: clean(row.person_label, 120),
      status: clean(row.status, 20),
      attemptCount: Number(row.attempt_count || 0),
      safeErrorCode: clean(row.safe_error_code, 80) || null,
      attemptedAt: row.attempted_at || null,
    })),
    nextOffset: results.length > limit ? offset + limit : null,
  };
}
