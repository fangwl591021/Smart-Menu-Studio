import { createRewardHandle, rewardHandleReference, verifyRewardHandle } from './reward-handle';

type Scoped = { workspaceId: string; lineAccountId: string };
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const safeText = (value: unknown, max = 200) => String(value ?? '').trim().slice(0, max);

export type RewardStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export function isRewardStatus(value: unknown): value is RewardStatus {
  return ['DRAFT','ACTIVE','PAUSED','ARCHIVED'].includes(String(value || '').toUpperCase());
}

export function canTransitionRewardStatus(from: RewardStatus, to: RewardStatus) {
  if (from === 'DRAFT') return to === 'ACTIVE' || to === 'ARCHIVED';
  if (from === 'ACTIVE') return to === 'PAUSED';
  if (from === 'PAUSED') return to === 'ACTIVE' || to === 'ARCHIVED';
  return false;
}

export async function createReward(
  db: D1Database,
  input: Scoped & { name: string; description?: string; pointsCost: number; createdByUserId: string },
) {
  if (!Number.isSafeInteger(input.pointsCost) || input.pointsCost <= 0 || input.pointsCost > 100000000) throw new Error('INVALID_REWARD_POINTS_COST');
  const name = safeText(input.name, 120);
  if (!name) throw new Error('REWARD_NAME_REQUIRED');
  const rewardId = newId('reward');
  const versionId = newId('rewardver');
  await db.batch([
    db.prepare(`INSERT INTO point_rewards (id,workspace_id,line_account_id,status,current_version_no,created_by_user_id) VALUES (?,?,?,'DRAFT',1,?)`).bind(rewardId,input.workspaceId,input.lineAccountId,input.createdByUserId),
    db.prepare(`INSERT INTO point_reward_versions (id,reward_id,version_no,name,description,points_cost,effective_from,created_by_user_id) VALUES (?,?,1,?,?,?,CURRENT_TIMESTAMP,?)`).bind(versionId,rewardId,name,safeText(input.description,1000),input.pointsCost,input.createdByUserId),
  ]);
  return { rewardId, versionNo: 1, status: 'DRAFT' as const };
}

