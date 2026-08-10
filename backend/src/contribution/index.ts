export type ContributionEventType = 'QUALIFIED_REFERRAL' | 'VERIFIED_REFERRAL_CONVERSION' | 'COMPLETED_REWARD_REDEMPTION';
export type ContributionSourceType = 'REFERRAL_ATTRIBUTION' | 'CONVERSION_REFERRAL_EVIDENCE' | 'POINT_REDEMPTION';

type Scope = { workspaceId: string; lineAccountId: string };
const TIER_ORDER = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'] as const;
export type TierCode = typeof TIER_ORDER[number];
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function validPositive(value: number) { return Number.isSafeInteger(value) && value > 0 && value <= 100000000; }
function tierRank(code: string) { return TIER_ORDER.indexOf(code as TierCode); }
function dayPeriod(period?: string) { return period === '30d' ? '30d' as const : '7d' as const; }

type Source = Scope & { memberId: string; sourceType: ContributionSourceType; sourceRef: string; effectiveAt: string };

async function trustedSource(db: D1Database, scope: Scope, eventType: ContributionEventType, sourceRef: string): Promise<Source | null> {
  if (eventType === 'QUALIFIED_REFERRAL') {
    const row = await db.prepare(`SELECT id,inviter_member_id AS member_id,qualified_at FROM member_referral_attributions WHERE id=? AND workspace_id=? AND line_account_id=? AND status='qualified' AND qualified_at IS NOT NULL LIMIT 1`).bind(sourceRef, scope.workspaceId, scope.lineAccountId).first<any>();
    return row ? { ...scope, memberId: String(row.member_id), sourceType: 'REFERRAL_ATTRIBUTION', sourceRef: String(row.id), effectiveAt: String(row.qualified_at) } : null;
  }
  if (eventType === 'VERIFIED_REFERRAL_CONVERSION') {
    const row = await db.prepare(`SELECT e.id,a.inviter_member_id AS member_id,c.occurred_at FROM conversion_referral_evidence e JOIN member_referral_attributions a ON a.id=e.member_referral_attribution_id AND a.workspace_id=e.workspace_id AND a.line_account_id=e.line_account_id JOIN line_conversion_events c ON c.id=e.conversion_event_id AND c.workspace_id=e.workspace_id AND c.line_account_id=e.line_account_id WHERE e.id=? AND e.workspace_id=? AND e.line_account_id=? AND e.evidence_type='SERVER_CONTEXT' AND a.status='qualified' LIMIT 1`).bind(sourceRef, scope.workspaceId, scope.lineAccountId).first<any>();
    return row ? { ...scope, memberId: String(row.member_id), sourceType: 'CONVERSION_REFERRAL_EVIDENCE', sourceRef: String(row.id), effectiveAt: String(row.occurred_at) } : null;
  }
  const row = await db.prepare(`SELECT r.id,a.member_id,r.completed_at FROM point_redemptions r JOIN member_point_accounts a ON a.id=r.point_account_id AND a.workspace_id=r.workspace_id AND a.line_account_id=r.line_account_id WHERE r.id=? AND r.workspace_id=? AND r.line_account_id=? AND r.status='COMPLETED' LIMIT 1`).bind(sourceRef, scope.workspaceId, scope.lineAccountId).first<any>();
  return row ? { ...scope, memberId: String(row.member_id), sourceType: 'POINT_REDEMPTION', sourceRef: String(row.id), effectiveAt: String(row.completed_at) } : null;
}

async function currentRuleAt(db: D1Database, scope: Scope, eventType: ContributionEventType, at: string) {
  return db.prepare(`SELECT id,score_delta,version_no FROM contribution_rule_versions WHERE workspace_id=? AND line_account_id=? AND event_type=? AND effective_from<=? ORDER BY effective_from DESC,version_no DESC LIMIT 1`).bind(scope.workspaceId, scope.lineAccountId, eventType, at).first<any>();
}

