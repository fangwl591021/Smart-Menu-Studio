import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMMISSION_CALCULATION_TYPE,
  MAX_FIXED_COMMISSION_AMOUNT_MINOR,
  calculateCommissionForAttribution,
  createCommissionRuleVersion,
  isFixedCommissionAmountMinor,
  isSupportedCommissionCurrency,
  resolveHistoricalCommissionRule,
} from '../src/commission/calculation-ledger.ts';

const scope = { workspaceId: 'ws_a', lineAccountId: 'line_a', programId: 'program_a' };
const occurredAt = '2026-08-10T12:00:00.000Z';

function ledgerDb(overrides = {}) {
  const config = {
    nextVersion: 0,
    existingCalculation: null,
    attribution: { id: 'cat_1', workspace_id: 'ws_a', line_account_id: 'line_a', program_id: 'program_a', dealer_id: 'dealer_a', conversion_at: occurredAt },
    rule: { id: 'rule_1', version_no: 1, calculation_type: 'FIXED_PER_ATTRIBUTION', fixed_amount_minor: 1250, currency_code: 'TWD', effective_from: '2026-08-01T00:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z' },
    batchCalls: [],
    ...overrides,
  };
  return {
    config,
    prepare(sql) {
      return { bind(...args) { return {
        async first() {
          if (sql.includes('COALESCE(MAX(version_no)')) return { version_no: config.nextVersion };
          if (sql.includes('FROM commission_calculations')) return config.existingCalculation;
          if (sql.includes('FROM commission_attributions ca')) return config.attribution;
          if (sql.includes('FROM commission_rule_versions')) return config.rule;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 1 }, args }; },
      }; } };
    },
    async batch(statements) { config.batchCalls.push(statements); return statements.map(() => ({ success: true, meta: { changes: 1 } })); },
  };
}

test('fixed commission rule validation accepts only positive bounded TWD integer minor units', () => {
  assert.equal(COMMISSION_CALCULATION_TYPE, 'FIXED_PER_ATTRIBUTION');
  assert.equal(isFixedCommissionAmountMinor(1), true);
  assert.equal(isFixedCommissionAmountMinor(MAX_FIXED_COMMISSION_AMOUNT_MINOR), true);
  for (const value of [0, -1, 1.25, Number.MAX_SAFE_INTEGER, MAX_FIXED_COMMISSION_AMOUNT_MINOR + 1, '1250']) assert.equal(isFixedCommissionAmountMinor(value), false);
  assert.equal(isSupportedCommissionCurrency('TWD'), true);
  for (const value of ['USD', 'twd', '', null]) assert.equal(isSupportedCommissionCurrency(value), false);
});

test('rule version creation is server-timestamped, immutable by API shape, and increments per program', async () => {
  const db = ledgerDb({ nextVersion: 2 });
  const rule = await createCommissionRuleVersion(db, { ...scope, calculationType: 'FIXED_PER_ATTRIBUTION', fixedAmountMinor: 1250, currencyCode: 'TWD', createdByUserId: 'user_a', now: occurredAt });
  assert.deepEqual(rule, { ruleVersionId: rule.ruleVersionId, versionNo: 3, calculationType: 'FIXED_PER_ATTRIBUTION', fixedAmountMinor: 1250, currencyCode: 'TWD', effectiveFrom: occurredAt, createdAt: occurredAt });
  await assert.rejects(() => createCommissionRuleVersion(db, { ...scope, calculationType: 'PERCENTAGE', fixedAmountMinor: 1250, currencyCode: 'TWD' }), /UNSUPPORTED_COMMISSION_CALCULATION_TYPE/);
  await assert.rejects(() => createCommissionRuleVersion(db, { ...scope, calculationType: 'FIXED_PER_ATTRIBUTION', fixedAmountMinor: 0, currencyCode: 'TWD' }), /INVALID_FIXED_COMMISSION_AMOUNT/);
  await assert.rejects(() => createCommissionRuleVersion(db, { ...scope, calculationType: 'FIXED_PER_ATTRIBUTION', fixedAmountMinor: 1, currencyCode: 'USD' }), /UNSUPPORTED_COMMISSION_CURRENCY/);
});

