export type PointReasonCode = 'QUALIFIED_REFERRAL' | 'VERIFIED_REFERRAL_CONVERSION';
export type PointSourceType = 'REFERRAL_ATTRIBUTION' | 'CONVERSION_REFERRAL_EVIDENCE';

type Scoped = {
  workspaceId: string;
  lineAccountId: string;
};

type PointSourceResolution = Scoped & {
  memberId: string;
  sourceType: PointSourceType;
  sourceRef: string;
  eventAt: string;
};

export type CreditPointsResult =
  | { ok: true; code: 'CREDITED'; points: number }
  | { ok: true; code: 'ALREADY_CREDITED'; points: number }
  | { ok: false; code: 'NO_POINT_RULE' | 'SOURCE_NOT_FOUND' | 'SOURCE_NOT_QUALIFIED' };

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function resolvePointSource(
  db: D1Database,
  scoped: Scoped,
  reasonCode: PointReasonCode,
  sourceRef: string,
): Promise<PointSourceResolution | null> {
  if (reasonCode === 'QUALIFIED_REFERRAL') {
    const row = await db.prepare(`
      SELECT id, inviter_member_id AS member_id, qualified_at
      FROM member_referral_attributions
      WHERE id = ? AND workspace_id = ? AND line_account_id = ?
        AND status = 'qualified' AND qualified_at IS NOT NULL
      LIMIT 1
    `).bind(sourceRef, scoped.workspaceId, scoped.lineAccountId).first<any>();
    if (!row) return null;
    return {
      ...scoped,
      memberId: String(row.member_id),
      sourceType: 'REFERRAL_ATTRIBUTION',
      sourceRef: String(row.id),
      eventAt: String(row.qualified_at),
    };
  }

  const row = await db.prepare(`
    SELECT
      e.id AS evidence_id,
      a.inviter_member_id AS member_id,
      c.occurred_at AS occurred_at
    FROM conversion_referral_evidence e
    JOIN member_referral_attributions a
      ON a.id = e.member_referral_attribution_id
     AND a.workspace_id = e.workspace_id
     AND a.line_account_id = e.line_account_id
    JOIN line_conversion_events c
      ON c.id = e.conversion_event_id
     AND c.workspace_id = e.workspace_id
     AND c.line_account_id = e.line_account_id
    WHERE e.id = ? AND e.workspace_id = ? AND e.line_account_id = ?
      AND a.status = 'qualified' AND a.qualified_at IS NOT NULL
    LIMIT 1
  `).bind(sourceRef, scoped.workspaceId, scoped.lineAccountId).first<any>();
  if (!row) return null;
  return {
    ...scoped,
    memberId: String(row.member_id),
    sourceType: 'CONVERSION_REFERRAL_EVIDENCE',
    sourceRef: String(row.evidence_id),
    eventAt: String(row.occurred_at),
  };
}

async function resolveHistoricalRule(
  db: D1Database,
  scoped: Scoped,
  reasonCode: PointReasonCode,
  eventAt: string,
) {
  return db.prepare(`
    SELECT id, points, version_no, effective_from
    FROM point_rule_versions
    WHERE workspace_id = ? AND line_account_id = ? AND reason_code = ?
      AND effective_from <= ?
    ORDER BY effective_from DESC, version_no DESC
    LIMIT 1
  `).bind(scoped.workspaceId, scoped.lineAccountId, reasonCode, eventAt).first<any>();
}

async function ensurePointAccount(db: D1Database, scoped: Scoped, memberId: string) {
  const existing = await db.prepare(`
    SELECT id FROM member_point_accounts
    WHERE workspace_id = ? AND line_account_id = ? AND member_id = ?
    LIMIT 1
  `).bind(scoped.workspaceId, scoped.lineAccountId, memberId).first<any>();
  if (existing?.id) return String(existing.id);

  const id = newId('pointacct');
  await db.prepare(`
    INSERT INTO member_point_accounts (id, workspace_id, line_account_id, member_id, status)
    VALUES (?, ?, ?, ?, 'ACTIVE')
    ON CONFLICT(workspace_id,line_account_id,member_id) DO NOTHING
  `).bind(id, scoped.workspaceId, scoped.lineAccountId, memberId).run();

  const created = await db.prepare(`
    SELECT id FROM member_point_accounts
    WHERE workspace_id = ? AND line_account_id = ? AND member_id = ?
    LIMIT 1
  `).bind(scoped.workspaceId, scoped.lineAccountId, memberId).first<any>();
  if (!created?.id) throw new Error('POINT_ACCOUNT_CREATE_FAILED');
  return String(created.id);
}

