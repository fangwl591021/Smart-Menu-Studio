import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGuide } from '../src/guide/rules.ts';
import { buildGuideWorkflow } from '../src/guide/workflow.ts';
import { GUIDE_WORKFLOWS, ISSUE_TO_WORKFLOW_STEP } from '../src/guide/workflow-registry.ts';

const validArea = (overrides = {}) => ({
  id: '1',
  label: '好友分享',
  actionType: 'uri',
  uri: 'https://example.com',
  text: '',
  data: '',
  displayText: '',
  targetPageId: '',
  ...overrides,
});

function workflowContext({ image = true, areas = [validArea()], account = true, token = true } = {}) {
  const allAreasConfigured = areas.length > 0 && areas.every(area =>
    ['uri', 'message', 'postback', 'richmenuswitch'].includes(area.actionType));
  const hasInvalidActions = areas.length === 0 || areas.some(area => {
    if (area.actionType === 'uri') return !area.uri;
    if (area.actionType === 'message') return !area.text;
    if (area.actionType === 'postback') return !area.data;
    if (area.actionType === 'richmenuswitch') return !area.targetPageId;
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
      assetId: image ? 'asset-a' : null,
      areaCount: areas.length,
    },
    selectedArea: null,
    areas,
    lineAccount: {
      exists: account,
      hasBotToken: account && token,
      hasBotSecret: false,
      webhookEnabled: false,
    },
    completeness: {
      projectHasImage: image,
      allAreasConfigured,
      lineAccountReady: account && token,
      hasInvalidActions,
    },
  };
}

const evaluate = options => {
  const context = workflowContext(options);
  const guide = evaluateGuide(context);
  return buildGuideWorkflow(context, guide);
};

test('workflow registry exposes the five ordered setup steps and issue mapping', () => {
  const definition = GUIDE_WORKFLOWS['rich-menu-project-setup'];
  assert.deepEqual(definition.steps.map(step => step.id), [
    'PROJECT_IMAGE',
    'PROJECT_ACTIONS',
    'LINE_ACCOUNT',
    'LINE_BOT_TOKEN',
    'BASIC_VALIDATION',
  ]);
  assert.equal(ISSUE_TO_WORKFLOW_STEP.ACTION_URI_MISSING, 'PROJECT_ACTIONS');
  assert.equal(ISSUE_TO_WORKFLOW_STEP.LINE_BOT_TOKEN_MISSING, 'LINE_BOT_TOKEN');
});

test('CASE 1: a new project starts blocked at PROJECT_IMAGE', () => {
  const workflow = evaluate({ image: false, areas: [validArea({ actionType: 'none', uri: '' })], account: false, token: false });
  assert.equal(workflow.currentStepId, 'PROJECT_IMAGE');
  assert.equal(workflow.steps[0].status, 'blocked');
  assert.equal(workflow.steps[0].action.target, 'project-image');
});

test('CASE 2: setting the image derives PROJECT_ACTIONS without persisted workflow state', () => {
  const workflow = evaluate({ image: true, areas: [validArea({ actionType: 'none', uri: '' })], account: false, token: false });
  assert.equal(workflow.currentStepId, 'PROJECT_ACTIONS');
  assert.equal(workflow.steps[0].status, 'complete');
  assert.equal(workflow.steps[1].status, 'active');
});

test('CASE 3: valid actions derive LINE_ACCOUNT', () => {
  const workflow = evaluate({ account: false, token: false });
  assert.equal(workflow.currentStepId, 'LINE_ACCOUNT');
  assert.equal(workflow.steps[2].action.type, 'navigate');
  assert.equal(workflow.steps[2].action.target, 'line-hub');
});

test('CASE 4: connecting LINE OA derives LINE_BOT_TOKEN', () => {
  const workflow = evaluate({ account: true, token: false });
  assert.equal(workflow.currentStepId, 'LINE_BOT_TOKEN');
  assert.equal(workflow.steps[3].status, 'active');
});

test('CASE 5: adding a token completes BASIC_VALIDATION', () => {
  const workflow = evaluate();
  assert.equal(workflow.status, 'complete');
  assert.equal(workflow.currentStepId, 'BASIC_VALIDATION');
  assert.deepEqual(workflow.progress, { completed: 5, total: 5, percent: 100 });
  assert.equal(workflow.message, '圖文選單基本設定已完成。');
  assert.equal(JSON.stringify(workflow).includes('已可發布'), false);
});

test('CASE 6: deleting a URI regresses a completed workflow to PROJECT_ACTIONS', () => {
  assert.equal(evaluate().status, 'complete');
  const regressed = evaluate({ areas: [validArea({ uri: '' })] });
  assert.equal(regressed.status, 'in_progress');
  assert.equal(regressed.currentStepId, 'PROJECT_ACTIONS');
  assert.equal(regressed.steps[1].action.target, 'project-area-1-uri');
});

test('CASE 7: missing Rich Menu Switch target keeps PROJECT_ACTIONS active', () => {
  const workflow = evaluate({ areas: [validArea({ actionType: 'richmenuswitch', uri: '', targetPageId: '' })] });
  assert.equal(workflow.currentStepId, 'PROJECT_ACTIONS');
  assert.equal(workflow.steps[1].status, 'active');
  assert.equal(workflow.steps[1].action.target, 'project-area-1-switch-target');
});

test('Guide API workflow schema remains JSON serializable and backward compatible', () => {
  const context = workflowContext({ account: false, token: false });
  const guide = evaluateGuide(context);
  const response = { success: true, context, guide, workflow: buildGuideWorkflow(context, guide) };
  const serialized = JSON.parse(JSON.stringify(response));
  assert.equal(serialized.guide.status, 'incomplete');
  assert.equal(serialized.workflow.id, 'rich-menu-project-setup');
  assert.equal(serialized.workflow.steps.length, 5);
});