async function latestTierRules(db: D1Database, scope: Scope, at = new Date().toISOString()) {
  const rows = (await db.prepare(`SELECT r.tier_code,r.tier_name,r.min_contribution_score,r.version_no,r.effective_from FROM member_tier_rule_versions r JOIN (SELECT tier_code,MAX(version_no) version_no FROM member_tier_rule_versions WHERE workspace_id=? AND line_account_id=? AND effective_from<=? GROUP BY tier_code) latest ON latest.tier_code=r.tier_code AND latest.version_no=r.version_no WHERE r.workspace_id=? AND r.line_account_id=? ORDER BY r.min_contribution_score ASC,CASE r.tier_code WHEN 'BRONZE' THEN 1 WHEN 'SILVER' THEN 2 WHEN 'GOLD' THEN 3 WHEN 'PLATINUM' THEN 4 END ASC`).bind(scope.workspaceId,scope.lineAccountId,at,scope.workspaceId,scope.lineAccountId).all<any>()).results || [];
  return rows.map((row: any) => ({ tierCode: String(row.tier_code) as TierCode, tierName: String(row.tier_name), minContributionScore: Number(row.min_contribution_score), versionNo: Number(row.version_no), effectiveFrom: String(row.effective_from) }));
}

export async function contributionScore(db: D1Database, scope: Scope & { memberId: string }) {
  const row = await db.prepare(`SELECT COALESCE(SUM(score_delta),0) total FROM member_contribution_events WHERE workspace_id=? AND line_account_id=? AND member_id=?`).bind(scope.workspaceId,scope.lineAccountId,scope.memberId).first<any>();
  return Number(row?.total || 0);
}

async function recordTierQualification(db: D1Database, scope: Scope & { memberId: string; score: number; at: string }) {
  const rules = await latestTierRules(db, scope, scope.at);
  const eligible = rules.filter(rule => scope.score >= rule.minContributionScore).at(-1);
  if (!eligible) return null;
  const existing = await db.prepare(`SELECT id FROM member_tier_qualification_events WHERE workspace_id=? AND line_account_id=? AND member_id=? AND tier_code=? AND rule_version_snapshot=? LIMIT 1`).bind(scope.workspaceId,scope.lineAccountId,scope.memberId,eligible.tierCode,eligible.versionNo).first<any>();
  if (!existing) await db.prepare(`INSERT INTO member_tier_qualification_events(id,workspace_id,line_account_id,member_id,tier_code,contribution_score_snapshot,rule_version_snapshot,qualified_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id('tierq'),scope.workspaceId,scope.lineAccountId,scope.memberId,eligible.tierCode,scope.score,eligible.versionNo,scope.at).run();
  return eligible;
}

export async function recordContributionForTrustedSource(db: D1Database, input: Scope & { eventType: ContributionEventType; sourceRef: string }) {
  const source = await trustedSource(db,input,input.eventType,input.sourceRef);
  if (!source) return { ok: false as const, code: 'SOURCE_NOT_FOUND' as const };
  const exists = await db.prepare(`SELECT score_delta FROM member_contribution_events WHERE workspace_id=? AND line_account_id=? AND source_type=? AND source_ref=? LIMIT 1`).bind(input.workspaceId,input.lineAccountId,source.sourceType,source.sourceRef).first<any>();
  if (exists) return { ok: true as const, code: 'ALREADY_RECORDED' as const, scoreDelta: Number(exists.score_delta) };
  const rule = await currentRuleAt(db,input,input.eventType,source.effectiveAt);
  if (!rule) return { ok: false as const, code: 'NO_CONTRIBUTION_RULE' as const };
  const scoreDelta = Number(rule.score_delta);
  if (!validPositive(scoreDelta)) throw new Error('INVALID_CONTRIBUTION_RULE');
  try {
    await db.prepare(`INSERT INTO member_contribution_events(id,workspace_id,line_account_id,member_id,event_type,score_delta,source_type,source_ref,effective_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id('contrib'),input.workspaceId,input.lineAccountId,source.memberId,input.eventType,scoreDelta,source.sourceType,source.sourceRef,source.effectiveAt).run();
  } catch (error) {
    const duplicate = await db.prepare(`SELECT score_delta FROM member_contribution_events WHERE workspace_id=? AND line_account_id=? AND source_type=? AND source_ref=? LIMIT 1`).bind(input.workspaceId,input.lineAccountId,source.sourceType,source.sourceRef).first<any>();
    if (duplicate) return { ok: true as const, code: 'ALREADY_RECORDED' as const, scoreDelta: Number(duplicate.score_delta) };
    throw error;
  }
  const score = await contributionScore(db,{...input,memberId:source.memberId});
  await recordTierQualification(db,{...input,memberId:source.memberId,score,at:source.effectiveAt});
  return { ok: true as const, code: 'RECORDED' as const, scoreDelta };
}

