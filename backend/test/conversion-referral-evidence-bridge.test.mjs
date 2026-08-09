import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONVERSION_REFERRAL_CONTEXT_TTL_SECONDS, conversionReferralContextFingerprint, conversionReferralContextUsable, createConversionReferralContextToken } from '../src/commission/evidence-bridge.ts';

test('opaque conversion referral context is high entropy, purpose-scoped, and fingerprint-only', async () => {
  const token = createConversionReferralContextToken();
  assert.match(token, /^smrc_[A-Za-z0-9_-]{40,}$/);
  const fingerprint = await conversionReferralContextFingerprint('member-secret', token);
  assert.notEqual(fingerprint, token);
  assert.equal(fingerprint.includes(token), false);
  await assert.rejects(() => conversionReferralContextFingerprint('member-secret', 'referral-flow-token'));
});

test('context use requires same workspace, unconsumed qualified referral evidence, and strict expiry', () => {
  const now = Date.parse('2026-08-09T12:00:00.000Z');
  const base = { workspace_id: 'w1', referral_status: 'qualified', expires_at: '2026-08-09T12:15:00.000Z', consumed_at: null };
  assert.equal(conversionReferralContextUsable(base, 'w1', now), true);
  assert.equal(conversionReferralContextUsable(base, 'w2', now), false);
  assert.equal(conversionReferralContextUsable({ ...base, consumed_at: '2026-08-09T12:01:00.000Z' }, 'w1', now), false);
  assert.equal(conversionReferralContextUsable({ ...base, referral_status: 'pending' }, 'w1', now), false);
  assert.equal(conversionReferralContextUsable({ ...base, expires_at: '2026-08-09T12:00:00.000Z' }, 'w1', now), false);
  assert.equal(CONVERSION_REFERRAL_CONTEXT_TTL_SECONDS, 900);
});

test('0025 bridge is additive, one-time, and contains no money, identity, or raw-token storage', async () => {
  const migration = await readFile(new URL('../migrations/0025_conversion_referral_evidence_bridge.sql', import.meta.url), 'utf8');
  for (const required of ['CREATE TABLE IF NOT EXISTS conversion_referral_contexts', 'CREATE TABLE IF NOT EXISTS conversion_referral_evidence', 'UNIQUE(workspace_id, token_fingerprint)', 'UNIQUE(conversion_event_id)', 'UNIQUE(context_id)', 'SERVER_CONTEXT']) assert.ok(migration.includes(required), required);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\b/im);
  for (const forbidden of ['line_identity_hash', 'line_user_id', 'access_token', 'liff_access_token', 'referral_flow', 'referral_code', 'commission', 'rate', 'amount', 'currency', 'ledger', 'balance', 'payout', 'points', 'reward', 'email', 'phone', 'ip_address']) assert.equal(migration.includes(forbidden), false);
});

test('production seams read qualified referral truth and preserve valid conversions on evidence failure', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  for (const route of ["app.post('/api/member/conversion-referral-context'", "app.post('/api/intelligence/conversions'"]) assert.ok(source.includes(route), route);
  const contextRoute = source.slice(source.indexOf("app.post('/api/member/conversion-referral-context'"));
  assert.match(contextRoute, /verifiedReferralMember/);
  assert.match(contextRoute, /issueConversionReferralContext/);
  const conversionRoute = source.slice(source.indexOf("app.post('/api/intelligence/conversions'"), source.indexOf("app.get('/api/projects/:projectId/intelligence/journey'"));
  assert.match(conversionRoute, /resolveConversionReferralContext/);
  assert.match(conversionRoute, /establishConversionReferralEvidence\([^\n]+\.catch\(\(\)=>\{\}\)/);
  assert.match(conversionRoute, /X-Smart-Menu-Conversion-Referral-Context/);
  for (const forbidden of ['member_referral_attributions SET', 'member_referral_events', 'line_oa_dealers', 'dealer_status_events', 'commission_programs', 'points', 'reward']) assert.equal(conversionRoute.includes(forbidden), false);
});
