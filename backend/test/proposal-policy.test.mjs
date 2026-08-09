import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  OPERATION_POLICIES,
  OPERATION_POLICY_VERSION,
  buildExecutionPreflight,
  evaluateOperationPolicy,
  policyAuditMetadata,
  publicPolicySummary,
} from '../src/guide/proposals/policy.ts';

const proposal = (proposalType, status = 'approved') => ({ proposalType, status });
const evaluate = (proposalType, actorRole, action, context = {}, status = 'approved') =>
  evaluateOperationPolicy({ proposal: proposal(proposalType, status), actorRole, action, context });

test('P001 risk is LOW and supports typed execution and rollback', () => {
  const policy = OPERATION_POLICIES['postback-display-text'];
  assert.equal(policy.riskLevel, 'LOW');
  assert.equal(policy.executionEnabled, true);
  assert.equal(policy.rollbackSupported, true);
  assert.equal(policy.confirmation.level, 'standard');
});

test('P002 risk is MEDIUM with elevated fresh HTTPS probe policy', () => {
  const policy = OPERATION_POLICIES['https-upgrade-candidate'];
  assert.equal(policy.riskLevel, 'MEDIUM');
  assert.equal(policy.executionEnabled, true);
  assert.equal(policy.rollbackSupported, true);
  assert.deepEqual(policy.probe, { required: true, type: 'HTTPS_SAFE_PROBE', maxAgeSeconds: 1800 });
  assert.equal(policy.confirmation.level, 'elevated');
});

test('P003 and P004 are REVIEW_ONLY', () => {
  assert.equal(OPERATION_POLICIES['duplicate-message-review'].riskLevel, 'REVIEW_ONLY');
  assert.equal(OPERATION_POLICIES['duplicate-postback-review'].riskLevel, 'REVIEW_ONLY');
  assert.equal(OPERATION_POLICIES['duplicate-message-review'].executionEnabled, false);
  assert.equal(OPERATION_POLICIES['duplicate-postback-review'].executionEnabled, false);
});

test('P005 is HIGH and structural execution remains disabled', () => {
  const policy = OPERATION_POLICIES['multi-page-structure-draft'];
  assert.equal(policy.riskLevel, 'HIGH');
  assert.equal(policy.executionEnabled, false);
  assert.equal(policy.rollbackSupported, false);
  assert.equal(policy.confirmation.level, 'critical');
});

test('viewer cannot approve or execute', () => {
  assert.equal(evaluate('postback-display-text', 'viewer', 'approve', {}, 'reviewed').reasonCode, 'ROLE_NOT_ALLOWED');
  assert.equal(evaluate('postback-display-text', 'viewer', 'execute', { confirmationProvided: true }).reasonCode, 'ROLE_NOT_ALLOWED');
});

test('editor cannot approve or execute P001', () => {
  assert.equal(evaluate('postback-display-text', 'editor', 'approve', {}, 'reviewed').allowed, false);
  assert.equal(evaluate('postback-display-text', 'editor', 'execute', { confirmationProvided: true }).allowed, false);
});

test('admin can approve reviewed P001 and execute approved P001', () => {
  assert.equal(evaluate('postback-display-text', 'admin', 'approve', {}, 'reviewed').allowed, true);
  assert.equal(evaluate('postback-display-text', 'admin', 'execute', { confirmationProvided: true }).allowed, true);
});

test('owner can execute approved P001', () => {
  assert.equal(evaluate('postback-display-text', 'owner', 'execute', { confirmationProvided: true }).allowed, true);
});

test('P002 requires a fresh SAFE probe', () => {
  assert.equal(evaluate('https-upgrade-candidate', 'admin', 'execute', { confirmationProvided: true }).reasonCode, 'PROBE_REQUIRED');
  assert.equal(evaluate('https-upgrade-candidate', 'admin', 'execute', { confirmationProvided: true, probeEligibility: 'SAFE' }).allowed, true);
});

test('P002 expired probe is blocked', () => {
  assert.equal(evaluate('https-upgrade-candidate', 'owner', 'execute', { confirmationProvided: true, probeEligibility: 'EXPIRED' }).reasonCode, 'PROBE_EXPIRED');
});

test('P003 and P004 execute are blocked regardless of approved lifecycle state', () => {
  assert.equal(evaluate('duplicate-message-review', 'owner', 'execute', { confirmationProvided: true }).reasonCode, 'REVIEW_ONLY_OPERATION');
  assert.equal(evaluate('duplicate-postback-review', 'owner', 'execute', { confirmationProvided: true }).reasonCode, 'REVIEW_ONLY_OPERATION');
});

test('P005 execute is blocked as a HIGH risk unavailable operation', () => {
  assert.equal(evaluate('multi-page-structure-draft', 'owner', 'execute', { confirmationProvided: true }).reasonCode, 'HIGH_RISK_EXECUTION_DISABLED');
});

test('P001 and P002 rollback are supported for admin and owner', () => {
  assert.equal(evaluate('postback-display-text', 'admin', 'rollback', { confirmationProvided: true, rollbackAvailable: true }, 'executed').allowed, true);
  assert.equal(evaluate('https-upgrade-candidate', 'owner', 'rollback', { confirmationProvided: true, rollbackAvailable: true }, 'executed').allowed, true);
});

test('P003 rollback is unsupported', () => {
  assert.equal(evaluate('duplicate-message-review', 'owner', 'rollback', { confirmationProvided: true }, 'executed').reasonCode, 'ROLLBACK_NOT_SUPPORTED');
});

