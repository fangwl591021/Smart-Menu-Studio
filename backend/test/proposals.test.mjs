import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGuideContext } from '../src/guide/context.ts';
import { buildProposal, sanitizeProposal } from '../src/guide/proposals/engine.ts';
import { proposalAvailabilityForRule } from '../src/guide/proposals/availability.ts';
import { evaluateRecommendations } from '../src/guide/recommendations/engine.ts';
import { evaluateGuide } from '../src/guide/rules.ts';
import { buildGuideWorkflow } from '../src/guide/workflow.ts';

const area = (id, actionType, overrides = {}) => ({
  id: String(id), label: `Area ${id}`, actionType,
  uri: '', text: '', data: '', displayText: '', targetPageId: '',
  ...overrides,
});
const uri = (id, value = `https://example.com/${id}`) => area(id, 'uri', { uri: value });
const message = (id, value = `訊息 ${id}`) => area(id, 'message', { text: value });
const postback = (id, value = `action=${id}`, displayText = `操作 ${id}`, label = `Area ${id}`) =>
  area(id, 'postback', { data: value, displayText, label });

function context(areas, workspaceId = 'workspace-a') {
  const configured = areas.every(item => ['uri', 'message', 'postback', 'richmenuswitch'].includes(item.actionType));
  const invalid = areas.length === 0 || areas.some(item => {
    if (item.actionType === 'uri') return !item.uri;
    if (item.actionType === 'message') return !item.text;
    if (item.actionType === 'postback') return !item.data;
    if (item.actionType === 'richmenuswitch') return !item.targetPageId;
    return true;
  });
  return {
    workspaceId, userId: 'user-a', route: '/projects/project-a',
    page: { key: 'project_detail', title: 'Project Detail' },
    workspace: { id: workspaceId, name: 'Workspace' },
    project: { id: 'project-a', name: '首頁', status: 'draft', templateId: 'template-secret', assetId: 'asset-a', areaCount: areas.length },
    selectedArea: null, areas,
    lineAccount: { exists: true, hasBotToken: true, hasBotSecret: true, webhookEnabled: true },
    completeness: { projectHasImage: true, allAreasConfigured: configured, lineAccountReady: true, hasInvalidActions: invalid },
  };
}

const recommendationFor = (ctx, ruleCode) =>
  evaluateRecommendations(ctx).recommendations.find(item => item.ruleCode === ruleCode);

