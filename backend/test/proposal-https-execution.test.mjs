import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildHttpRestoreUrl,
  buildHttpsCandidate,
  fingerprintUrl,
  httpsProbeEligibility,
  probeHttpsUpgradeCandidate,
  sanitizeUrlForAudit,
  toPublicHttpsProbe,
} from '../src/guide/proposals/https-probe.ts';
import {
  buildOperationPlan,
  OPERATION_EXECUTORS,
  publicOperationLog,
  publicOperationPlan,
} from '../src/guide/proposals/execution.ts';
import {
  buildRollbackPlan,
  evaluateRollbackEligibility,
  publicRollbackPlan,
  ROLLBACK_EXECUTORS,
} from '../src/guide/proposals/rollback.ts';
import { evaluateRecommendations } from '../src/guide/recommendations/engine.ts';

const response = (status = 200, headers = {}) => new Response(null, { status, headers });
const okFetcher = async () => response(200);

const probeRecord = (overrides = {}) => ({
  id: 'probe-one', workspaceId: 'workspace-a', proposalId: 'proposal-p002', projectId: 'project-a',
  projectAreaId: 'area-row-one', status: 'SAFE', candidateUrl: 'https://example.com/path',
  checks: {
    originalSchemeHttp: true, candidateSchemeHttps: true, requestCompleted: true,
    tlsReachable: true, finalSchemeHttps: true, sameRegistrableHost: true,
    redirectCountWithinLimit: true, statusAcceptable: true,
  },
  httpStatus: 200, finalUrlHost: 'example.com', redirectCount: 0,
  reasonCode: 'HTTPS_REACHABLE', originalUrlFingerprint: '',
  probedByUserId: 'admin-a', probedByName: 'Admin',
  probedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2099-08-09T00:30:00.000Z',
  ...overrides,
});

const p002Preview = (overrides = {}) => ({
  id: 'prop:r008:https-upgrade-candidate', recommendationId: 'rec:r008', ruleCode: 'R008',
  workspaceId: 'workspace-a', projectId: 'project-a', status: 'preview',
  title: 'HTTP → HTTPS', summary: '', generatedBy: 'rule', canApply: false, warnings: [],
  changes: [{
    id: 'change-uri', entityType: 'project_area', entityId: '1', field: 'action_uri',
    operation: 'replace', before: 'http://example.com/path', after: 'https://example.com/path', reason: 'HTTPS candidate',
  }],
  ...overrides,
});

const storedP002 = (overrides = {}) => ({
  id: 'proposal-p002', workspaceId: 'workspace-a', projectId: 'project-a',
  recommendationId: 'rec:r008', ruleCode: 'R008', proposalType: 'https-upgrade-candidate',
  sourceEntityId: '1', status: 'approved', title: 'HTTP → HTTPS', summary: '', generatedBy: 'rule',
  snapshot: p002Preview(), sourceFingerprint: 'source-fingerprint',
  createdByUserId: 'editor-a', createdByName: 'Editor', reviewedByUserId: 'editor-a', reviewedByName: 'Editor',
  approvedByUserId: 'admin-a', approvedByName: 'Admin', rejectedByUserId: null, rejectedByName: null,
  createdAt: '2026-08-09', updatedAt: '2026-08-09', reviewedAt: '2026-08-09', approvedAt: '2026-08-09',
  rejectedAt: null, executedAt: null,
  ...overrides,
});

const p002Context = (uri = 'http://example.com/path?tokenized=value#section', overrides = {}) => ({
  workspaceId: 'workspace-a', userId: 'admin-a', route: '/projects/project-a',
  page: { key: 'project_detail', title: 'Project' }, workspace: { id: 'workspace-a', name: 'A' },
  project: { id: 'project-a', name: 'Project', status: 'draft', templateId: 'template-a', assetId: 'asset-a', areaCount: 1 },
  selectedArea: null,
  areas: [{
    recordId: 'area-row-one', id: '1', label: '公司介紹', actionType: 'uri', uri,
    text: '', data: '', displayText: '', targetPageId: '',
  }],
  lineAccount: { exists: true, hasBotToken: true, hasBotSecret: true, webhookEnabled: true },
  completeness: { projectHasImage: true, allAreasConfigured: true, lineAccountReady: true, hasInvalidActions: false },
  ...overrides,
});

