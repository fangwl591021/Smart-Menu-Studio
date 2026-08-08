import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canTransitionProposal,
  createProposalDraft,
  fingerprintProposal,
  parseProposalSnapshot,
  proposalPermissions,
  transitionStoredProposal,
} from '../src/guide/proposals/persistence.ts';

const proposal = (overrides = {}) => ({
  id: 'prop:rec:R010:project-a:stable:postback-display-text',
  recommendationId: 'rec:R010:project-a:stable',
  ruleCode: 'R010',
  workspaceId: 'workspace-a',
  projectId: 'project-a',
  status: 'preview',
  title: '為 Postback 加入顯示文字',
  summary: '建立安全的顯示文字草案。',
  changes: [{
    id: 'chg:area-a:action-display-text',
    entityType: 'project_area',
    entityId: 'area-a',
    field: 'action_display_text',
    operation: 'set',
    before: '',
    after: '聯絡我們',
    reason: '讓使用者看見操作文字。',
  }],
  warnings: [],
  generatedBy: 'rule',
  canApply: false,
  ...overrides,
});

class FakeStatement {
  constructor(sql) {
    this.sql = sql;
    this.values = [];
  }
  bind(...values) {
    this.values = values;
    return this;
  }
}

class FakeDatabase {
  constructor(changes = 1) {
    this.changes = changes;
    this.prepared = [];
    this.batches = [];
  }
  prepare(sql) {
    const statement = new FakeStatement(sql);
    this.prepared.push(statement);
    return statement;
  }
  async batch(statements) {
    this.batches.push(statements);
    return statements.map(() => ({ meta: { changes: this.changes } }));
  }
}

const stored = status => ({
  id: 'aip-one', workspaceId: 'workspace-a', projectId: 'project-a',
  recommendationId: 'rec:R010:project-a:stable', ruleCode: 'R010',
  proposalType: 'postback-display-text', sourceEntityId: 'area-a', status,
  title: 'Proposal', summary: '', generatedBy: 'rule', snapshot: proposal(),
  sourceFingerprint: 'fingerprint', createdByUserId: 'user-a', createdByName: 'A',
  reviewedByUserId: null, reviewedByName: null, approvedByUserId: null,
  approvedByName: null, rejectedByUserId: null, rejectedByName: null,
  createdAt: '2026-08-09', updatedAt: '2026-08-09', reviewedAt: null,
  approvedAt: null, rejectedAt: null,
});

test('create draft persists only a sanitized Proposal snapshot and CREATED event', async () => {
  const db = new FakeDatabase();
  const id = await createProposalDraft(db, {
    proposal: proposal(), proposalType: 'postback-display-text',
    sourceEntityId: 'area-a', actorUserId: 'user-a',
  });
  assert.match(id, /^aip_/);
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 2);
  assert.match(db.batches[0][0].sql, /INSERT INTO ai_proposals/);
  assert.match(db.batches[0][1].sql, /'CREATED'/);
  const snapshot = db.batches[0][0].values.find(value => typeof value === 'string' && value.includes('"status":"preview"'));
  assert.ok(parseProposalSnapshot(snapshot));
});