test('R010 builds stable P001 preview using the Area label without writes', async () => {
  const ctx = context([postback(1, 'private=route', '', '聯絡我們'), uri(2)]);
  const recommendation = recommendationFor(ctx, 'R010');
  const before = structuredClone(ctx);
  const first = buildProposal({ context: ctx, recommendation });
  const second = buildProposal({ context: ctx, recommendation });

  assert.equal(first.id, second.id);
  assert.match(first.id, /^prop:rec:R010:project-a:/);
  assert.equal(first.status, 'preview');
  assert.equal(first.canApply, false);
  assert.equal(first.generatedBy, 'rule');
  assert.deepEqual(first.changes[0], {
    id: 'chg:1:action-display-text', entityType: 'project_area', entityId: '1',
    field: 'action_display_text', operation: 'set', before: '', after: '聯絡我們',
    reason: '使用既有區域標籤作為顯示文字，不改動 Postback Data。',
  });
  assert.deepEqual(ctx, before);
  assert.equal(JSON.stringify(first).includes('private=route'), false);

  const source = await readFile(new URL('../src/guide/proposals/engine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.prepare\(|\.run\(|\.put\(/);
});

test('P001 falls back to a short deterministic display text for unsuitable labels', () => {
  const ctx = context([postback(1, 'action=one', '', '過長'.repeat(20)), uri(2)]);
  const proposal = buildProposal({ context: ctx, recommendation: recommendationFor(ctx, 'R010') });
  assert.equal(proposal.changes[0].after, '查看內容');
});

test('R008 builds an HTTPS candidate with warning and removes credentials, query, and fragment', () => {
  const ctx = context([uri(1, 'http://user:password@example.com/path?token=query-secret#private'), message(2)]);
  const proposal = buildProposal({ context: ctx, recommendation: recommendationFor(ctx, 'R008') });
  assert.equal(proposal.changes[0].before, 'http://example.com/path');
  assert.equal(proposal.changes[0].after, 'https://example.com/path');
  assert.equal(proposal.warnings[0].code, 'HTTPS_SUPPORT_NOT_VERIFIED');
  assert.equal(proposal.canApply, false);
  const serialized = JSON.stringify(proposal);
  for (const secret of ['user', 'password', 'query-secret', 'private']) assert.equal(serialized.includes(secret), false);
});

test('duplicate Message creates a review-only P003 without raw message text', () => {
  const raw = 'private duplicated message';
  const ctx = context([message(1, raw), message(2, raw), uri(3)]);
  const proposal = buildProposal({ context: ctx, recommendation: recommendationFor(ctx, 'R006') });
  assert.deepEqual(proposal.changes, []);
  assert.equal(proposal.warnings[0].code, 'MANUAL_REVIEW_REQUIRED');
  assert.match(proposal.summary, /Area 1/);
  assert.match(proposal.summary, /Area 2/);
  assert.equal(JSON.stringify(proposal).includes(raw), false);
});

test('duplicate Postback creates a review-only P004 without raw Postback Data', () => {
  const raw = 'token=postback-secret';
  const ctx = context([postback(1, raw), postback(2, raw), uri(3)]);
  const proposal = buildProposal({ context: ctx, recommendation: recommendationFor(ctx, 'R007') });
  assert.deepEqual(proposal.changes, []);
  assert.equal(proposal.warnings[0].code, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(JSON.stringify(proposal).includes(raw), false);
});

test('R003 and R004 create review-only multi-page structure drafts without guessing labels', () => {
  const areas = Array.from({ length: 8 }, (_, index) => index % 2 ? message(index + 1) : uri(index + 1));
  const ctx = context(areas);
  for (const ruleCode of ['R003', 'R004']) {
    const proposal = buildProposal({ context: ctx, recommendation: recommendationFor(ctx, ruleCode) });
    assert.deepEqual(proposal.changes, []);
    assert.equal(proposal.warnings[0].code, 'STRUCTURE_REVIEW_REQUIRED');
    assert.match(proposal.summary, /人工選擇/);
    assert.equal(proposal.canApply, false);
  }
});

test('only P001-P005 source rules expose proposal availability', () => {
  const supported = ['R003', 'R004', 'R006', 'R007', 'R008', 'R010'];
  for (let number = 1; number <= 12; number += 1) {
    const code = `R${String(number).padStart(3, '0')}`;
    assert.equal(proposalAvailabilityForRule(code).available, supported.includes(code));
  }
  assert.deepEqual(proposalAvailabilityForRule('R001'), { available: false, type: null });
});

test('Proposal targets only project/project_area and never template, workspace, LINE, or credentials', () => {
  const contexts = [
    context([postback(1, 'secret=data', '', '聯絡我們'), uri(2)]),
    context([uri(1, 'http://example.com/path?secret=x'), message(2)]),
  ];
  const proposals = [
    buildProposal({ context: contexts[0], recommendation: recommendationFor(contexts[0], 'R010') }),
    buildProposal({ context: contexts[1], recommendation: recommendationFor(contexts[1], 'R008') }),
  ];
  const unsafeTemplateProposal = structuredClone(proposals[0]);
  unsafeTemplateProposal.changes[0].entityType = 'template';
  assert.equal(sanitizeProposal(unsafeTemplateProposal), null);

  for (const proposal of proposals) {
    assert.ok(proposal.changes.every(change => ['project', 'project_area'].includes(change.entityType)));
    const serialized = JSON.stringify(proposal);
    for (const forbidden of ['template-secret', 'line_account', 'token', 'webhook', 'password']) {
      assert.equal(serialized.toLowerCase().includes(forbidden), false);
    }
  }
});

test('Proposal generation leaves Recommendation, Guide, Workflow, context, and D1 untouched', () => {
  const ctx = context([postback(1, 'action=one', '', '聯絡我們'), uri(2)]);
  const guide = evaluateGuide(ctx);
  const workflow = buildGuideWorkflow(ctx, guide);
  const recommendation = recommendationFor(ctx, 'R010');
  const snapshots = structuredClone({ ctx, guide, workflow, recommendation });
  buildProposal({ context: ctx, recommendation });
  assert.deepEqual({ ctx, guide, workflow, recommendation }, snapshots);
});

test('Workspace A cannot load Workspace B context for a Proposal', async () => {
  let writeCount = 0;
  const db = {
    prepare(sql) {
      if (/^\\s*(INSERT|UPDATE|DELETE|REPLACE)\\b/i.test(sql)) writeCount += 1;
      return { bind(...values) { return {
        async first() {
          if (sql.includes('FROM projects')) return values[1] === 'workspace-a'
            ? { id: 'project-a', name: '首頁', status: 'draft', template_id: null, asset_id: null }
            : null;
          return null;
        },
        async all() { return { results: [] }; },
      }; } };
    },
  };
  const input = { db, userId: 'user-a', route: '/projects/project-a', entityType: 'project', entityId: 'project-a' };
  assert.ok(await buildGuideContext({ ...input, workspaceId: 'workspace-a' }));
  assert.equal(await buildGuideContext({ ...input, workspaceId: 'workspace-b' }), null);
  assert.equal(writeCount, 0);
});

test('Proposal API recomputes server state, returns 404, and contains no write path', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const route = source.match(/app\.post\('\/api\/projects\/:projectId\/guide\/recommendations\/:recommendationId\/proposal'[\s\S]*?\n}\);/);
  assert.ok(route);
  assert.match(route[0], /workspaceIdOf\(c\)/);
  assert.match(route[0], /buildGuideContext/);
  assert.match(route[0], /evaluateRecommendations\(context\)/);
  assert.match(route[0], /findRecommendationById/);
  assert.match(route[0], /buildProposal/);
  assert.match(route[0], /404/);
  assert.doesNotMatch(route[0], /\.run\(|\.put\(|INSERT|UPDATE|DELETE/);
});

test('frontend Proposal Preview is lazy, stateful, closable, and has no Apply action', async () => {
  const source = await readFile(new URL('../../frontend/src/components/RecommendationSection.jsx', import.meta.url), 'utf8');
  assert.match(source, /recommendation\.proposal\?\.available/);
  assert.match(source, /查看改善方案/);
  assert.match(source, /status: 'loading'/);
  assert.match(source, /status: 'success'/);
  assert.match(source, /status: 'error'/);
  assert.match(source, /changes\.length > 0/);
  assert.match(source, /Preview Only/);
  assert.match(source, /系統尚未修改任何資料/);
  assert.match(source, /closeProposal/);
  assert.doesNotMatch(source, /套用|確認修改|立即更新/);
});