export async function createContributionRuleVersion(db: D1Database, input: Scope & { eventType: ContributionEventType; scoreDelta: number; createdByUserId: string }) {
  if (!validPositive(input.scoreDelta)) throw new Error('INVALID_SCORE_DELTA');
  const row = await db.prepare(`SELECT COALESCE(MAX(version_no),0)+1 next_version FROM contribution_rule_versions WHERE workspace_id=? AND line_account_id=? AND event_type=?`).bind(input.workspaceId,input.lineAccountId,input.eventType).first<any>();
  const versionNo = Number(row?.next_version || 1);
  await db.prepare(`INSERT INTO contribution_rule_versions(id,workspace_id,line_account_id,event_type,score_delta,version_no,effective_from,created_by_user_id) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`).bind(id('contribrule'),input.workspaceId,input.lineAccountId,input.eventType,input.scoreDelta,versionNo,input.createdByUserId).run();
  return { eventType: input.eventType, scoreDelta: input.scoreDelta, versionNo };
}

export async function createTierRuleVersion(db: D1Database, input: Scope & { tierCode: TierCode; tierName: string; minContributionScore: number; createdByUserId: string }) {
  if (!TIER_ORDER.includes(input.tierCode) || !Number.isSafeInteger(input.minContributionScore) || input.minContributionScore < 0 || input.minContributionScore > 100000000 || !input.tierName.trim()) throw new Error('INVALID_TIER_RULE');
  const rules = await latestTierRules(db,input);
  for (const rule of rules) {
    if (rule.tierCode === input.tierCode) continue;
    if (rule.minContributionScore === input.minContributionScore) throw new Error('TIER_THRESHOLD_AMBIGUOUS');
    if ((tierRank(rule.tierCode) < tierRank(input.tierCode) && rule.minContributionScore > input.minContributionScore) || (tierRank(rule.tierCode) > tierRank(input.tierCode) && rule.minContributionScore < input.minContributionScore)) throw new Error('TIER_THRESHOLD_ORDER_INVALID');
  }
  const row = await db.prepare(`SELECT COALESCE(MAX(version_no),0)+1 next_version FROM member_tier_rule_versions WHERE workspace_id=? AND line_account_id=? AND tier_code=?`).bind(input.workspaceId,input.lineAccountId,input.tierCode).first<any>();
  const versionNo = Number(row?.next_version || 1);
  await db.prepare(`INSERT INTO member_tier_rule_versions(id,workspace_id,line_account_id,tier_code,tier_name,min_contribution_score,version_no,effective_from,created_by_user_id) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`).bind(id('tierrule'),input.workspaceId,input.lineAccountId,input.tierCode,input.tierName.trim(),input.minContributionScore,versionNo,input.createdByUserId).run();
  return { tierCode: input.tierCode, tierName: input.tierName.trim(), minContributionScore: input.minContributionScore, versionNo };
}

