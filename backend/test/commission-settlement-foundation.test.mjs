import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SETTLEMENT_ELIGIBLE_LEDGER_SQL, SETTLEMENT_STATUSES, canTransitionSettlementStatus, isSettlementStatus, isValidSettlementPeriod, publicSettlementItem, publicSettlementRow } from '../src/commission/settlement-foundation.ts';

const migrationUrl = new URL('../migrations/0029_commission_settlement_foundation.sql', import.meta.url);
const sourceUrl = new URL('../src/index.ts', import.meta.url);

test('settlement period validation and status machine are deterministic', () => {
  assert.deepEqual(SETTLEMENT_STATUSES, ['DRAFT', 'LOCKED', 'FINALIZED', 'CANCELLED']);
  assert.equal(isValidSettlementPeriod('2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'), true);
  for (const invalid of [['same', 'same'], ['2026-08-02T00:00:00.000Z', '2026-08-01T00:00:00.000Z'], ['bad', '2026-08-02T00:00:00.000Z']]) assert.equal(isValidSettlementPeriod(...invalid), false);
  for (const [from, to] of [['DRAFT', 'LOCKED'], ['DRAFT', 'CANCELLED'], ['LOCKED', 'FINALIZED'], ['LOCKED', 'CANCELLED']]) assert.equal(canTransitionSettlementStatus(from, to), true);
  for (const [from, to] of [['FINALIZED', 'DRAFT'], ['FINALIZED', 'LOCKED'], ['CANCELLED', 'DRAFT'], ['CANCELLED', 'LOCKED'], ['DRAFT', 'FINALIZED'], ['LOCKED', 'DRAFT']]) assert.equal(canTransitionSettlementStatus(from, to), false);
  assert.equal(isSettlementStatus('LOCKED'), true);
  assert.equal(isSettlementStatus('PAID'), false);
});

test('eligible ledger selection uses immutable earned truth and half-open UTC period boundaries', () => {
  assert.match(SETTLEMENT_ELIGIBLE_LEDGER_SQL, /FROM commission_ledger_entries l/);
  assert.match(SETTLEMENT_ELIGIBLE_LEDGER_SQL, /l\.entry_type='COMMISSION_EARNED'/);
  assert.match(SETTLEMENT_ELIGIBLE_LEDGER_SQL, /l\.effective_at>=\? AND l\.effective_at<\?/);
  assert.match(SETTLEMENT_ELIGIBLE_LEDGER_SQL, /l\.currency_code='TWD'/);
  assert.doesNotMatch(SETTLEMENT_ELIGIBLE_LEDGER_SQL, /created_at|dealer_status|eligibility_status|program_status/);
  assert.match(SETTLEMENT_ELIGIBLE_LEDGER_SQL, /claimed_settlement\.status IN \('LOCKED','FINALIZED'\)/);
  assert.match(SETTLEMENT_ELIGIBLE_LEDGER_SQL, /claimed_settlement\.id<>\?/);
});

test('public settlement projections keep financial integer truth and remove internal identities', () => {
  const settlement = publicSettlementRow({ id: 'internal_settlement', period_start: 'start', period_end: 'end', status: 'LOCKED', total_amount_minor: 3000, entry_count: 2, snapshot_at: 'now', member_id: 'member_hidden', line_identity_hash: 'hash_hidden' });
  const item = publicSettlementItem({ dealer_id: 'dealer_hidden', ledger_entry_id: 'ledger_hidden', program_id: 'program_hidden', program_name: 'Pilot', amount_minor: 1500, ledger_effective_at: 'when', line_identity_hash: 'hash_hidden' }, 1);
  assert.deepEqual(item, { publicSafeLabel: 'Dealer #2', programName: 'Pilot', amountMinor: 1500, currencyCode: 'TWD', ledgerEffectiveAt: 'when' });
  const encoded = JSON.stringify({ settlement, item });
  for (const hidden of ['member_hidden', 'hash_hidden', 'dealer_hidden', 'ledger_hidden', 'program_hidden']) assert.equal(encoded.includes(hidden), false);
  assert.equal(Number.isInteger(settlement.totalAmountMinor), true);
});

