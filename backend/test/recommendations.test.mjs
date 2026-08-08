import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicGuideContext } from '../src/guide/context.ts';
import { evaluateRecommendations } from '../src/guide/recommendations/engine.ts';
import { evaluateGuide } from '../src/guide/rules.ts';
import { buildGuideWorkflow } from '../src/guide/workflow.ts';

const area = (id, actionType, overrides = {}) => ({
  id: String(id),
  label: `區域 ${id}`,
  actionType,
  uri: '',
  text: '',
  data: '',
  displayText: '',
  targetPageId: '',
  ...overrides,
});

const uri = (id, value = `https://example.com/${id}`) => area(id, 'uri', { uri: value });
const message = (id, value = `訊息 ${id}`) => area(id, 'message', { text: value });
const postback = (id, value = `action=${id}`, displayText = `操作 ${id}`) =>
  area(id, 'postback', { data: value, displayText });
const richMenuSwitch = (id, target = `project-${id}`) =>
  area(id, 'richmenuswitch', { targetPageId: target });

function context(areas) {
  const configuredTypes = new Set(['uri', 'message', 'postback', 'richmenuswitch']);
  const allAreasConfigured = areas.length > 0 && areas.every(item => configuredTypes.has(item.actionType));
  const hasInvalidActions = areas.length === 0 || areas.some(item => {
    if (item.actionType === 'uri') return !item.uri;
    if (item.actionType === 'message') return !item.text;
    if (item.actionType === 'postback') return !item.data;
    if (item.actionType === 'richmenuswitch') return !item.targetPageId;
    return true;
  });

  return {
    workspaceId: 'workspace-a',
    userId: 'user-a',
    route: '/projects/project-a',
    page: { key: 'project_detail', title: 'Project Detail' },
    workspace: { id: 'workspace-a', name: 'Workspace A' },
    project: {
      id: 'project-a',
      name: '首頁',
      status: 'draft',
      templateId: 'template-a',
      assetId: 'asset-a',
      areaCount: areas.length,
    },
    selectedArea: null,
    areas,
    lineAccount: { exists: true, hasBotToken: true, hasBotSecret: true, webhookEnabled: true },
    completeness: {
      projectHasImage: true,
      allAreasConfigured,
      lineAccountReady: true,
      hasInvalidActions,
    },
  };
}

const resultFor = areas => evaluateRecommendations(context(areas));
const byCode = (result, code) => result.recommendations.filter(item => item.ruleCode === code);

test('R001 ALL_ACTIONS_ARE_URI', () => {
  const result = resultFor([uri(1), uri(2), uri(3)]);
  assert.equal(byCode(result, 'R001').length, 1);
  assert.equal(byCode(result, 'R001')[0].priority, 'medium');
});

test('R002 NO_INTERACTIVE_ACTION', () => {
  const result = resultFor([uri(1), uri(2), uri(3)]);
  assert.equal(byCode(result, 'R002').length, 1);
});

test('R003 MANY_AREAS_NO_PAGE_SWITCH', () => {
  const result = resultFor([uri(1), message(2), postback(3), uri(4), message(5), postback(6)]);
  assert.equal(byCode(result, 'R003').length, 1);
});

test('R004 TOO_MANY_AREAS', () => {
  const result = resultFor([
    uri(1), message(2), postback(3), richMenuSwitch(4),
    uri(5), message(6), postback(7), richMenuSwitch(8),
  ]);
  assert.equal(byCode(result, 'R004').length, 1);
  assert.equal(byCode(result, 'R004')[0].priority, 'high');
});

test('R005 DUPLICATE_URI emits one item per group without leaking query values', () => {
  const duplicated = 'https://example.com/path?secret=top-secret&token=abc';
  const result = resultFor([uri(1, duplicated), uri(2, duplicated), message(3)]);
  assert.equal(byCode(result, 'R005').length, 1);
  const serialized = JSON.stringify(byCode(result, 'R005')[0]);
  assert.equal(serialized.includes('top-secret'), false);
  assert.equal(serialized.includes('token=abc'), false);
  assert.match(serialized, /https:\/\/example\.com\/path/);
});

test('R006 DUPLICATE_MESSAGE', () => {
  const result = resultFor([message(1, '相同訊息'), message(2, '相同訊息'), uri(3)]);
  assert.equal(byCode(result, 'R006').length, 1);
  assert.equal(JSON.stringify(result).includes('相同訊息'), false);
});

test('R007 DUPLICATE_POSTBACK_DATA', () => {
  const result = resultFor([postback(1, 'secret-route=one'), postback(2, 'secret-route=one'), uri(3)]);
  assert.equal(byCode(result, 'R007').length, 1);
  assert.equal(JSON.stringify(result).includes('secret-route=one'), false);
});

