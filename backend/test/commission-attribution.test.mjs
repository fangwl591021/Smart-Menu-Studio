import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { establishCommissionAttribution, evaluateCommissionAttribution, isWithinAttributionWindow, resolveEffectiveStatusAt } from '../src/commission/attribution.ts';

const workspaceId = 'ws_a';
const lineAccountId = 'la_a';
const conversionAt = '2026-08-10T12:00:00.000Z';
const baseEvidence = { evidence_id: 'evidence_1', conversion_event_id: 'conversion_1', member_referral_attribution_id: 'referral_1', conversion_at: conversionAt, inviter_member_id: 'member_inviter', invitee_member_id: 'member_invitee', qualified_at: '2026-08-01T12:00:00.000Z', referral_status: 'qualified' };
const activeProgramEvents = [{ to_status: 'DRAFT', created_at: '2026-08-01T00:00:00.000Z' }, { to_status: 'ACTIVE', created_at: '2026-08-05T00:00:00.000Z' }];
const activeDealerEvents = [{ to_status: 'PENDING', created_at: '2026-08-01T00:00:00.000Z' }, { to_status: 'ACTIVE', created_at: '2026-08-05T00:00:00.000Z' }];
const eligibleEvents = [{ to_status: 'ELIGIBLE', created_at: '2026-08-05T00:00:00.000Z' }];

function commissionDb(overrides = {}) {
  const config = { existing: null, evidence: baseEvidence, programs: [{ id: 'program_1', attribution_window_days: 30 }], programEvents: activeProgramEvents, dealer: { id: 'dealer_1' }, dealerEvents: activeDealerEvents, eligibility: { id: 'eligibility_1' }, eligibilityEvents: eligibleEvents, insertChanges: 1, ...overrides };
  return {
    prepare(sql) {
      return { bind(...args) { return {
        async first() {
          if (sql.includes('FROM commission_attributions')) return config.existing;
          if (sql.includes('FROM conversion_referral_evidence')) return config.evidence;
          if (sql.includes('FROM line_oa_dealers')) return config.dealer;
          if (sql.includes('FROM commission_program_dealers')) return config.eligibility;
          return null;
        },
        async all() {
          if (sql.includes('FROM commission_programs')) return { results: config.programs };
          if (sql.includes('FROM commission_program_status_events')) return { results: config.programEvents };
          if (sql.includes('FROM dealer_status_events')) return { results: config.dealerEvents };
          if (sql.includes('FROM commission_program_dealer_status_events')) return { results: config.eligibilityEvents };
          return { results: [] };
        },
        async run() { return { meta: { changes: config.insertChanges }, args }; },
      }; } };
    },
  };
}

test('historical state resolver uses only append-only events at or before conversion', () => {
  const events = [{ to_status: 'DRAFT', created_at: '2026-08-01T00:00:00.000Z' }, { to_status: 'ACTIVE', created_at: '2026-08-05T00:00:00.000Z' }, { to_status: 'PAUSED', created_at: '2026-08-11T00:00:00.000Z' }];
  assert.equal(resolveEffectiveStatusAt(events, conversionAt), 'ACTIVE');
  assert.equal(resolveEffectiveStatusAt([{ to_status: 'ACTIVE', created_at: '2026-08-11T00:00:00.000Z' }], conversionAt), null);
  assert.equal(resolveEffectiveStatusAt([], conversionAt), null);
});

test('attribution window is inclusive and never allows a conversion before qualification', () => {
  assert.equal(isWithinAttributionWindow('2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z', 30), true);
  assert.equal(isWithinAttributionWindow('2026-08-01T12:00:00.000Z', '2026-08-31T12:00:00.000Z', 30), true);
  assert.equal(isWithinAttributionWindow('2026-08-01T12:00:00.000Z', '2026-08-31T12:00:00.001Z', 30), false);
  assert.equal(isWithinAttributionWindow('2026-08-01T12:00:00.000Z', '2026-08-01T11:59:59.999Z', 30), false);
});