test('0029 is additive settlement-only schema with DB active-claim authority and append-only history', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  for (const required of ['CREATE TABLE IF NOT EXISTS commission_settlement_periods', 'CREATE TABLE IF NOT EXISTS commission_settlement_status_events', 'CREATE TABLE IF NOT EXISTS commission_settlements', 'CREATE TABLE IF NOT EXISTS commission_settlement_items', "CHECK (period_start < period_end)", "status IN ('DRAFT','LOCKED','FINALIZED','CANCELLED')", "currency_code IN ('TWD')", 'UNIQUE(settlement_id,ledger_entry_id)', 'commission_settlement_items_single_active_claim', "RAISE(ABORT,'LEDGER_ALREADY_SETTLED')", 'idx_commission_settlement_status_events_settlement_time']) assert.equal(migration.includes(required), true);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\b/im);
  for (const forbidden of ['payout_', 'withdraw', 'bank_', 'payment_', 'payable', 'paid_balance', 'percentage', 'points', 'reward', 'line_identity_hash', 'access_token', 'referral_code', 'flow_token']) assert.equal(migration.toLowerCase().includes(forbidden), false);
});

test('tenant settlement routes enforce scope, role, state, atomic snapshot construction, and no payout semantics', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  for (const route of ["app.get('/api/commission-settlements'", "app.post('/api/commission-settlements'", "app.get('/api/commission-settlements/:settlementId'", "app.post('/api/commission-settlements/:settlementId/status'"]) assert.equal(source.includes(route), true);
  const slice = source.slice(source.indexOf("app.get('/api/commission-settlements'"), source.indexOf("app.get('/api/commission-ledger'"));
  assert.match(slice, /requireRole\(c,'viewer'\)/);
  assert.match(slice, /requireRole\(c,'admin'\)/);
  assert.match(slice, /workspace_id=\? AND s\.line_account_id=\?/);
  assert.match(slice, /SETTLEMENT_PERIOD_OVERLAP/);
  assert.match(slice, /NO_ELIGIBLE_LEDGER_ENTRIES/);
  assert.match(slice, /LEDGER_ALREADY_SETTLED/);
  assert.match(slice, /c\.env\.smart_menu_db\.batch\(statements\)/);
  assert.match(slice, /commission_settlement_status_events/);
  assert.match(slice, /publicSettlementItem/);
  assert.match(slice, /idempotent:true/);
  for (const forbidden of ['commission_ledger_entries SET', 'UPDATE commission_ledger_entries', 'DELETE FROM commission_ledger_entries', 'UPDATE commission_calculations', 'DELETE FROM commission_calculations', 'UPDATE commission_attributions', 'member_referral_attributions', 'conversion_referral_evidence', 'payout', 'withdraw', 'payment', 'paid_balance', 'points', 'reward', 'lineUserId', 'line_identity_hash', 'liffAccessToken', 'referralFlowToken']) assert.equal(slice.includes(forbidden), false);
});

test('cancel releases only active claim eligibility while preserving the immutable cancelled snapshot', async () => {
  const [migration, source] = await Promise.all([readFile(migrationUrl, 'utf8'), readFile(sourceUrl, 'utf8')]);
  assert.match(migration, /existing_settlement\.status IN \('LOCKED','FINALIZED'\)/);
  assert.match(source, /const timestampColumn=next==='FINALIZED'\?'finalized_at':'cancelled_at'/);
  assert.match(source, /commission_settlement_items/);
  assert.doesNotMatch(source.slice(source.indexOf("app.get('/api/commission-settlements'"), source.indexOf("app.get('/api/commission-ledger'")), /DELETE FROM commission_settlement_items|UPDATE commission_settlement_items/);
});