test('risk level remains independent from recommendation priority', () => {
  const highPriorityRecommendation = { priority: 'high', proposalType: 'postback-display-text' };
  assert.equal(highPriorityRecommendation.priority, 'high');
  assert.equal(OPERATION_POLICIES[highPriorityRecommendation.proposalType].riskLevel, 'LOW');
});

test('policy version is stable across all registered policies', () => {
  assert.equal(OPERATION_POLICY_VERSION, '1');
  assert.deepEqual(new Set(Object.values(OPERATION_POLICIES).map(item => item.policyVersion)), new Set(['1']));
});

test('public policy summary exposes no roles, secrets, query, or mutable AI policy input', () => {
  const summary = publicPolicySummary({
    proposal: proposal('https-upgrade-candidate'), actorRole: 'admin', probeEligibility: 'SAFE', rollbackAvailable: false,
  });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('allowedExecutionRoles'), false);
  assert.equal(/token|secret|password|business=query/i.test(serialized), false);
  assert.equal(summary.riskLevel, 'MEDIUM');
  assert.equal(summary.capabilities.canExecute, true);
});

test('unified P001 preflight omits probe check and passes all existing guards', () => {
  const preflight = buildExecutionPreflight({
    proposal: proposal('postback-display-text'), actorRole: 'admin', confirmationProvided: true,
    fingerprintMatches: true, currentStateValid: true,
  });
  assert.equal(preflight.allowed, true);
  assert.equal(preflight.checks.some(check => check.code === 'PROBE_FRESH'), false);
});

test('unified P002 preflight requires and records fresh probe', () => {
  const preflight = buildExecutionPreflight({
    proposal: proposal('https-upgrade-candidate'), actorRole: 'owner', confirmationProvided: true,
    fingerprintMatches: true, currentStateValid: true, probeEligibility: 'SAFE',
  });
  assert.equal(preflight.allowed, true);
  assert.deepEqual(preflight.checks.find(check => check.code === 'PROBE_FRESH'), { code: 'PROBE_FRESH', passed: true });
});

test('unified P005 preflight fails POLICY_EXECUTION_ALLOWED', () => {
  const preflight = buildExecutionPreflight({
    proposal: proposal('multi-page-structure-draft'), actorRole: 'owner', confirmationProvided: true,
    fingerprintMatches: true, currentStateValid: true,
  });
  assert.equal(preflight.allowed, false);
  assert.deepEqual(preflight.checks[0], { code: 'POLICY_EXECUTION_ALLOWED', passed: false });
});

test('fingerprint and current state revalidation remain required', () => {
  assert.equal(evaluate('postback-display-text', 'admin', 'execute', { confirmationProvided: true, fingerprintValid: false }).reasonCode, 'FINGERPRINT_REQUIRED');
  assert.equal(evaluate('postback-display-text', 'admin', 'execute', { confirmationProvided: true, currentStateValid: false }).reasonCode, 'CURRENT_STATE_REVALIDATION_REQUIRED');
});

test('audit metadata is deterministic and contains no sensitive source value', () => {
  const preflight = buildExecutionPreflight({
    proposal: proposal('https-upgrade-candidate'), actorRole: 'admin', confirmationProvided: true,
    fingerprintMatches: true, currentStateValid: true, probeEligibility: 'SAFE',
  });
  assert.deepEqual(policyAuditMetadata(preflight), {
    policyVersion: '1', riskLevel: 'MEDIUM', confirmationLevel: 'elevated', preflightResult: 'PASS',
    preflightChecks: 'POLICY_EXECUTION_ALLOWED:PASS,PROPOSAL_REVIEWED:PASS,PROPOSAL_APPROVED:PASS,CONFIRMATION_PRESENT:PASS,FINGERPRINT_MATCH:PASS,CURRENT_STATE_VALID:PASS,PROBE_FRESH:PASS',
  });
});

test('policy module is deterministic and never imports Gemini, D1, R2, LINE, or fetch', async () => {
  const source = await readFile(new URL('../src/guide/proposals/policy.ts', import.meta.url), 'utf8');
  for (const forbidden of ['Gemini', 'D1Database', 'smart_menu_assets', 'api.line.me', 'fetch(', 'Math.random']) {
    assert.equal(source.includes(forbidden), false);
  }
});

test('no generic public policy evaluator route is added', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('/api/policy/evaluate'), false);
});

test('review approve execute and rollback routes all consult the central policy evaluator', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  for (const routeName of ['review', 'approve', 'execute', 'rollback']) {
    const start = source.indexOf(`/proposals/:proposalId/${routeName}'`);
    const end = source.indexOf('\n});', start);
    const route = source.slice(start, end);
    assert.ok(start > 0 && end > start, `${routeName} route exists`);
    assert.match(route, /evaluateOperationPolicy/);
    assert.match(route, /assertPolicyAllowed/);
  }
  assert.match(source, /eventMetadata:\s*\{[\s\S]*policyVersion:[\s\S]*riskLevel:[\s\S]*policyResult:/);
});

test('execution and rollback audit snapshots preserve policy version risk and preflight result', async () => {
  const execution = await readFile(new URL('../src/guide/proposals/execution.ts', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../src/guide/proposals/rollback.ts', import.meta.url), 'utf8');
  const policy = await readFile(new URL('../src/guide/proposals/policy.ts', import.meta.url), 'utf8');
  assert.match(execution, /_policy: plan\.policyAudit/);
  assert.match(rollback, /_policy: plan\.policyAudit/);
  for (const field of ['policyVersion', 'riskLevel', 'preflightResult']) {
    assert.match(execution + rollback + policy, new RegExp(field));
  }
});