test('deterministic evidence chain accepts only historically active and eligible participants', async () => {
  const input = { workspaceId, lineAccountId, conversionReferralEvidenceId: 'evidence_1' };
  assert.equal((await evaluateCommissionAttribution(commissionDb(), input)).reason, 'ATTRIBUTED');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ evidence: null }), input)).reason, 'NOT_ATTRIBUTABLE');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ programEvents: [{ to_status: 'DRAFT', created_at: '2026-08-01T00:00:00.000Z' }] }), input)).reason, 'PROGRAM_NOT_ACTIVE');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ programEvents: [{ to_status: 'ACTIVE', created_at: '2026-08-11T00:00:00.000Z' }] }), input)).reason, 'PROGRAM_NOT_ACTIVE');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ programs: [{ id: 'program_1', attribution_window_days: 30 }, { id: 'program_2', attribution_window_days: 30 }], programEvents: activeProgramEvents }), input)).reason, 'AMBIGUOUS_ACTIVE_PROGRAM');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ dealer: null }), input)).reason, 'NO_DEALER');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ dealerEvents: [{ to_status: 'SUSPENDED', created_at: '2026-08-01T00:00:00.000Z' }] }), input)).reason, 'DEALER_NOT_ACTIVE');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ dealerEvents: [{ to_status: 'ACTIVE', created_at: '2026-08-11T00:00:00.000Z' }] }), input)).reason, 'DEALER_NOT_ACTIVE');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ eligibility: null }), input)).reason, 'DEALER_NOT_ELIGIBLE');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ eligibilityEvents: [{ to_status: 'DISABLED', created_at: '2026-08-01T00:00:00.000Z' }] }), input)).reason, 'DEALER_NOT_ELIGIBLE');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ eligibilityEvents: [{ to_status: 'ELIGIBLE', created_at: '2026-08-11T00:00:00.000Z' }] }), input)).reason, 'DEALER_NOT_ELIGIBLE');
});

test('engine blocks self attribution, expired window, and returns idempotent database authority', async () => {
  const input = { workspaceId, lineAccountId, conversionReferralEvidenceId: 'evidence_1' };
  assert.equal((await evaluateCommissionAttribution(commissionDb({ evidence: { ...baseEvidence, inviter_member_id: 'member_invitee' } }), input)).reason, 'SELF_ATTRIBUTION_BLOCKED');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ evidence: { ...baseEvidence, qualified_at: '2026-06-01T12:00:00.000Z' } }), input)).reason, 'OUTSIDE_ATTRIBUTION_WINDOW');
  assert.equal((await evaluateCommissionAttribution(commissionDb({ existing: { id: 'attribution_1' } }), input)).reason, 'ALREADY_ATTRIBUTED');
  assert.equal((await establishCommissionAttribution(commissionDb({ insertChanges: 0 }), input)).reason, 'ALREADY_ATTRIBUTED');
  assert.equal((await establishCommissionAttribution(commissionDb(), input)).reason, 'ATTRIBUTED');
});

test('0027 and conversion seam are additive, evidence-only, and fail-safe', async () => {
  const [migration, source, engine] = await Promise.all([
    readFile(new URL('../migrations/0027_commission_attribution.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/commission/attribution.ts', import.meta.url), 'utf8'),
  ]);
  for (const required of ['CREATE TABLE IF NOT EXISTS commission_attributions', 'UNIQUE(conversion_event_id)', 'UNIQUE(conversion_referral_evidence_id)', "REFERRAL_EVIDENCE", 'idx_commission_attributions_scope_time']) assert.equal(migration.includes(required), true);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\b/im);
  for (const forbidden of ['commission_rate', 'commission_amount', 'percentage', 'currency', 'balance', 'payable', 'paid', 'payout', 'settlement', 'points', 'reward', 'line_identity_hash', 'access_token', 'referral_code', 'flow_token', 'token_fingerprint']) assert.equal(migration.includes(forbidden), false);
  const route = source.slice(source.indexOf("app.post('/api/intelligence/conversions'"), source.indexOf("app.get('/api/projects/:projectId/intelligence/journey'"));
  assert.match(route, /establishConversionReferralEvidence[\s\S]*\.then\(evidenceId=>\{if\(evidenceId\)return establishCommissionAttribution/);
  assert.match(route, /establishCommissionAttribution[\s\S]*\.catch\(\(\)=>\{\}\)/);
  for (const forbidden of ['member_referral_attributions SET', 'line_oa_dealers SET', 'commission_programs SET', 'commission_program_dealers SET', 'commission_rate', 'payout', 'points', 'reward']) assert.equal(route.includes(forbidden), false);
  for (const forbidden of ['raw', 'url', 'ip', 'device', 'member hash']) assert.equal(engine.includes(forbidden), false);
});
