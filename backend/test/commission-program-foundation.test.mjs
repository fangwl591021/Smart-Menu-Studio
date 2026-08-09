import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMMISSION_PROGRAM_STATUSES,
  DEALER_ELIGIBILITY_STATUSES,
  canTransitionCommissionProgramStatus,
  isAttributionWindowDays,
  isCommissionProgramStatus,
  isDealerEligibilityStatus,
  publicCommissionProgramDealerRow,
  publicCommissionProgramRow,
} from '../src/commission/program-foundation.ts';

test('commission program status machine and bounded attribution window are deterministic', () => {
  assert.deepEqual(COMMISSION_PROGRAM_STATUSES, ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
  assert.deepEqual(DEALER_ELIGIBILITY_STATUSES, ['ELIGIBLE', 'DISABLED']);
  for (const [from, to] of [['DRAFT', 'ACTIVE'], ['ACTIVE', 'PAUSED'], ['PAUSED', 'ACTIVE'], ['DRAFT', 'ARCHIVED'], ['PAUSED', 'ARCHIVED']]) assert.equal(canTransitionCommissionProgramStatus(from, to), true);
  for (const [from, to] of [['ACTIVE', 'DRAFT'], ['ACTIVE', 'ARCHIVED'], ['ARCHIVED', 'ACTIVE'], ['ARCHIVED', 'PAUSED'], ['ARCHIVED', 'DRAFT'], ['DRAFT', 'DRAFT']]) assert.equal(canTransitionCommissionProgramStatus(from, to), false);
  assert.equal(isAttributionWindowDays(1), true);
  assert.equal(isAttributionWindowDays(90), true);
  for (const value of [0, 91, 1.5, '30', null]) assert.equal(isAttributionWindowDays(value), false);
  assert.equal(isCommissionProgramStatus('ACTIVE'), true);
  assert.equal(isCommissionProgramStatus('RATE'), false);
  assert.equal(isDealerEligibilityStatus('ELIGIBLE'), true);
  assert.equal(isDealerEligibilityStatus('ACTIVE'), false);
});

test('public program and eligibility rows are privacy-safe', () => {
  const program = publicCommissionProgramRow({ id: 'program_1', name: 'Pilot', status: 'DRAFT', attribution_window_days: 30, created_at: 'created', updated_at: 'updated', member_id: 'member_private' });
  assert.deepEqual(program, { id: 'program_1', name: 'Pilot', status: 'DRAFT', attributionWindowDays: 30, createdAt: 'created', updatedAt: 'updated' });
  const dealer = publicCommissionProgramDealerRow({ dealer_id: 'dealer_1', eligibility_status: 'ELIGIBLE', dealer_status: 'ACTIVE', eligible_at: 'now', disabled_at: null, line_identity_hash: 'private_hash' }, 2);
  assert.deepEqual(dealer, { dealerId: 'dealer_1', publicSafeLabel: 'Dealer #3', eligibilityStatus: 'ELIGIBLE', dealerStatus: 'ACTIVE', eligibleAt: 'now', disabledAt: null });
  assert.equal(JSON.stringify({ program, dealer }).includes('member_private'), false);
  assert.equal(JSON.stringify({ program, dealer }).includes('private_hash'), false);
});

test('0026 is an additive program and eligibility-only migration with database single-active authority', async () => {
  const migration = await readFile(new URL('../migrations/0026_commission_program_foundation.sql', import.meta.url), 'utf8');
  for (const required of ['CREATE TABLE IF NOT EXISTS commission_programs', 'CREATE TABLE IF NOT EXISTS commission_program_status_events', 'CREATE TABLE IF NOT EXISTS commission_program_dealers', 'CREATE TABLE IF NOT EXISTS commission_program_dealer_status_events', "CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED'))", 'attribution_window_days >= 1 AND attribution_window_days <= 90', "idx_commission_programs_one_active_per_account ON commission_programs(workspace_id,line_account_id) WHERE status='ACTIVE'", 'UNIQUE(program_id,dealer_id)', 'idx_commission_program_status_events_program_time', 'idx_commission_program_dealer_status_events_time']) assert.match(migration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\b/im);
  for (const forbidden of ['commission_rate', 'commission_amount', 'percentage', 'fixed_amount', 'currency', 'balance', 'payable', 'paid', 'settlement', 'payout', 'points', 'reward', 'line_identity_hash', 'access_token', 'referral_code', 'flow_token']) assert.equal(migration.includes(forbidden), false);
});

test('tenant program routes preserve authorization, scope, idempotency, and existing-domain boundaries', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  for (const route of ["app.get('/api/commission-programs'", "app.post('/api/commission-programs'", "app.post('/api/commission-programs/:programId/status'", "app.get('/api/commission-programs/:programId/dealers'", "app.post('/api/commission-programs/:programId/dealers'", "app.post('/api/commission-programs/:programId/dealers/:dealerId/status'"]) assert.equal(source.includes(route), true);
  assert.match(source, /requireRole\(c,'admin'\)/);
  assert.match(source, /workspace_id=\? AND line_account_id=\?/);
  assert.match(source, /DEALER_NOT_ACTIVE/);
  assert.match(source, /ACTIVE_PROGRAM_EXISTS/);
  assert.match(source, /program\.status===next.*idempotent:true/);
  assert.match(source, /eligibility\.status===next.*idempotent:true/);
  const slice = source.slice(source.indexOf("app.get('/api/commission-programs'"), source.indexOf("app.get('/api/commission-attributions'"));
  for (const forbidden of ['member_referral_attributions', 'conversion_referral_evidence', 'conversion_referral_contexts', 'commission_attributions', 'commission_rate', 'commission_amount', 'currency', 'payout', 'points', 'reward', 'line_identity_hash', 'liffAccessToken', 'referralFlowToken']) assert.equal(slice.includes(forbidden), false);
  assert.equal(source.includes("UPDATE line_oa_dealers SET status"), true);
  assert.equal(slice.includes('UPDATE line_oa_dealers SET status'), false);
});