test('historical rule lookup uses conversion occurred_at and never asks the future rule to apply retroactively', async () => {
  const db = ledgerDb();
  const found = await resolveHistoricalCommissionRule(db, { ...scope, occurredAt });
  assert.equal(found.id, 'rule_1');
  const sql = await readFile(new URL('../src/commission/calculation-ledger.ts', import.meta.url), 'utf8');
  assert.match(sql, /effective_from<=\?/);
  assert.match(sql, /ORDER BY effective_from DESC,version_no DESC LIMIT 1/);
});

test('calculation snapshots a fixed rule and atomically appends exactly one earned ledger entry', async () => {
  const db = ledgerDb();
  const result = await calculateCommissionForAttribution(db, { workspaceId: 'ws_a', lineAccountId: 'line_a', commissionAttributionId: 'cat_1', now: '2026-08-11T00:00:00.000Z' });
  assert.equal(result.reason, 'CALCULATED');
  assert.equal(db.config.batchCalls.length, 1);
  assert.equal(db.config.batchCalls[0].length, 2);
  const source = await readFile(new URL('../src/commission/calculation-ledger.ts', import.meta.url), 'utf8');
  assert.match(source, /base_amount_minor,commission_amount_minor,currency_code/);
  assert.match(source, /NULL,\?,\?,\?,\?/);
  assert.match(source, /'COMMISSION_EARNED'/);
  assert.match(source, /effective_at,created_at/);
});

test('no historical rule is safe and retry never produces another calculation', async () => {
  assert.equal((await calculateCommissionForAttribution(ledgerDb({ rule: null }), { workspaceId: 'ws_a', lineAccountId: 'line_a', commissionAttributionId: 'cat_1' })).reason, 'NO_COMMISSION_RULE');
  assert.deepEqual(await calculateCommissionForAttribution(ledgerDb({ existingCalculation: { id: 'ccalc_existing' } }), { workspaceId: 'ws_a', lineAccountId: 'line_a', commissionAttributionId: 'cat_1' }), { reason: 'ALREADY_CALCULATED', calculationId: 'ccalc_existing' });
});

test('0028 is additive, immutable-ledger-only, and calculation hook is fail-safe after attribution persistence', async () => {
  const [migration, index, attribution] = await Promise.all([
    readFile(new URL('../migrations/0028_commission_calculation_ledger.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/commission/attribution.ts', import.meta.url), 'utf8'),
  ]);
  for (const required of ['CREATE TABLE IF NOT EXISTS commission_rule_versions', 'CREATE TABLE IF NOT EXISTS commission_calculations', 'CREATE TABLE IF NOT EXISTS commission_ledger_entries', "FIXED_PER_ATTRIBUTION", "COMMISSION_EARNED", 'UNIQUE(program_id, version_no)', 'UNIQUE(commission_attribution_id)', 'UNIQUE(commission_calculation_id)', 'idx_commission_rule_versions_historical']) assert.equal(migration.includes(required), true);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\b/im);
  for (const forbidden of ['percentage', 'tier', 'payout', 'settlement', 'payable', 'paid', 'points', 'reward', 'line_identity_hash', 'access_token', 'referral_code', 'flow_token']) assert.equal(migration.toLowerCase().includes(forbidden), false);
  assert.match(attribution, /INSERT INTO commission_attributions[\s\S]*calculateCommissionForAttribution[\s\S]*\.catch\(\(\) => \{\}\)/);
  assert.match(attribution, /if \(Number\(result\?\.meta\?\.changes \|\| 0\) !== 1\) \{[^]*SELECT id FROM commission_attributions[^]*calculateCommissionForAttribution[^]*return \{ reason: 'ALREADY_ATTRIBUTED'/);
  const rules = index.slice(index.indexOf("app.get('/api/commission-programs/:programId/rules'"), index.indexOf("app.post('/api/commission-programs/:programId/status'"));
  assert.match(rules, /requireRole\(c,'viewer'\)/);
  assert.match(rules, /requireRole\(c,'admin'\)/);
  assert.match(rules, /scopedCommissionProgram/);
  assert.doesNotMatch(rules, /workspaceId:/);
});