const expectCode = (code, callback) => assert.throws(callback, error => error?.code === code);

test('http normal URL builds an HTTPS candidate while preserving business query internally', () => {
  const candidate = buildHttpsCandidate('http://example.com/path?tokenized=value#part');
  assert.equal(candidate.candidateUrl, 'https://example.com/path?tokenized=value#part');
  assert.equal(candidate.candidateUrlSanitized, 'https://example.com/path');
});

test('https input is not eligible for an upgrade probe', async () => {
  const result = await probeHttpsUpgradeCandidate({ originalUrl: 'https://example.com/path', fetcher: okFetcher });
  assert.equal(result.status, 'UNSAFE');
  assert.equal(result.reasonCode, 'HTTPS_PROBE_REQUIRED');
});

for (const [label, url, reason] of [
  ['localhost', 'http://localhost/path', 'PRIVATE_TARGET_BLOCKED'],
  ['127 loopback', 'http://127.0.0.1/path', 'PRIVATE_TARGET_BLOCKED'],
  ['10 private', 'http://10.1.2.3/path', 'PRIVATE_TARGET_BLOCKED'],
  ['172 private', 'http://172.20.1.2/path', 'PRIVATE_TARGET_BLOCKED'],
  ['192 private', 'http://192.168.1.2/path', 'PRIVATE_TARGET_BLOCKED'],
  ['link local', 'http://169.254.1.2/path', 'PRIVATE_TARGET_BLOCKED'],
  ['public IP literal', 'http://203.0.113.10/path', 'IP_LITERAL_NOT_SUPPORTED'],
  ['non-standard port', 'http://example.com:8080/path', 'NON_STANDARD_PORT_NOT_SUPPORTED'],
  ['credential URL', 'http://user:pass@example.com/path', 'URL_CONTAINS_CREDENTIALS'],
]) {
  test(`${label} is blocked before fetch`, async () => {
    let called = false;
    const result = await probeHttpsUpgradeCandidate({ originalUrl: url, fetcher: async () => { called = true; return response(); } });
    assert.equal(result.status, 'UNSAFE');
    assert.equal(result.reasonCode, reason);
    assert.equal(called, false);
  });
}

test('probe timeout is UNKNOWN and does not hang the workflow', async () => {
  const result = await probeHttpsUpgradeCandidate({
    originalUrl: 'http://example.com/path', timeoutMs: 5,
    fetcher: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reasonCode, 'PROBE_TIMEOUT');
});

test('failed fetch is UNKNOWN', async () => {
  const result = await probeHttpsUpgradeCandidate({ originalUrl: 'http://example.com/path', fetcher: async () => { throw new Error('network'); } });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reasonCode, 'HTTPS_FETCH_FAILED');
});

test('HTTPS 200 is SAFE', async () => {
  const result = await probeHttpsUpgradeCandidate({ originalUrl: 'http://example.com/path?secret=value', fetcher: okFetcher });
  assert.equal(result.status, 'SAFE');
  assert.equal(result.candidateUrl, 'https://example.com/path');
  assert.equal(result.checks.statusAcceptable, true);
});

test('same-host HTTPS redirect remains SAFE', async () => {
  const queue = [response(302, { Location: '/canonical' }), response(204)];
  const result = await probeHttpsUpgradeCandidate({ originalUrl: 'http://example.com/path', fetcher: async () => queue.shift() });
  assert.equal(result.status, 'SAFE');
  assert.equal(result.redirectCount, 1);
  assert.equal(result.finalUrlHost, 'example.com');
});

