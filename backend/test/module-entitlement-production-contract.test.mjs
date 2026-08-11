import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  resolveSystemWorkspaceInternalId,
  safeSystemWorkspaceSummaries,
} from '../src/modules/system-workspaces.ts';

const [indexSource, routeSource] = await Promise.all([
  readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/modules/routes.ts', import.meta.url), 'utf8'),
]);
test('8A-B disabled module response keeps exact status code and zh-TW message', () => {
  assert.match(routeSource, /MODULE_DISABLED_HTTP_STATUS = 403/);
  assert.match(routeSource, /success: false,[\s\S]*error: 'MODULE_NOT_ENABLED',[\s\S]*message: '此工作區尚未啟用此功能模組。'/);
  assert.match(routeSource, /c\.json\(MODULE_DISABLED_RESPONSE, MODULE_DISABLED_HTTP_STATUS\)/);
});

test('8A-B system workspace summary is an exact minimized safe projection', () => {
  const [workspace] = safeSystemWorkspaceSummaries([{
    id: 'workspace-internal',
    workspace_id: 'workspace-internal',
    owner_user_id: 'user-internal',
    plan: 'enterprise',
    slug: 'safe-workspace',
    name: 'Safe Workspace',
    company_name: 'Safe Company',
    status: 'active',
    member_count: 3,
    active_webhook_count: 2,
  }]);

  assert.deepEqual(workspace, {
    slug: 'safe-workspace',
    name: 'Safe Workspace',
    company_name: 'Safe Company',
    status: 'active',
    member_count: 3,
    active_webhook_count: 2,
  });
  assert.deepEqual(Object.keys(workspace), [
    'slug',
    'name',
    'company_name',
    'status',
    'member_count',
    'active_webhook_count',
  ]);
});

test('8A-B system workspace summary exposes no internal or billing fields', () => {
  const [workspace] = safeSystemWorkspaceSummaries([{
    id: 'workspace-internal',
    workspace_id: 'workspace-internal',
    owner_user_id: 'user-internal',
    granted_by_user_id: 'user-internal',
    plan: 'enterprise',
    billing_customer_id: 'billing-internal',
    slug: 'safe-workspace',
    name: 'Safe Workspace',
    status: 'active',
  }]);
  for (const forbidden of [
    'id',
    'workspace_id',
    'workspaceId',
    'owner_user_id',
    'granted_by_user_id',
    'plan',
    'billing_customer_id',
  ]) {
    assert.equal(Object.hasOwn(workspace, forbidden), false, `must not expose ${forbidden}`);
  }
});

test('8A-B safe workspace reference resolves slug server-side only', async () => {
  const observed = { sql: '', values: [] };
  const db = {
    prepare(sql) {
      observed.sql = sql;
      return {
        bind(...values) {
          observed.values = values;
          return this;
        },
        async first() {
          return { id: 'workspace-internal' };
        },
      };
    },
  };

  assert.equal(await resolveSystemWorkspaceInternalId(db, 'safe-workspace'), 'workspace-internal');
  assert.match(observed.sql, /WHERE slug = \? AND deleted_at IS NULL/);
  assert.deepEqual(observed.values, ['safe-workspace']);
});

test('8A-B system workspace list authenticates before reading and applies safe projection', () => {
  const start = indexSource.indexOf("app.get('/api/system/workspaces',");
  const end = indexSource.indexOf("app.get('/api/system/workspaces/:safeWorkspaceReference',", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = indexSource.slice(start, end);
  assert.ok(route.indexOf('await requireSystemAdmin(c)') < route.indexOf('smart_menu_db.prepare'));
  assert.match(route, /workspaces: safeSystemWorkspaceSummaries/);
  assert.doesNotMatch(route, /workspaces:\s*r\.results/);
});

test('8A-B System Admin workspace routes accept only safe workspace reference externally', () => {
  assert.match(indexSource, /\/api\/system\/workspaces\/:safeWorkspaceReference/);
  assert.doesNotMatch(indexSource, /\/api\/system\/workspaces\/:workspaceId/);
  assert.match(indexSource, /resolveSystemWorkspaceInternalId\(c\.env\.smart_menu_db, safeWorkspaceReference\)/);
});

test('8A-B workspace list keeps safe slug and display-name concepts', () => {
  const [workspace] = safeSystemWorkspaceSummaries([{
    slug: 'safe-workspace',
    name: 'Workspace Name',
    company_name: 'Display Company',
    status: 'active',
  }]);
  assert.equal(workspace.slug, 'safe-workspace');
  assert.equal(workspace.name, 'Workspace Name');
  assert.equal(workspace.company_name, 'Display Company');
});

test('8A-B module routes keep safe slug authority for reads and mutations', async () => {
  assert.match(routeSource, /:safeWorkspaceReference\/modules'/);
  assert.match(routeSource, /:safeWorkspaceReference\/modules\/:moduleKey\/status'/);
  assert.match(routeSource, /WHERE slug = \? AND deleted_at IS NULL/);
  assert.doesNotMatch(routeSource, /:workspaceId\/modules/);
});