export async function memberContributionRead(db: D1Database, input: Scope & { memberId: string; period?: string }) {
  const period = dayPeriod(input.period), days = period === '30d' ? 30 : 7;
  const score = await contributionScore(db,input);
  const currentRules = await latestTierRules(db,input);
  const history = (await db.prepare(`SELECT event_type AS eventType,score_delta AS scoreDelta,effective_at AS effectiveAt FROM member_contribution_events WHERE workspace_id=? AND line_account_id=? AND member_id=? ORDER BY effective_at DESC,created_at DESC LIMIT 50`).bind(input.workspaceId,input.lineAccountId,input.memberId).all<any>()).results || [];
  const breakdown = (await db.prepare(`SELECT event_type AS eventType,SUM(score_delta) AS scoreDelta,COUNT(*) AS eventCount FROM member_contribution_events WHERE workspace_id=? AND line_account_id=? AND member_id=? AND effective_at>=datetime('now',?) GROUP BY event_type ORDER BY event_type ASC`).bind(input.workspaceId,input.lineAccountId,input.memberId,`-${days} days`).all<any>()).results || [];
  const historical = (await db.prepare(`SELECT tier_code AS tierCode,contribution_score_snapshot AS contributionScoreSnapshot,rule_version_snapshot AS ruleVersionSnapshot,qualified_at AS qualifiedAt FROM member_tier_qualification_events WHERE workspace_id=? AND line_account_id=? AND member_id=? ORDER BY CASE tier_code WHEN 'BRONZE' THEN 1 WHEN 'SILVER' THEN 2 WHEN 'GOLD' THEN 3 WHEN 'PLATINUM' THEN 4 END DESC,qualified_at DESC LIMIT 1`).bind(input.workspaceId,input.lineAccountId,input.memberId).first<any>());
  const deterministic = currentRules.filter(rule => score >= rule.minContributionScore).at(-1) || null;
  const historicalRank = historical ? tierRank(String(historical.tierCode)) : -1;
  const currentRank = deterministic ? tierRank(deterministic.tierCode) : -1;
  const currentTier = historicalRank >= currentRank && historical ? { tierCode: String(historical.tierCode), tierName: String(historical.tierCode), historical: true } : deterministic ? { tierCode: deterministic.tierCode, tierName: deterministic.tierName, historical: false } : null;
  const nextTier = currentRules.find(rule => rule.minContributionScore > score) || null;
  return { period, contributionScore: score, currentTier: currentTier || { tierCode: 'NO_TIER', tierName: 'NO_TIER', historical: false }, nextTier: nextTier ? { tierCode: nextTier.tierCode, tierName: nextTier.tierName, scoreToNextTier: nextTier.minContributionScore - score } : null, eventTypeBreakdown: breakdown.map((r:any)=>({eventType:String(r.eventType),scoreDelta:Number(r.scoreDelta),eventCount:Number(r.eventCount)})), recentHistory: history.map((r:any)=>({eventType:String(r.eventType),scoreDelta:Number(r.scoreDelta),effectiveAt:r.effectiveAt})) };
}

export async function tenantContributionSummary(db: D1Database, input: Scope & { period?: string }) {
  const period = dayPeriod(input.period), days = period === '30d' ? 30 : 7;
  const totals = await db.prepare(`SELECT COALESCE(SUM(score_delta),0) total,COUNT(*) event_count,COUNT(DISTINCT member_id) member_count FROM member_contribution_events WHERE workspace_id=? AND line_account_id=? AND effective_at>=datetime('now',?)`).bind(input.workspaceId,input.lineAccountId,`-${days} days`).first<any>();
  const trend = (await db.prepare(`SELECT substr(effective_at,1,10) date,SUM(score_delta) contributionScore,COUNT(*) eventCount FROM member_contribution_events WHERE workspace_id=? AND line_account_id=? AND effective_at>=datetime('now',?) GROUP BY substr(effective_at,1,10) ORDER BY date ASC`).bind(input.workspaceId,input.lineAccountId,`-${days} days`).all<any>()).results || [];
  const eventTypeBreakdown = (await db.prepare(`SELECT event_type eventType,SUM(score_delta) contributionScore,COUNT(*) eventCount FROM member_contribution_events WHERE workspace_id=? AND line_account_id=? AND effective_at>=datetime('now',?) GROUP BY event_type ORDER BY event_type ASC`).bind(input.workspaceId,input.lineAccountId,`-${days} days`).all<any>()).results || [];
  const tierDistribution = (await db.prepare(`SELECT tier_code tierCode,COUNT(DISTINCT member_id) memberCount FROM member_tier_qualification_events WHERE workspace_id=? AND line_account_id=? GROUP BY tier_code ORDER BY CASE tier_code WHEN 'BRONZE' THEN 1 WHEN 'SILVER' THEN 2 WHEN 'GOLD' THEN 3 WHEN 'PLATINUM' THEN 4 END`).bind(input.workspaceId,input.lineAccountId).all<any>()).results || [];
  return { period,totalContributionScore:Number(totals?.total||0),contributionEventCount:Number(totals?.event_count||0),contributingMemberCount:Number(totals?.member_count||0),dailyTrend:trend,eventTypeBreakdown,tierDistribution };
}

export function isContributionEventType(value: string): value is ContributionEventType { return ['QUALIFIED_REFERRAL','VERIFIED_REFERRAL_CONVERSION','COMPLETED_REWARD_REDEMPTION'].includes(value); }
export function isTierCode(value: string): value is TierCode { return TIER_ORDER.includes(value as TierCode); }