test('redirect hostname change is blocked', async () => {
  const result = await probeHttpsUpgradeCandidate({
    originalUrl: 'http://example.com/path',
    fetcher: async () => response(302, { Location: 'https://www.example.com/path' }),
  });
  assert.equal(result.status, 'UNSAFE');
  assert.equal(result.reasonCode, 'HTTPS_REDIRECT_HOST_CHANGED');
});

test('redirect back to HTTP is blocked', async () => {
  const result = await probeHttpsUpgradeCandidate({
    originalUrl: 'http://example.com/path',
    fetcher: async () => response(302, { Location: 'http://example.com/path' }),
  });
  assert.equal(result.status, 'UNSAFE');
  assert.equal(result.reasonCode, 'HTTPS_REDIRECT_DOWNGRADE');
});

test('401 and 403 are UNKNOWN rather than treated as nonexistent', async () => {
  for (const status of [401, 403]) {
    const result = await probeHttpsUpgradeCandidate({ originalUrl: 'http://example.com/path', fetcher: async () => response(status) });
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.reasonCode, 'HTTPS_STATUS_RESTRICTED');
  }
});

test('redirect count over the conservative limit is UNKNOWN', async () => {
  const result = await probeHttpsUpgradeCandidate({
    originalUrl: 'http://example.com/path', maxRedirects: 0,
    fetcher: async () => response(302, { Location: '/again' }),
  });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reasonCode, 'HTTPS_REDIRECT_LIMIT_EXCEEDED');
});

test('probe expiration derives EXPIRED', async () => {
  const probe = probeRecord({ expiresAt: '2026-08-09T00:01:00.000Z', originalUrlFingerprint: await fingerprintUrl('http://example.com/path') });
  assert.equal(await httpsProbeEligibility(probe, 'http://example.com/path', new Date('2026-08-09T00:02:00.000Z')), 'EXPIRED');
});

test('changed query invalidates an otherwise fresh SAFE probe', async () => {
  const probe = probeRecord({ originalUrlFingerprint: await fingerprintUrl('http://example.com/path?x=1') });
  assert.equal(await httpsProbeEligibility(probe, 'http://example.com/path?x=2'), 'NEEDS_PROBE');
});

test('public probe excludes the original fingerprint and raw query', async () => {
  const current = 'http://example.com/path?tokenized=value';
  const probe = probeRecord({ originalUrlFingerprint: await fingerprintUrl(current) });
  const publicProbe = await toPublicHttpsProbe(probe, current);
  assert.equal('originalUrlFingerprint' in publicProbe, false);
  assert.equal(JSON.stringify(publicProbe).includes('tokenized=value'), false);
});

