import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canTransitionRewardStatus,
  redeemReward,
} from '../src/points/rewards.ts';
import { createRewardHandle } from '../src/points/reward-handle.ts';

const migrationUrl = new URL('../migrations/0033_reward_redemption_foundation.sql', import.meta.url);
const sourceUrl = new URL('../src/index.ts', import.meta.url);

test('reward status transitions are deterministic and archived is terminal', () => {
  for (const [from, to] of [['DRAFT', 'ACTIVE'], ['DRAFT', 'ARCHIVED'], ['ACTIVE', 'PAUSED'], ['PAUSED', 'ACTIVE'], ['PAUSED', 'ARCHIVED']]) {
    assert.equal(canTransitionRewardStatus(from, to), true);
  }
  for (const [from, to] of [['ACTIVE', 'ARCHIVED'], ['ARCHIVED', 'ACTIVE'], ['ARCHIVED', 'PAUSED'], ['DRAFT', 'PAUSED']]) {
    assert.equal(canTransitionRewardStatus(from, to), false);
  }
});

test('0033 enforces immutable catalog snapshots and prevents overspend before a DEBIT can be committed', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  for (const required of [
    'CREATE TABLE IF NOT EXISTS point_rewards',
    'CREATE TABLE IF NOT EXISTS point_reward_versions',
    'CREATE TABLE IF NOT EXISTS point_redemptions',
    'point_redemptions_prevent_overspend',
    "RAISE(ABORT, 'INSUFFICIENT_POINTS')",
    "entry_type = 'CREDIT' THEN points ELSE -points",
    'point_reward_versions_no_update',
    'point_redemptions_no_update',
    'UNIQUE(workspace_id,line_account_id,action_ref)',
  ]) assert.equal(migration.includes(required), true);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE\s+member_point_ledger_entries|DELETE\s+FROM\s+member_point_ledger_entries|DROP TABLE)\b/im);
});

test('member reward routes use verified LIFF identity and opaque reward handles only', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  for (const route of [
    "app.get('/api/point-rewards'",
    "app.post('/api/point-rewards'",
    "app.post('/api/point-rewards/:rewardId/version'",
    "app.post('/api/point-rewards/:rewardId/status'",
    "app.get('/api/point-redemptions'",
    "app.get('/api/member/rewards'",
    "app.post('/api/member/redemptions'",
    "app.get('/api/member/redemptions'",
    "app.get('/api/point-rules'",
    "app.post('/api/point-rules'",
    "app.get('/api/points-summary'",
    "app.get('/api/member/points'",
  ]) assert.equal(source.includes(route), true);
  const memberSlice = source.slice(source.indexOf("app.get('/api/member/rewards'"), source.indexOf('export default app;'));
  assert.match(memberSlice, /verifiedReferralMember/);
  assert.match(memberSlice, /rewardHandle/);
  assert.match(memberSlice, /listMemberRewards/);
  assert.match(memberSlice, /redeemReward/);
  assert.match(memberSlice, /listMemberRedemptions/);
  assert.doesNotMatch(memberSlice, /body\.memberId|body\.pointAccountId|body\.pointsCost|body\.rewardId/);
});

test('reward handles are opaque, scoped, and not a serialized internal identifier', async () => {
  const secret = 'reward-handle-test-secret';
  const handle = await createRewardHandle(secret, {
    workspaceId: 'workspace_internal', lineAccountId: 'account_internal', memberId: 'member_internal', rewardId: 'reward_internal', rewardVersionId: 'version_internal',
  });
  for (const raw of ['workspace_internal', 'account_internal', 'member_internal', 'reward_internal', 'version_internal', secret]) assert.equal(handle.includes(raw), false);
  assert.match(handle, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
});

function concurrentRedemptionDb() {
  const state = { balance: 100, redemptions: [], debits: [], busy: Promise.resolve() };
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind(...next) { return statement(sql, next); },
    async first() {
      if (sql.includes('FROM point_redemptions')) return null;
      if (sql.includes('FROM member_point_accounts')) return { id: 'account_1' };
      return null;
    },
    async all() {
      if (sql.includes('FROM point_rewards r')) return { results: [{ reward_id: 'reward_1', reward_version_id: 'version_1', name: 'Reward', description: '', points_cost: 80 }] };
      return { results: [] };
    },
  });
  return {
    state,
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      let unlock;
      const previous = state.busy;
      state.busy = new Promise(resolve => { unlock = resolve; });
      await previous;
      try {
        const redemption = statements.find(item => item.sql.includes('INSERT INTO point_redemptions'));
        const debit = statements.find(item => item.sql.includes("'DEBIT'"));
        const cost = Number(redemption.args[6]);
        if (state.balance < cost) throw new Error('INSUFFICIENT_POINTS');
        state.redemptions.push(redemption.args[0]);
        state.debits.push(Number(debit.args[4]));
        state.balance -= Number(debit.args[4]);
        return [];
      } finally { unlock(); }
    },
  };
}

test('100 point concurrent 80/80 redemption invokes one atomic batch only; the second is insufficient', async () => {
  const db = concurrentRedemptionDb();
  const scope = { workspaceId: 'ws_1', lineAccountId: 'line_1', memberId: 'member_1' };
  const secret = 'atomic-redemption-test-secret';
  const create = () => createRewardHandle(secret, { ...scope, rewardId: 'reward_1', rewardVersionId: 'version_1' });
  const [firstHandle, secondHandle] = await Promise.all([create(), create()]);
  const outcomes = await Promise.allSettled([
    redeemReward(db, { ...scope, secret, rewardHandle: firstHandle }),
    redeemReward(db, { ...scope, secret, rewardHandle: secondHandle }),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled' && result.value.code === 'REDEEMED').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected' && String(result.reason?.message).includes('INSUFFICIENT_POINTS')).length, 1);
  assert.equal(db.state.balance >= 0, true);
  assert.deepEqual(db.state.debits, [80]);
  assert.equal(db.state.redemptions.length, 1);
});