test('R008 URI_USES_HTTP', () => {
  const result = resultFor([uri(1, 'http://example.com/insecure'), message(2)]);
  assert.equal(byCode(result, 'R008').length, 1);
  assert.equal(byCode(result, 'R008')[0].priority, 'high');
});

test('R009 LONG_MESSAGE_ACTION uses the documented UX heuristic', () => {
  const result = resultFor([message(1, '長'.repeat(101)), uri(2)]);
  assert.equal(byCode(result, 'R009').length, 1);
  assert.deepEqual(
    byCode(result, 'R009')[0].evidence.find(item => item.key === 'heuristicThreshold'),
    { key: 'heuristicThreshold', value: 100 },
  );
});

test('R010 POSTBACK_WITHOUT_DISPLAY_TEXT remains a recommendation, not validation', () => {
  const ctx = context([postback(1, 'action=contact', ''), uri(2)]);
  const result = evaluateRecommendations(ctx);
  assert.equal(byCode(result, 'R010').length, 1);
  assert.equal(evaluateGuide(ctx).status, 'complete');
});

test('R011 MIXED_EXTERNAL_DOMAINS', () => {
  const result = resultFor([
    uri(1, 'https://one.example/a'),
    uri(2, 'https://two.example/b'),
    uri(3, 'https://three.example/c'),
  ]);
  assert.equal(byCode(result, 'R011').length, 1);
});

test('R012 NO_PRIMARY_CONVERSION_ACTION uses only structural evidence', () => {
  const result = resultFor([uri(1), richMenuSwitch(2), uri(3), richMenuSwitch(4)]);
  assert.equal(byCode(result, 'R012').length, 1);
});

test('a valid small mixed configuration can have no recommendations', () => {
  const result = resultFor([uri(1), message(2)]);
  assert.deepEqual(result, {
    recommendations: [],
    summary: { total: 0, high: 0, medium: 0, low: 0 },
  });
});

test('recommendation IDs are stable, unique, deduplicated, and expose proposal availability', () => {
  const areas = [
    uri(1, 'https://example.com/shared'),
    uri(2, 'https://example.com/shared'),
    uri(3, 'http://legacy.example/path'),
  ];
  const first = resultFor(areas);
  const second = resultFor(areas);
  assert.deepEqual(first.recommendations.map(item => item.id), second.recommendations.map(item => item.id));
  assert.equal(new Set(first.recommendations.map(item => item.id)).size, first.recommendations.length);
  assert.ok(first.recommendations.every(item => item.canGenerateProposal === item.proposal.available));
  assert.ok(first.recommendations.some(item => item.ruleCode === 'R008' && item.proposal.available));
  assert.ok(first.recommendations.some(item => item.ruleCode === 'R005' && !item.proposal.available));
  assert.ok(first.recommendations.every(item => item.explanationSource === 'rule'));
});

test('recommendations sort high, medium, low with fixed rule ordering', () => {
  const result = resultFor([
    uri(1, 'http://one.example/shared'),
    uri(2, 'http://one.example/shared'),
    uri(3, 'https://three.example/3'),
    uri(4, 'https://four.example/4'),
    uri(5), uri(6), uri(7), uri(8),
  ]);
  const weights = { high: 0, medium: 1, low: 2 };
  const priorities = result.recommendations.map(item => weights[item.priority]);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b));
  assert.ok(result.recommendations.indexOf(byCode(result, 'R001')[0]) < result.recommendations.indexOf(byCode(result, 'R002')[0]));
});

test('recommendations never change Guide or Workflow completion status', () => {
  const ctx = context(Array.from({ length: 8 }, (_, index) => uri(index + 1)));
  const guideBefore = evaluateGuide(ctx);
  const workflowBefore = buildGuideWorkflow(ctx, guideBefore);
  const recommendationResult = evaluateRecommendations(ctx);
  const guideAfter = evaluateGuide(ctx);
  const workflowAfter = buildGuideWorkflow(ctx, guideAfter);
  assert.ok(recommendationResult.summary.total > 0);
  assert.equal(guideBefore.status, 'complete');
  assert.equal(workflowBefore.status, 'complete');
  assert.deepEqual(guideAfter, guideBefore);
  assert.deepEqual(workflowAfter, workflowBefore);
});

test('public Guide context removes raw URI query, Message, and Postback Data', () => {
  const ctx = context([
    uri(1, 'https://example.com/path?token=query-secret'),
    message(2, 'private message content'),
    postback(3, 'private=postback-secret'),
  ]);
  const serialized = JSON.stringify(toPublicGuideContext(ctx));
  assert.equal(serialized.includes('query-secret'), false);
  assert.equal(serialized.includes('private message content'), false);
  assert.equal(serialized.includes('postback-secret'), false);
  assert.match(serialized, /https:\/\/example\.com\/path/);
  assert.match(serialized, /"messageLength":23/);
});