test('approved SAFE P002 builds a server candidate operation plan', async () => {
  const uri = 'http://example.com/path?tokenized=value#section';
  const probe = probeRecord({ originalUrlFingerprint: await fingerprintUrl(uri) });
  const plan = buildOperationPlan({
    proposal: storedP002(), currentProposal: p002Preview(), context: p002Context(uri),
    actor: { userId: 'admin-a', role: 'admin' }, httpsProbe: { record: probe, eligibility: 'SAFE' },
  });
  assert.equal(plan.operationType, 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS');
  assert.equal(plan.mutation.before, uri);
  assert.equal(plan.mutation.after, 'https://example.com/path?tokenized=value#section');
  assert.equal(plan.probe.probeId, 'probe-one');
});

test('approved P002 without probe is blocked', () => {
  expectCode('HTTPS_PROBE_REQUIRED', () => buildOperationPlan({
    proposal: storedP002(), currentProposal: p002Preview(), context: p002Context(),
    actor: { userId: 'admin-a', role: 'admin' }, httpsProbe: { record: null, eligibility: 'NEEDS_PROBE' },
  }));
});

for (const [eligibility, code] of [['EXPIRED', 'HTTPS_PROBE_EXPIRED'], ['UNSAFE', 'HTTPS_PROBE_UNSAFE'], ['UNKNOWN', 'HTTPS_PROBE_UNKNOWN']]) {
  test(`${eligibility} probe blocks P002 execution`, () => {
    expectCode(code, () => buildOperationPlan({
      proposal: storedP002(), currentProposal: p002Preview(), context: p002Context(),
      actor: { userId: 'admin-a', role: 'admin' }, httpsProbe: { record: probeRecord(), eligibility },
    }));
  });
}

test('editor cannot execute P002', () => {
  expectCode('FORBIDDEN_ROLE', () => buildOperationPlan({
    proposal: storedP002(), currentProposal: p002Preview(), context: p002Context(),
    actor: { userId: 'editor-a', role: 'editor' }, httpsProbe: { record: probeRecord(), eligibility: 'SAFE' },
  }));
});

test('cross-tenant P002 execution is blocked', () => {
  expectCode('PROPOSAL_STALE', () => buildOperationPlan({
    proposal: storedP002(), currentProposal: p002Preview(), context: p002Context(undefined, { workspaceId: 'workspace-b' }),
    actor: { userId: 'admin-a', role: 'admin' }, httpsProbe: { record: probeRecord(), eligibility: 'SAFE' },
  }));
});

test('P002 registry is typed and executor changes only action_uri', async () => {
  assert.deepEqual(Object.keys(OPERATION_EXECUTORS), ['SET_PROJECT_AREA_DISPLAY_TEXT', 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS']);
  const source = await readFile(new URL('../src/guide/proposals/execution.ts', import.meta.url), 'utf8');
  const executor = source.slice(source.indexOf('async function executeUpgradeProjectAreaUri'), source.indexOf('export function publicOperationPlan'));
  assert.match(executor, /SET action_uri = \?, updated_at = CURRENT_TIMESTAMP/);
  assert.match(executor, /action_type = 'uri' AND action_uri = \?/);
  assert.match(executor, /original_url_fingerprint = \? AND expires_at > \?/);
  for (const forbidden of ['SET action_type', 'SET action_data', 'SET action_display_text', 'UPDATE templates', 'smart_menu_assets', 'api.line.me']) {
    assert.equal(executor.includes(forbidden), false);
  }
});

test('execute endpoint ignores forged after URL and forged probe id', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/projects/:projectId/proposals/:proposalId/execute'");
  const end = source.indexOf('function rollbackApiError', start);
  const route = source.slice(start, end);
  assert.match(route, /body\.confirmation !== true/);
  assert.doesNotMatch(route, /body\.(after|url|probeId|field|operationType)/);
  assert.match(route, /loadHttpsProbeState\(c, proposal\)/);
});

test('probe endpoint never accepts a generic URL body', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/projects/:projectId/proposals/:proposalId/https-probe'");
  const end = source.indexOf("app.post('/api/projects/:projectId/proposals/:proposalId/execute'", start);
  const route = source.slice(start, end);
  assert.doesNotMatch(route, /c\.req\.json|body\.url|originalUrl:\s*body/);
  assert.match(route, /originalUrl: area\.uri/);
  assert.match(route, /workspaceId/);
});

test('public operation plan and log never expose query or URI fingerprints', async () => {
  const uri = 'http://example.com/path?tokenized=value';
  const probe = probeRecord({ originalUrlFingerprint: await fingerprintUrl(uri) });
  const plan = buildOperationPlan({
    proposal: storedP002(), currentProposal: p002Preview(), context: p002Context(uri),
    actor: { userId: 'admin-a', role: 'admin' }, httpsProbe: { record: probe, eligibility: 'SAFE' },
  });
  assert.equal(JSON.stringify(publicOperationPlan(plan)).includes('tokenized=value'), false);
  const publicLog = publicOperationLog({
    id: 'op', workspaceId: 'workspace-a', proposalId: 'proposal-p002', projectId: 'project-a',
    operationType: 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS', targetEntityType: 'project_area', targetEntityId: 'area-row-one',
    status: 'succeeded', before: { actionUri: 'http://example.com/path' }, after: { actionUri: 'https://example.com/path' },
    actorUserId: 'admin-a', actorName: 'Admin', errorCode: null, errorMessage: null,
    createdAt: 'now', completedAt: 'now', revertsOperationId: null, rootOperationId: null,
    rollbackOperationId: null, probeId: 'probe-one', beforeValueFingerprint: 'private-before', afterValueFingerprint: 'private-after',
  });
  assert.equal('beforeValueFingerprint' in publicLog, false);
  assert.equal('afterValueFingerprint' in publicLog, false);
});

test('0015 creates probe persistence and preserves typed P001/P002 audit rows', async () => {
  const sql = await readFile(new URL('../migrations/0015_ai_https_probe_results.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_https_probe_results/);
  assert.match(sql, /UPGRADE_PROJECT_AREA_URI_TO_HTTPS/);
  assert.match(sql, /INSERT INTO ai_operation_logs[\s\S]+FROM ai_operation_logs_0014/);
  assert.match(sql, /before_value_fingerprint TEXT/);
  assert.match(sql, /probe_id TEXT/);
  assert.doesNotMatch(sql, /ALTER TABLE (projects|project_areas|templates|assets)|UPDATE (projects|project_areas|templates|assets)|DELETE FROM/i);
});

test('probe and execution modules never call Gemini, R2, or LINE', async () => {
  const source = await Promise.all([
    readFile(new URL('../src/guide/proposals/https-probe.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/guide/proposals/execution.ts', import.meta.url), 'utf8'),
  ]).then(parts => parts.join('\n'));
  for (const forbidden of ['requestGemini', 'GEMINI_API_KEY', 'smart_menu_assets', 'api.line.me', 'UPDATE templates']) {
    assert.equal(source.includes(forbidden), false);
  }
});

test('executed P002 is rollback eligible only while the exact HTTPS URI is unchanged', async () => {
  const http = 'http://example.com/path?tokenized=value';
  const https = 'https://example.com/path?tokenized=value';
  const beforeValueFingerprint = await fingerprintUrl(http);
  const afterValueFingerprint = await fingerprintUrl(https);
  const operation = {
    id: 'op-p002', workspaceId: 'workspace-a', proposalId: 'proposal-p002', projectId: 'project-a',
    operationType: 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS', targetEntityType: 'project_area', targetEntityId: 'area-row-one',
    status: 'succeeded', before: { actionUri: sanitizeUrlForAudit(http) }, after: { actionUri: sanitizeUrlForAudit(https) },
    actorUserId: 'admin-a', actorName: 'Admin', errorCode: null, errorMessage: null,
    createdAt: 'now', completedAt: 'now', revertsOperationId: null, rootOperationId: null,
    rollbackOperationId: null, probeId: 'probe-one', beforeValueFingerprint, afterValueFingerprint,
  };
  const target = {
    workspaceId: 'workspace-a', projectId: 'project-a', entityId: 'area-row-one', areaIndex: '1', label: '公司介紹',
    actionDisplayText: '', actionUri: https, actionUriFingerprint: afterValueFingerprint,
    httpRestoreUrl: buildHttpRestoreUrl(https), httpRestoreFingerprint: beforeValueFingerprint,
  };
  const proposal = storedP002({ status: 'executed', executedAt: 'now' });
  assert.equal(evaluateRollbackEligibility({ operationLog: operation, currentTarget: target, proposal }).eligible, true);
  const plan = buildRollbackPlan({ proposal, operationLog: operation, currentTarget: target, actor: { userId: 'admin-a', role: 'admin' } });
  assert.equal(plan.mutation.restoreTo, http);
  assert.equal(JSON.stringify(publicRollbackPlan(plan)).includes('tokenized=value'), false);
});

test('manual URI change and second rollback are blocked', async () => {
  const http = 'http://example.com/path?x=1';
  const https = 'https://example.com/path?x=1';
  const beforeValueFingerprint = await fingerprintUrl(http);
  const afterValueFingerprint = await fingerprintUrl(https);
  const operation = {
    id: 'op', workspaceId: 'workspace-a', proposalId: 'proposal-p002', projectId: 'project-a',
    operationType: 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS', targetEntityType: 'project_area', targetEntityId: 'area-row-one',
    status: 'succeeded', before: { actionUri: sanitizeUrlForAudit(http) }, after: { actionUri: sanitizeUrlForAudit(https) },
    actorUserId: 'admin-a', actorName: 'Admin', errorCode: null, errorMessage: null,
    createdAt: 'now', completedAt: 'now', revertsOperationId: null, rootOperationId: null,
    rollbackOperationId: null, probeId: 'probe', beforeValueFingerprint, afterValueFingerprint,
  };
  const changed = 'https://example.com/path?x=2';
  const target = {
    workspaceId: 'workspace-a', projectId: 'project-a', entityId: 'area-row-one', areaIndex: '1', label: '公司介紹',
    actionDisplayText: '', actionUri: changed, actionUriFingerprint: await fingerprintUrl(changed),
    httpRestoreUrl: buildHttpRestoreUrl(changed), httpRestoreFingerprint: await fingerprintUrl(buildHttpRestoreUrl(changed)),
  };
  const proposal = storedP002({ status: 'executed', executedAt: 'now' });
  assert.equal(evaluateRollbackEligibility({ operationLog: operation, currentTarget: target, proposal }).reasonCode, 'TARGET_CHANGED_AFTER_EXECUTION');
  assert.equal(evaluateRollbackEligibility({ operationLog: { ...operation, rollbackOperationId: 'rollback' }, currentTarget: target, proposal }).reasonCode, 'ROLLBACK_ALREADY_COMPLETED');
});

test('P002 rollback registry is typed and restores only action_uri', async () => {
  assert.deepEqual(Object.keys(ROLLBACK_EXECUTORS), ['SET_PROJECT_AREA_DISPLAY_TEXT', 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS']);
  const source = await readFile(new URL('../src/guide/proposals/rollback.ts', import.meta.url), 'utf8');
  const executor = source.slice(source.indexOf('async function rollbackUpgradeProjectAreaUri'), source.indexOf('export function publicRollbackPlan'));
  assert.match(executor, /SET action_uri = \?, updated_at = CURRENT_TIMESTAMP/);
  assert.match(executor, /before_value_fingerprint = \? AND after_value_fingerprint = \?/);
  assert.match(executor, /NOT EXISTS/);
  for (const forbidden of ['SET action_type', 'SET action_data', 'SET action_display_text', 'UPDATE templates', 'smart_menu_assets', 'api.line.me']) {
    assert.equal(executor.includes(forbidden), false);
  }
});

test('R008 disappears for HTTPS and returns for restored HTTP', () => {
  const httpContext = p002Context('http://example.com/path');
  const httpsContext = p002Context('https://example.com/path');
  assert.equal(evaluateRecommendations(httpContext).recommendations.some(item => item.ruleCode === 'R008'), true);
  assert.equal(evaluateRecommendations(httpsContext).recommendations.some(item => item.ruleCode === 'R008'), false);
});

test('P003-P005 remain non-executable and frontend exposes no force apply', async () => {
  const execution = await readFile(new URL('../src/guide/proposals/execution.ts', import.meta.url), 'utf8');
  const frontend = await readFile(new URL('../../frontend/src/components/ProposalManagement.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(execution, /duplicate-message-review.*UPGRADE|duplicate-postback-review.*UPGRADE|multi-page-structure-draft.*UPGRADE/s);
  assert.doesNotMatch(frontend, />\s*Force Apply\s*</i);
  assert.match(frontend, /P003–P005 維持不可執行/);
});