export async function createRewardVersion(
  db: D1Database,
  input: Scoped & { rewardId: string; name: string; description?: string; pointsCost: number; createdByUserId: string },
) {
  if (!Number.isSafeInteger(input.pointsCost) || input.pointsCost <= 0 || input.pointsCost > 100000000) throw new Error('INVALID_REWARD_POINTS_COST');
  const reward = await db.prepare(`SELECT current_version_no,status FROM point_rewards WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(input.rewardId,input.workspaceId,input.lineAccountId).first<any>();
  if (!reward) throw new Error('REWARD_NOT_FOUND');
  if (String(reward.status) === 'ARCHIVED') throw new Error('REWARD_ARCHIVED');
  const nextVersion = Number(reward.current_version_no || 0) + 1;
  const versionId = newId('rewardver');
  await db.batch([
    db.prepare(`INSERT INTO point_reward_versions (id,reward_id,version_no,name,description,points_cost,effective_from,created_by_user_id) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`).bind(versionId,input.rewardId,nextVersion,safeText(input.name,120),safeText(input.description,1000),input.pointsCost,input.createdByUserId),
    db.prepare(`UPDATE point_rewards SET current_version_no=? WHERE id=? AND workspace_id=? AND line_account_id=?`).bind(nextVersion,input.rewardId,input.workspaceId,input.lineAccountId),
  ]);
  return { rewardId: input.rewardId, versionNo: nextVersion };
}

export async function transitionRewardStatus(
  db: D1Database,
  input: Scoped & { rewardId: string; toStatus: RewardStatus },
) {
  const row = await db.prepare(`SELECT status FROM point_rewards WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(input.rewardId,input.workspaceId,input.lineAccountId).first<any>();
  if (!row) throw new Error('REWARD_NOT_FOUND');
  const from = String(row.status).toUpperCase() as RewardStatus;
  if (!canTransitionRewardStatus(from,input.toStatus)) throw new Error('INVALID_REWARD_STATUS_TRANSITION');
  await db.prepare(`UPDATE point_rewards SET status=? WHERE id=? AND workspace_id=? AND line_account_id=?`).bind(input.toStatus,input.rewardId,input.workspaceId,input.lineAccountId).run();
  return { fromStatus: from, status: input.toStatus };
}

export async function listTenantRewards(db: D1Database, input: Scoped) {
  const rows = await db.prepare(`
    SELECT r.id,r.status,r.current_version_no AS currentVersionNo,v.name,v.description,v.points_cost AS pointsCost,v.effective_from AS effectiveFrom,v.created_at AS createdAt
    FROM point_rewards r
    JOIN point_reward_versions v ON v.reward_id=r.id AND v.version_no=r.current_version_no
    WHERE r.workspace_id=? AND r.line_account_id=?
    ORDER BY r.created_at DESC
  `).bind(input.workspaceId,input.lineAccountId).all<any>();
  return rows.results || [];
}

async function currentActiveRewardRows(db: D1Database, input: Scoped) {
  const rows = await db.prepare(`
    SELECT r.id AS reward_id,v.id AS reward_version_id,v.name,v.description,v.points_cost
    FROM point_rewards r
    JOIN point_reward_versions v ON v.reward_id=r.id AND v.version_no=r.current_version_no
    WHERE r.workspace_id=? AND r.line_account_id=? AND r.status='ACTIVE'
    ORDER BY r.created_at ASC,r.id ASC
  `).bind(input.workspaceId,input.lineAccountId).all<any>();
  return rows.results || [];
}

export async function listMemberRewards(
  db: D1Database,
  input: Scoped & { memberId: string; secret: string },
) {
  const rows = await currentActiveRewardRows(db,input);
  const output = [];
  for (const row of rows as any[]) {
    output.push({
      rewardHandle: await createRewardHandle(input.secret,{
        workspaceId: input.workspaceId,
        lineAccountId: input.lineAccountId,
        memberId: input.memberId,
        rewardId: String(row.reward_id),
        rewardVersionId: String(row.reward_version_id),
      }),
      name: String(row.name),
      description: String(row.description || ''),
      pointsCost: Number(row.points_cost),
      available: true,
    });
  }
  return output;
}

async function resolveRewardHandle(
  db: D1Database,
  input: Scoped & { memberId: string; secret: string; rewardHandle: string },
) {
  const verified = await verifyRewardHandle(input.secret,input.rewardHandle);
  const rows = await currentActiveRewardRows(db,input);
  for (const row of rows as any[]) {
    const reference = await rewardHandleReference(input.secret,{
      workspaceId: input.workspaceId,
      lineAccountId: input.lineAccountId,
      memberId: input.memberId,
      rewardId: String(row.reward_id),
      rewardVersionId: String(row.reward_version_id),
    });
    if (reference === verified.rewardReference) {
      return { row, actionReference: verified.actionReference };
    }
  }
  throw new Error('REWARD_NOT_AVAILABLE');
}

export async function redeemReward(
  db: D1Database,
  input: Scoped & { memberId: string; secret: string; rewardHandle: string },
) {
  const resolved = await resolveRewardHandle(db,input);
  const existing = await db.prepare(`SELECT id,points_cost_snapshot,reward_name_snapshot,completed_at FROM point_redemptions WHERE workspace_id=? AND line_account_id=? AND action_ref=? LIMIT 1`).bind(input.workspaceId,input.lineAccountId,resolved.actionReference).first<any>();
  if (existing) return { code: 'ALREADY_REDEEMED' as const, pointsCost: Number(existing.points_cost_snapshot), rewardName: String(existing.reward_name_snapshot), redeemedAt: String(existing.completed_at) };

  const account = await db.prepare(`SELECT id FROM member_point_accounts WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1`).bind(input.workspaceId,input.lineAccountId,input.memberId).first<any>();
  if (!account?.id) throw new Error('INSUFFICIENT_POINTS');

  const reward = resolved.row as any;
  const pointsCost = Number(reward.points_cost);
  if (!Number.isSafeInteger(pointsCost) || pointsCost <= 0) throw new Error('INVALID_REWARD_POINTS_COST');
  const redemptionId = newId('redemption');
  const ledgerEntryId = newId('pointentry');

  try {
    await db.batch([
      db.prepare(`
        INSERT INTO point_redemptions (
          id,workspace_id,line_account_id,point_account_id,reward_id,reward_version_id,status,
          points_cost_snapshot,reward_name_snapshot,action_ref,requested_at,completed_at
        ) VALUES (?,?,?,?,?,?,'COMPLETED',?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `).bind(redemptionId,input.workspaceId,input.lineAccountId,String(account.id),String(reward.reward_id),String(reward.reward_version_id),pointsCost,String(reward.name),resolved.actionReference),
      db.prepare(`
        INSERT INTO member_point_ledger_entries (
          id,workspace_id,line_account_id,point_account_id,entry_type,points,reason_code,source_type,source_ref,effective_at
        ) VALUES (?,?,?,?,'DEBIT',?,'REWARD_REDEMPTION','REDEMPTION',?,CURRENT_TIMESTAMP)
      `).bind(ledgerEntryId,input.workspaceId,input.lineAccountId,String(account.id),pointsCost,redemptionId),
    ]);
    return { code: 'REDEEMED' as const, pointsCost, rewardName: String(reward.name) };
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (message.includes('INSUFFICIENT_POINTS')) throw new Error('INSUFFICIENT_POINTS');
    const duplicate = await db.prepare(`SELECT points_cost_snapshot,reward_name_snapshot,completed_at FROM point_redemptions WHERE workspace_id=? AND line_account_id=? AND action_ref=? LIMIT 1`).bind(input.workspaceId,input.lineAccountId,resolved.actionReference).first<any>();
    if (duplicate) return { code: 'ALREADY_REDEEMED' as const, pointsCost: Number(duplicate.points_cost_snapshot), rewardName: String(duplicate.reward_name_snapshot), redeemedAt: String(duplicate.completed_at) };
    throw error;
  }
}

export async function listMemberRedemptions(db: D1Database, input: Scoped & { memberId: string }) {
  const account = await db.prepare(`SELECT id FROM member_point_accounts WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1`).bind(input.workspaceId,input.lineAccountId,input.memberId).first<any>();
  if (!account?.id) return [];
  const rows = await db.prepare(`
    SELECT reward_name_snapshot AS rewardName,points_cost_snapshot AS pointsCost,completed_at AS redeemedAt,status
    FROM point_redemptions
    WHERE workspace_id=? AND line_account_id=? AND point_account_id=?
    ORDER BY completed_at DESC,created_at DESC
    LIMIT 100
  `).bind(input.workspaceId,input.lineAccountId,String(account.id)).all<any>();
  return rows.results || [];
}

export async function tenantRedemptionSummary(
  db: D1Database,
  input: Scoped & { period: '7d'|'30d' },
) {
  const days = input.period === '7d' ? 7 : 30;
  const totals = await db.prepare(`SELECT COUNT(*) AS redemptionCount,COALESCE(SUM(points_cost_snapshot),0) AS redeemedPoints FROM point_redemptions WHERE workspace_id=? AND line_account_id=? AND completed_at>=datetime('now',?)`).bind(input.workspaceId,input.lineAccountId,`-${days} days`).first<any>();
  const trend = await db.prepare(`SELECT substr(completed_at,1,10) AS date,COUNT(*) AS redemptionCount,SUM(points_cost_snapshot) AS redeemedPoints FROM point_redemptions WHERE workspace_id=? AND line_account_id=? AND completed_at>=datetime('now',?) GROUP BY substr(completed_at,1,10) ORDER BY date ASC`).bind(input.workspaceId,input.lineAccountId,`-${days} days`).all<any>();
  const rewardBreakdown = await db.prepare(`SELECT reward_name_snapshot AS rewardName,COUNT(*) AS redemptionCount,SUM(points_cost_snapshot) AS redeemedPoints FROM point_redemptions WHERE workspace_id=? AND line_account_id=? AND completed_at>=datetime('now',?) GROUP BY reward_name_snapshot ORDER BY redemptionCount DESC,rewardName ASC`).bind(input.workspaceId,input.lineAccountId,`-${days} days`).all<any>();
  return { redemptionCount: Number(totals?.redemptionCount||0), redeemedPoints: Number(totals?.redeemedPoints||0), trend: trend.results||[], rewardBreakdown: rewardBreakdown.results||[] };
}
