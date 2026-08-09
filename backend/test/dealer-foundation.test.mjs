import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEALER_STATUSES, canTenantTransitionDealerStatus, dealerApplyDecision, isDealerStatus, publicDealerRow } from '../src/dealers/foundation.ts';

test('dealer statuses and deterministic member enrollment decisions are closed', () => {
  assert.deepEqual(DEALER_STATUSES, ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']);
  assert.equal(dealerApplyDecision(null), 'CREATE_PENDING');
  assert.equal(dealerApplyDecision('PENDING'), 'IDEMPOTENT');
  assert.equal(dealerApplyDecision('ACTIVE'), 'IDEMPOTENT');
  assert.equal(dealerApplyDecision('SUSPENDED'), 'SUSPENDED_BLOCKED');
  assert.equal(dealerApplyDecision('REJECTED'), 'REAPPLY_PENDING');
  assert.equal(isDealerStatus('ACTIVE'), true);
  assert.equal(isDealerStatus('memberId'), false);
});

test('tenant transitions allow only the approved dealer state machine', () => {
  for (const [from, to] of [['PENDING', 'ACTIVE'], ['PENDING', 'REJECTED'], ['ACTIVE', 'SUSPENDED'], ['SUSPENDED', 'ACTIVE']]) assert.equal(canTenantTransitionDealerStatus(from, to), true);
  for (const [from, to] of [['ACTIVE', 'PENDING'], ['SUSPENDED', 'PENDING'], ['REJECTED', 'ACTIVE'], ['PENDING', 'SUSPENDED'], ['ACTIVE', 'ACTIVE']]) assert.equal(canTenantTransitionDealerStatus(from, to), false);
});

test('public dealer rows never expose member identity data', () => {
  const result = publicDealerRow({ id: 'dealer_1', member_id: 'member_1', line_identity_hash: 'hash', status: 'PENDING', applied_at: 'now' }, 0);
  assert.deepEqual(result, { id: 'dealer_1', publicSafeLabel: 'Dealer #1', status: 'PENDING', appliedAt: 'now', approvedAt: null, suspendedAt: null, rejectedAt: null, createdAt: null, updatedAt: null });
  assert.equal(JSON.stringify(result).includes('member_1'), false);
  assert.equal(JSON.stringify(result).includes('hash'), false);
});

test('0024 migration is additive dealer-only storage with scope and append-only indexes', async () => {
  const migration = await readFile(new URL('../migrations/0024_dealer_foundation.sql', import.meta.url), 'utf8');
  for (const required of ['CREATE TABLE IF NOT EXISTS line_oa_dealers', 'CREATE TABLE IF NOT EXISTS dealer_status_events', 'idx_line_oa_dealer_member', 'idx_line_oa_dealer_status', 'idx_dealer_status_events_dealer_time', 'idx_dealer_status_events_workspace_time']) assert.match(migration, new RegExp(required));
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_line_oa_dealer_member ON line_oa_dealers\(workspace_id,line_account_id,member_id\)/);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\b/im);
  for (const forbidden of ['line_identity_hash', 'access_token', 'liff_access_token', 'line_user_id', 'referral_code', 'flow_token', 'commission', 'currency', 'payout', 'points', 'reward']) assert.equal(migration.includes(forbidden), false);
});

test('dealer production routes use LIFF identity and tenant admin scope without referral side effects', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  for (const route of ["app.get('/api/member/dealer-status'", "app.post('/api/member/dealer/apply'", "app.get('/api/dealers'", "app.post('/api/dealers/:dealerId/status'"]) assert.equal(source.includes(route), true);
  assert.match(source, /verifiedReferralMember\(c,\{lineAccountId:text\(c\.req\.query\('lineAccountId'\)\),liffAccessToken:text\(c\.req\.header\('Authorization'\)\)/);
  assert.match(source, /requireRole\(c,'admin'\)/);
  assert.match(source, /workspace_id=\? AND line_account_id=\?/);
  const dealerSlice = source.slice(source.indexOf("app.get('/api/member/dealer-status'"), source.indexOf("app.get('/api/referral-growth'"));
  for (const forbidden of ['member_referral_identities', 'member_referral_attributions', 'member_referral_events', 'commission', 'payout', 'points', 'reward']) assert.equal(dealerSlice.includes(forbidden), false);
});