test('fingerprint is deterministic and changes with relevant before state', async () => {
  const first = await fingerprintProposal(proposal(), 'postback-display-text');
  const second = await fingerprintProposal(proposal(), 'postback-display-text');
  const changed = await fingerprintProposal(proposal({ changes: [{ ...proposal().changes[0], before: '舊值' }] }), 'postback-display-text');
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('sanitized snapshot removes URL credentials, query, and fragment', () => {
  const unsafe = proposal({
    ruleCode: 'R008',
    changes: [{ ...proposal().changes[0], field: 'action_uri', before: 'http://user:password@example.com/path?token=secret#private', after: 'https://example.com/path?key=value' }],
  });
  const sanitized = parseProposalSnapshot(unsafe);
  assert.equal(sanitized.changes[0].before, 'http://example.com/path');
  assert.equal(sanitized.changes[0].after, 'https://example.com/path');
  for (const value of ['password', 'token=secret', 'private', 'key=value']) {
    assert.equal(JSON.stringify(sanitized).includes(value), false);
  }
});

test('lifecycle allows draft -> reviewed -> approved and draft/reviewed -> rejected', () => {
  assert.equal(canTransitionProposal('draft', 'reviewed'), true);
  assert.equal(canTransitionProposal('reviewed', 'approved'), true);
  assert.equal(canTransitionProposal('draft', 'rejected'), true);
  assert.equal(canTransitionProposal('reviewed', 'rejected'), true);
});

test('rejected and executed cannot transition; approved can only become stale', () => {
  assert.equal(canTransitionProposal('rejected', 'approved'), false);
  assert.equal(canTransitionProposal('executed', 'draft'), false);
  assert.equal(canTransitionProposal('approved', 'reviewed'), false);
  assert.equal(canTransitionProposal('approved', 'stale'), true);
});

test('transition writes status and matching audit event without project writes', async () => {
  const db = new FakeDatabase();
  await transitionStoredProposal(db, {
    proposal: stored('draft'), toStatus: 'reviewed', eventType: 'REVIEWED', actorUserId: 'editor-a',
  });
  const sql = db.batches[0].map(statement => statement.sql).join('\n');
  assert.match(sql, /UPDATE ai_proposals/);
  assert.match(sql, /INSERT INTO ai_proposal_events/);
  assert.doesNotMatch(sql, /UPDATE\s+projects\b|UPDATE\s+project_areas\b|INSERT INTO project_areas/i);
});

test('RBAC follows existing viewer/editor/admin/owner hierarchy', () => {
  assert.deepEqual(proposalPermissions('viewer', 'draft'), {
    canCreate: false, canReview: false, canApprove: false, canReject: false, canRegenerate: false,
  });
  assert.equal(proposalPermissions('editor', 'draft').canReview, true);
  assert.equal(proposalPermissions('editor', 'reviewed').canApprove, false);
  assert.equal(proposalPermissions('admin', 'reviewed').canApprove, true);
  assert.equal(proposalPermissions('owner', 'reviewed').canApprove, true);
});

test('migration creates only Proposal persistence tables and required indexes', async () => {
  const sql = await readFile(new URL('../migrations/0012_proposal_approval_workflow.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_proposals/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_proposal_events/);
  assert.match(sql, /idx_ai_proposals_workspace_project_status/);
  assert.match(sql, /idx_ai_proposals_recommendation/);
  assert.match(sql, /idx_ai_proposal_events_proposal_created/);
  assert.doesNotMatch(sql, /ALTER TABLE\s+(projects|project_areas|templates|template_areas)/i);
});

test('create API recomputes server Proposal and never accepts a client snapshot', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const route = source.match(/app\.post\('\/api\/projects\/:projectId\/guide\/recommendations\/:recommendationId\/proposals'[\s\S]*?\n}\);/);
  assert.ok(route);
  assert.match(route[0], /rebuildCurrentProposal/);
  assert.match(route[0], /createProposalDraft/);
  assert.doesNotMatch(route[0], /c\.req\.json/);
});

test('every detail and lifecycle route scopes Proposal by workspace and project', async () => {
  const source = await readFile(new URL('../src/guide/proposals/persistence.ts', import.meta.url), 'utf8');
  assert.match(source, /p\.id = \? AND p\.workspace_id = \? AND p\.project_id = \?/);
  assert.match(source, /workspace_id = \? AND project_id = \? AND status = \?/);
});

test('detail detects stale fingerprint and stale proposal cannot be approved', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /currentFingerprint === proposal\.sourceFingerprint/);
  assert.match(source, /eventType: 'STALE_DETECTED'/);
  const approve = source.match(/app\.post\('\/api\/projects\/:projectId\/proposals\/:proposalId\/approve'[\s\S]*?\n}\);/);
  assert.ok(approve);
  assert.match(approve[0], /refreshStaleStatus/);
  assert.match(approve[0], /proposal\.status === 'stale'/);
});

test('regenerate creates a new draft and preserves the old stale proposal audit trail', async () => {
  const firstDb = new FakeDatabase();
  const secondDb = new FakeDatabase();
  const first = await createProposalDraft(firstDb, { proposal: proposal(), proposalType: 'postback-display-text', actorUserId: 'user-a' });
  const second = await createProposalDraft(secondDb, { proposal: proposal(), proposalType: 'postback-display-text', actorUserId: 'user-a', regeneratedFromId: first });
  assert.notEqual(first, second);
  assert.equal(secondDb.batches[0].length, 3);
  assert.match(secondDb.batches[0][2].sql, /'REGENERATED'/);
  assert.doesNotMatch(secondDb.batches[0].map(statement => statement.sql).join('\n'), /UPDATE ai_proposals SET proposal_snapshot/i);
});

test('frontend covers save, list, detail, review, approval, rejection, stale, regenerate, and no execution action', async () => {
  const preview = await readFile(new URL('../../frontend/src/components/RecommendationSection.jsx', import.meta.url), 'utf8');
  const management = await readFile(new URL('../../frontend/src/components/ProposalManagement.jsx', import.meta.url), 'utf8');
  assert.match(preview, /儲存為草案/);
  for (const marker of ['改善方案詳情', '標記已檢視', '確認核准', '拒絕原因', '已失效', '重新產生方案']) {
    assert.match(management, new RegExp(marker));
  }
  assert.doesNotMatch(preview + management, /一鍵套用|立即執行|執行方案/);
});

test('persistence workflow does not call R2, LINE, Gemini, or project mutation APIs', async () => {
  const persistence = await readFile(new URL('../src/guide/proposals/persistence.ts', import.meta.url), 'utf8');
  for (const forbidden of ['smart_menu_assets', 'api.line.me', 'GEMINI_API_KEY', 'UPDATE projects', 'UPDATE project_areas']) {
    assert.equal(persistence.includes(forbidden), false);
  }
});
