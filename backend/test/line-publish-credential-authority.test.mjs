import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveProjectLinePublishCredential } from '../src/project-line-publish-credential.ts';

const backend = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const guideContext = await readFile(new URL('../src/guide/context.ts', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const publishRoute = backend.slice(
  backend.indexOf("app.post('/api/projects/:projectId/publish'"),
  backend.indexOf("app.post('/api/projects/:projectId/set-default'"),
);
const lineHubReadRoute = backend.slice(
  backend.indexOf("app.get('/api/line-hub'"),
  backend.indexOf("app.patch('/api/line-hub/account'"),
);

const fakeDb = ({ projects = [], accounts = [] }) => ({
  prepare(sql) {
    assert.match(sql, /FROM projects p/);
    assert.match(sql, /account\.workspace_id = p\.workspace_id/);
    return {
      bind(projectId, workspaceId) {
        return {
          async first() {
            const project = projects.find(row => row.id === projectId && row.workspaceId === workspaceId && !row.deleted);
            if (!project) return null;
            const account = accounts.find(row => row.workspaceId === project.workspaceId);
            return {
              project_id: project.id,
              workspace_id: project.workspaceId,
              line_account_id: account?.id ?? null,
              line_bot_channel_access_token: account?.token ?? null,
            };
          },
        };
      },
    };
  },
});

const tenantFixture = {
  projects: [
    { id: 'project-a', workspaceId: 'workspace-a' },
    { id: 'project-b', workspaceId: 'workspace-b' },
  ],
  accounts: [
    { id: 'account-a', workspaceId: 'workspace-a', token: 'tenant-a-secret-token' },
    { id: 'account-b', workspaceId: 'workspace-b', token: 'tenant-b-secret-token' },
  ],
};

test('Workspace A project resolves only Workspace A LINE token', async () => {
  const result = await resolveProjectLinePublishCredential(fakeDb(tenantFixture), 'workspace-a', 'project-a');
  assert.equal(result.ok, true);
  assert.equal(result.credential.lineAccountId, 'account-a');
  assert.equal(result.credential.channelAccessToken, 'tenant-a-secret-token');
});

test('Workspace B project resolves only Workspace B LINE token', async () => {
  const result = await resolveProjectLinePublishCredential(fakeDb(tenantFixture), 'workspace-b', 'project-b');
  assert.equal(result.ok, true);
  assert.equal(result.credential.lineAccountId, 'account-b');
  assert.equal(result.credential.channelAccessToken, 'tenant-b-secret-token');
});

test('Workspace A cannot resolve a Workspace B project or token', async () => {
  const result = await resolveProjectLinePublishCredential(fakeDb(tenantFixture), 'workspace-a', 'project-b');
  assert.deepEqual(result, { ok: false, code: 'PROJECT_NOT_FOUND' });
  assert.doesNotMatch(JSON.stringify(result), /tenant-b-secret-token/);
});

test('project without a connected LINE account is blocked', async () => {
  const result = await resolveProjectLinePublishCredential(
    fakeDb({ projects: [{ id: 'project-a', workspaceId: 'workspace-a' }] }),
    'workspace-a',
    'project-a',
  );
  assert.deepEqual(result, { ok: false, code: 'LINE_ACCOUNT_NOT_CONNECTED' });
});

test('connected LINE account without a stored token is blocked', async () => {
  const result = await resolveProjectLinePublishCredential(fakeDb({
    projects: [{ id: 'project-a', workspaceId: 'workspace-a' }],
    accounts: [{ id: 'account-a', workspaceId: 'workspace-a', token: '' }],
  }), 'workspace-a', 'project-a');
  assert.deepEqual(result, { ok: false, code: 'LINE_ACCOUNT_TOKEN_MISSING' });
});

test('stored account token reaches every LINE publish client call', () => {
  assert.equal((publishRoute.match(/Bearer \$\{channelAccessToken\}/g) || []).length, 2);
  assert.match(publishRoute, /upsertRichMenuAlias\([\s\S]*?channelAccessToken/);
  assert.match(publishRoute, /setDefaultRichMenu\(fetch, channelAccessToken, richMenuId\)/);
});

test('Tenant Project publish does not require the global token binding', () => {
  assert.doesNotMatch(publishRoute, /LINE_CHANNEL_ACCESS_TOKEN/);
  assert.match(publishRoute, /resolveProjectLinePublishCredential/);
});

test('frontend and LINE Hub read projection never receive the stored token', () => {
  assert.match(lineHubReadRoute, /hasBotToken: Boolean\(account\.line_bot_channel_access_token\)/);
  assert.doesNotMatch(lineHubReadRoute, /lineBotChannelAccessToken\s*:/);
  assert.doesNotMatch(frontend.slice(frontend.indexOf('const safePublishErrorMessage'), frontend.indexOf('const ProjectEditorView')), /LINE_CHANNEL_ACCESS_TOKEN/);
});

test('readiness and publish use the same workspace-scoped account token field', () => {
  assert.match(guideContext, /FROM workspace_line_accounts[\s\S]*WHERE workspace_id = \?/);
  assert.match(guideContext, /line_bot_channel_access_token/);
  assert.match(publishRoute, /resolveProjectLinePublishCredential\([\s\S]*workspaceId[\s\S]*projectId/);
});

test('account-scoped missing and unusable credential messages expose no env name', () => {
  assert.match(publishRoute, /目前連結的 LINE 官方帳號尚未設定 Messaging API Bot Token。/);
  assert.match(publishRoute, /LINE 官方帳號的 Messaging API 設定無法使用，請重新確認帳號設定。/);
  assert.doesNotMatch(publishRoute, /LINE_CHANNEL_ACCESS_TOKEN/);
});

test('provider response bodies and raw exception messages are absent from publish errors and logs', () => {
  assert.doesNotMatch(publishRoute, /createRes\.text\(\)|uploadRes\.text\(\)/);
  assert.doesNotMatch(publishRoute, /console\.error\([^)]*\be\b/);
  assert.doesNotMatch(publishRoute, /error:\s*e\?\.message/);
  assert.match(publishRoute, /code: \['FORBIDDEN_ROLE'/);
});

test('existing LINE account setup remains workspace-scoped and stores only server-side', () => {
  const saveRoute = backend.slice(
    backend.indexOf("app.patch('/api/line-hub/account'"),
    backend.indexOf("app.patch('/api/line-hub/targets/"),
  );
  assert.match(saveRoute, /WHERE id = \? AND workspace_id = \?/);
  assert.match(saveRoute, /line_bot_channel_access_token = COALESCE/);
  assert.doesNotMatch(saveRoute, /return c\.json\([\s\S]*line_bot_channel_access_token/);
});
