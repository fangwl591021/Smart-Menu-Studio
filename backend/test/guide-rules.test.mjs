import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuideContext } from '../src/guide/context.ts';
import { evaluateGuide } from '../src/guide/rules.ts';

const completeArea = (overrides = {}) => ({
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

const context = (overrides = {}) => {
  const areas = overrides.areas || [completeArea()];
  const lineAccount = overrides.lineAccount || {
    exists: true,
    hasBotToken: true,
    hasBotSecret: true,
    webhookEnabled: true,
  };
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
      assetId: overrides.assetId === undefined ? 'asset-a' : overrides.assetId,
      areaCount: areas.length,
    },
    selectedArea: null,
    areas,
    lineAccount,
    completeness: {
      projectHasImage: overrides.assetId === undefined ? true : Boolean(overrides.assetId),
      allAreasConfigured: areas.length > 0 && areas.every(area =>
        ['uri', 'message', 'postback', 'richmenuswitch'].includes(area.actionType)),
      lineAccountReady: lineAccount.exists && lineAccount.hasBotToken,
      hasInvalidActions: areas.length === 0 || areas.some(area => {
        if (area.actionType === 'uri') return !area.uri;
        if (area.actionType === 'message') return !area.text;
        if (area.actionType === 'postback') return !area.data;
        if (area.actionType === 'richmenuswitch') return !area.targetPageId;
        return true;
      }),
    },
  };
};

const issueCodes = guide => guide.issues.map(issue => issue.code);

test('PROJECT_IMAGE_MISSING blocks and focuses the image section', () => {
  const guide = evaluateGuide(context({ assetId: null }));
  assert.equal(guide.status, 'blocked');
  assert.ok(issueCodes(guide).includes('PROJECT_IMAGE_MISSING'));
  assert.equal(guide.nextAction.target, 'project-image');
});

test('PROJECT_AREA_ACTION_INCOMPLETE focuses the first area without an action', () => {
  const guide = evaluateGuide(context({ areas: [completeArea({ id: '7', actionType: 'none', uri: '' })] }));
  assert.equal(guide.status, 'incomplete');
  assert.ok(issueCodes(guide).includes('PROJECT_AREA_ACTION_INCOMPLETE'));
  assert.equal(guide.nextAction.target, 'project-area-7-action-type');
});

for (const scenario of [
  ['ACTION_URI_MISSING', completeArea({ actionType: 'uri', uri: '' }), 'project-area-1-uri'],
  ['ACTION_MESSAGE_MISSING', completeArea({ actionType: 'message', uri: '', text: '' }), 'project-area-1-message'],
  ['ACTION_POSTBACK_DATA_MISSING', completeArea({ actionType: 'postback', uri: '', data: '' }), 'project-area-1-postback-data'],
  ['ACTION_SWITCH_TARGET_MISSING', completeArea({ actionType: 'richmenuswitch', uri: '', targetPageId: '' }), 'project-area-1-switch-target'],
]) {
  test(`${scenario[0]} is deterministic and focuses its stable target`, () => {
    const guide = evaluateGuide(context({ areas: [scenario[1]] }));
    assert.ok(issueCodes(guide).includes(scenario[0]));
    assert.equal(guide.nextAction.target, scenario[2]);
  });
}

test('LINE_ACCOUNT_MISSING navigates to the existing LINE Hub', () => {
  const guide = evaluateGuide(context({
    lineAccount: { exists: false, hasBotToken: false, hasBotSecret: false, webhookEnabled: false },
  }));
  assert.ok(issueCodes(guide).includes('LINE_ACCOUNT_MISSING'));
  assert.deepEqual(guide.nextAction, {
    type: 'navigate',
    target: 'line-hub',
    message: '請先設定 LINE Official Account。',
    priority: 'high',
  });
});

test('LINE_BOT_TOKEN_MISSING never returns the token value', () => {
  const guide = evaluateGuide(context({
    lineAccount: { exists: true, hasBotToken: false, hasBotSecret: true, webhookEnabled: true },
  }));
  assert.ok(issueCodes(guide).includes('LINE_BOT_TOKEN_MISSING'));
  assert.equal(JSON.stringify(guide).includes('Bearer'), false);
});

test('complete state reports five checkpoints without mentioning publish readiness', () => {
  const guide = evaluateGuide(context());
  assert.equal(guide.status, 'complete');
  assert.deepEqual(guide.progress, { completed: 5, total: 5, percent: 100 });
  assert.equal(guide.nextAction.message, '基本設定已完成，可進行下一階段檢查。');
  assert.equal(JSON.stringify(guide).includes('可以發布'), false);
});

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    this.database.calls.push({ sql: this.sql, values });
    return this;
  }

  async first() {
    if (this.sql.includes('FROM projects')) {
      const [projectId, workspaceId] = this.values;
      const project = this.database.projects.find(row => row.id === projectId && row.workspace_id === workspaceId);
      return project || null;
    }
    if (this.sql.includes('FROM workspaces')) {
      return { id: this.values[0], name: 'Workspace A' };
    }
    if (this.sql.includes('FROM workspace_line_accounts')) return null;
    return null;
  }

  async all() {
    if (this.sql.includes('FROM project_areas')) return { results: [] };
    return { results: [] };
  }
}

class FakeDatabase {
  constructor(projects) {
    this.projects = projects;
    this.calls = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

test('Workspace A cannot load Workspace B project context', async () => {
  const db = new FakeDatabase([{ id: 'project-b', workspace_id: 'workspace-b', name: 'Private B' }]);
  const result = await buildGuideContext({
    db,
    workspaceId: 'workspace-a',
    userId: 'user-a',
    route: '/projects/project-b',
    entityType: 'project',
    entityId: 'project-b',
  });

  assert.equal(result, null);
  assert.deepEqual(db.calls[0].values, ['project-b', 'workspace-a']);
  assert.match(db.calls[0].sql, /workspace_id = \?/);
});