export async function creditPointsForSource(
  db: D1Database,
  input: Scoped & { reasonCode: PointReasonCode; sourceRef: string },
): Promise<CreditPointsResult> {
  const source = await resolvePointSource(db, input, input.reasonCode, input.sourceRef);
  if (!source) return { ok: false, code: 'SOURCE_NOT_FOUND' };

  const existing = await db.prepare(`
    SELECT points FROM member_point_ledger_entries
    WHERE workspace_id = ? AND line_account_id = ? AND source_type = ? AND source_ref = ?
    LIMIT 1
  `).bind(input.workspaceId, input.lineAccountId, source.sourceType, source.sourceRef).first<any>();
  if (existing) return { ok: true, code: 'ALREADY_CREDITED', points: Number(existing.points) };

  const rule = await resolveHistoricalRule(db, input, input.reasonCode, source.eventAt);
  if (!rule) return { ok: false, code: 'NO_POINT_RULE' };

  const points = Number(rule.points);
  if (!Number.isSafeInteger(points) || points <= 0) throw new Error('INVALID_POINT_RULE');
  const pointAccountId = await ensurePointAccount(db, input, source.memberId);
  const entryId = newId('pointentry');

  try {
    await db.prepare(`
      INSERT INTO member_point_ledger_entries (
        id, workspace_id, line_account_id, point_account_id,
        entry_type, points, reason_code, source_type, source_ref, effective_at
      ) VALUES (?, ?, ?, ?, 'CREDIT', ?, ?, ?, ?, ?)
    `).bind(
      entryId,
      input.workspaceId,
      input.lineAccountId,
      pointAccountId,
      points,
      input.reasonCode,
      source.sourceType,
      source.sourceRef,
      source.eventAt,
    ).run();
    return { ok: true, code: 'CREDITED', points };
  } catch (error: any) {
    const duplicated = await db.prepare(`
      SELECT points FROM member_point_ledger_entries
      WHERE workspace_id = ? AND line_account_id = ? AND source_type = ? AND source_ref = ?
      LIMIT 1
    `).bind(input.workspaceId, input.lineAccountId, source.sourceType, source.sourceRef).first<any>();
    if (duplicated) return { ok: true, code: 'ALREADY_CREDITED', points: Number(duplicated.points) };
    throw error;
  }
}

export async function createPointRuleVersion(
  db: D1Database,
  input: Scoped & { reasonCode: PointReasonCode; points: number; createdByUserId: string },
) {
  if (!Number.isSafeInteger(input.points) || input.points <= 0 || input.points > 100000000) {
    throw new Error('INVALID_POINTS');
  }
  const row = await db.prepare(`
    SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version
    FROM point_rule_versions
    WHERE workspace_id = ? AND line_account_id = ? AND reason_code = ?
  `).bind(input.workspaceId, input.lineAccountId, input.reasonCode).first<any>();
  const versionNo = Number(row?.next_version || 1);
  const id = newId('pointrule');
  await db.prepare(`
    INSERT INTO point_rule_versions (
      id, workspace_id, line_account_id, reason_code, points,
      version_no, effective_from, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
  `).bind(
    id,
    input.workspaceId,
    input.lineAccountId,
    input.reasonCode,
    input.points,
    versionNo,
    input.createdByUserId,
  ).run();
  return { id, reasonCode: input.reasonCode, points: input.points, versionNo };
}

export async function getMemberPoints(
  db: D1Database,
  input: Scoped & { memberId: string; period: '7d' | '30d' },
) {
  const days = input.period === '7d' ? 7 : 30;
  const account = await db.prepare(`
    SELECT id FROM member_point_accounts
    WHERE workspace_id = ? AND line_account_id = ? AND member_id = ?
    LIMIT 1
  `).bind(input.workspaceId, input.lineAccountId, input.memberId).first<any>();
  if (!account?.id) {
    return { balance: 0, creditedPoints: 0, debitedPoints: 0, trend: [], reasonBreakdown: [], recentHistory: [] };
  }

  const accountId = String(account.id);
  const totals = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN points ELSE 0 END),0) AS credits,
      COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' THEN points ELSE 0 END),0) AS debits
    FROM member_point_ledger_entries
    WHERE workspace_id = ? AND line_account_id = ? AND point_account_id = ?
  `).bind(input.workspaceId, input.lineAccountId, accountId).first<any>();

  const trend = await db.prepare(`
    SELECT substr(effective_at,1,10) AS date,
      SUM(CASE WHEN entry_type = 'CREDIT' THEN points ELSE 0 END) AS creditedPoints,
      SUM(CASE WHEN entry_type = 'DEBIT' THEN points ELSE 0 END) AS debitedPoints
    FROM member_point_ledger_entries
    WHERE workspace_id = ? AND line_account_id = ? AND point_account_id = ?
      AND effective_at >= datetime('now', ?)
    GROUP BY substr(effective_at,1,10)
    ORDER BY date ASC
  `).bind(input.workspaceId, input.lineAccountId, accountId, `-${days} days`).all<any>();

  const reasonBreakdown = await db.prepare(`
    SELECT reason_code AS reasonCode,
      SUM(CASE WHEN entry_type = 'CREDIT' THEN points ELSE 0 END) AS creditedPoints,
      SUM(CASE WHEN entry_type = 'DEBIT' THEN points ELSE 0 END) AS debitedPoints,
      COUNT(*) AS entryCount
    FROM member_point_ledger_entries
    WHERE workspace_id = ? AND line_account_id = ? AND point_account_id = ?
      AND effective_at >= datetime('now', ?)
    GROUP BY reason_code
    ORDER BY reason_code ASC
  `).bind(input.workspaceId, input.lineAccountId, accountId, `-${days} days`).all<any>();

  const recentHistory = await db.prepare(`
    SELECT entry_type AS direction, points, reason_code AS reasonCode, effective_at AS effectiveAt
    FROM member_point_ledger_entries
    WHERE workspace_id = ? AND line_account_id = ? AND point_account_id = ?
    ORDER BY effective_at DESC, created_at DESC
    LIMIT 50
  `).bind(input.workspaceId, input.lineAccountId, accountId).all<any>();

  const credits = Number(totals?.credits || 0);
  const debits = Number(totals?.debits || 0);
  return {
    balance: credits - debits,
    creditedPoints: credits,
    debitedPoints: debits,
    trend: trend.results || [],
    reasonBreakdown: reasonBreakdown.results || [],
    recentHistory: recentHistory.results || [],
  };
}

export async function getTenantPointsSummary(
  db: D1Database,
  input: Scoped & { period: '7d' | '30d' },
) {
  const days = input.period === '7d' ? 7 : 30;
  const totals = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN e.entry_type = 'CREDIT' THEN e.points ELSE 0 END),0) AS totalCredits,
      COUNT(DISTINCT e.point_account_id) AS memberCount
    FROM member_point_ledger_entries e
    WHERE e.workspace_id = ? AND e.line_account_id = ?
      AND e.effective_at >= datetime('now', ?)
  `).bind(input.workspaceId, input.lineAccountId, `-${days} days`).first<any>();

  const trend = await db.prepare(`
    SELECT substr(effective_at,1,10) AS date,
      SUM(CASE WHEN entry_type = 'CREDIT' THEN points ELSE 0 END) AS creditedPoints,
      COUNT(*) AS entryCount
    FROM member_point_ledger_entries
    WHERE workspace_id = ? AND line_account_id = ?
      AND effective_at >= datetime('now', ?)
    GROUP BY substr(effective_at,1,10)
    ORDER BY date ASC
  `).bind(input.workspaceId, input.lineAccountId, `-${days} days`).all<any>();

  const reasonBreakdown = await db.prepare(`
    SELECT reason_code AS reasonCode,
      SUM(CASE WHEN entry_type = 'CREDIT' THEN points ELSE 0 END) AS creditedPoints,
      COUNT(*) AS creditCount
    FROM member_point_ledger_entries
    WHERE workspace_id = ? AND line_account_id = ?
      AND entry_type = 'CREDIT' AND effective_at >= datetime('now', ?)
    GROUP BY reason_code
    ORDER BY reason_code ASC
  `).bind(input.workspaceId, input.lineAccountId, `-${days} days`).all<any>();

  return {
    totalCredits: Number(totals?.totalCredits || 0),
    memberCount: Number(totals?.memberCount || 0),
    trend: trend.results || [],
    reasonBreakdown: reasonBreakdown.results || [],
  };
}
