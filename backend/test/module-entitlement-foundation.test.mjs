import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WORKSPACE_MODULE_CATALOG,
  listWorkspaceModuleAvailability,
  newWorkspaceModuleEntitlementStatements,
  requireWorkspaceModule,
  setWorkspaceModuleStatus,
  tenantModuleForPath,
  workspaceModuleKey,
} from '../src/modules/entitlements.ts';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [migration, entitlementSource, routeSource, indexSource, commerceMemberRoutes, policy] = await Promise.all([
  read('../migrations/0049_workspace_module_entitlements.sql'),
  read('../src/modules/entitlements.ts'),
  read('../src/modules/routes.ts'),
  read('../src/index.ts'),
  read('../src/commerce/member-routes.ts'),
  read('../docs/8a-module-entitlement-policy.md'),
]);

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.values = [];
  }

  bind(...values) { this.values = values; return this; }

  async all() {
    if (this.sql.includes('SELECT module_key, status')) {
      const workspaceId = this.values[0];
      return {
        results: [...this.database.entitlements.values()]
          .filter(row => row.workspaceId === workspaceId)
          .map(row => ({ module_key: row.moduleKey, status: row.status })),
      };
    }
    throw new Error(`Unexpected all: ${this.sql}`);
  }

  async first() {
    const [workspaceId, moduleKey] = this.values;
    const row = this.database.entitlements.get(`${workspaceId}:${moduleKey}`);
    if (!row) return null;
    if (this.sql.startsWith('SELECT id, status')) return { id: row.id, status: row.status };
    if (this.sql.startsWith('SELECT status')) return { status: row.status };
    throw new Error(`Unexpected first: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith('INSERT INTO workspace_module_entitlements')) {
      const [id, workspaceId, moduleKey, status] = this.values;
      const key = `${workspaceId}:${moduleKey}`;
      if (this.database.entitlements.has(key)) throw new Error('UNIQUE');
      this.database.entitlements.set(key, { id, workspaceId, moduleKey, status });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('UPDATE workspace_module_entitlements')) {
      const status = this.values[0];
      const workspaceId = this.values.at(-2);
      const moduleKey = this.values.at(-1);
      const key = `${workspaceId}:${moduleKey}`;
      const row = this.database.entitlements.get(key);
      if (!row) return { meta: { changes: 0 } };
      row.status = status;
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('INSERT INTO workspace_module_entitlement_events')) {
      this.database.events.push({
        workspaceId: this.values[1],
        moduleKey: this.values[2],
        eventType: this.values[3],
        fromStatus: this.values[4],
        toStatus: this.values[5],
      });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run: ${this.sql}`);
  }
}

class FakeDb {
  constructor(rows = []) {
    this.entitlements = new Map(rows.map(row => [`${row.workspaceId}:${row.moduleKey}`, { id: row.id || crypto.randomUUID(), ...row }]));
    this.events = [];
  }
  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(statements) { for (const statement of statements) await statement.run(); }
}

const expectedKeys = ['CORE_MENU', 'CRM', 'CAMPAIGN', 'COMMERCE', 'TRAVEL', 'DEALER_COMMISSION', 'POINTS_REWARDS', 'AI'];
for (const moduleKey of expectedKeys) {
  test(`catalog contains ${moduleKey}`, () => assert.ok(WORKSPACE_MODULE_CATALOG.some(module => module.moduleKey === moduleKey)));
}

test('catalog contains only canonical keys', () => assert.deepEqual(WORKSPACE_MODULE_CATALOG.map(module => module.moduleKey), expectedKeys));
test('invalid module key is rejected', () => assert.throws(() => workspaceModuleKey('CUSTOM'), /INVALID_MODULE_KEY/));
test('module keys normalize case safely', () => assert.equal(workspaceModuleKey('commerce'), 'COMMERCE'));
test('catalog metadata has safe zh-TW labels and descriptions', () => assert.ok(WORKSPACE_MODULE_CATALOG.every(module => module.label && module.description)));

test('legacy workspace without rows keeps all modules enabled', async () => {
  const modules = await listWorkspaceModuleAvailability(new FakeDb(), 'legacy');
  assert.ok(modules.every(module => module.enabled && module.source === 'LEGACY_COMPATIBILITY'));
});

test('new workspace statements initialize exactly eight modules', () => {
  const statements = newWorkspaceModuleEntitlementStatements(new FakeDb(), 'new-workspace');
  assert.equal(statements.length, 8);
});

test('new workspace default enables only CORE_MENU', async () => {
  const db = new FakeDb();
  await db.batch(newWorkspaceModuleEntitlementStatements(db, 'new-workspace'));
  const modules = await listWorkspaceModuleAvailability(db, 'new-workspace');
  assert.deepEqual(modules.filter(module => module.enabled).map(module => module.moduleKey), ['CORE_MENU']);
});

test('explicit disabled module is denied', async () => {
  const db = new FakeDb([{ workspaceId: 'a', moduleKey: 'CRM', status: 'DISABLED' }]);
  await assert.rejects(() => requireWorkspaceModule({ db, workspaceId: 'a', moduleKey: 'CRM' }), /MODULE_NOT_ENABLED/);
});

test('explicit enabled module is allowed', async () => {
  const db = new FakeDb([{ workspaceId: 'a', moduleKey: 'CRM', status: 'ENABLED' }]);
  assert.equal((await requireWorkspaceModule({ db, workspaceId: 'a', moduleKey: 'CRM' })).enabled, true);
});

test('workspace A entitlement is independent from workspace B', async () => {
  const db = new FakeDb([
    { workspaceId: 'a', moduleKey: 'COMMERCE', status: 'DISABLED' },
    { workspaceId: 'b', moduleKey: 'COMMERCE', status: 'ENABLED' },
  ]);
  await assert.rejects(() => requireWorkspaceModule({ db, workspaceId: 'a', moduleKey: 'COMMERCE' }), /MODULE_NOT_ENABLED/);
  assert.equal((await requireWorkspaceModule({ db, workspaceId: 'b', moduleKey: 'COMMERCE' })).enabled, true);
});

test('disable legacy-enabled module creates explicit disabled row and audit event', async () => {
  const db = new FakeDb();
  const result = await setWorkspaceModuleStatus({ db, workspaceId: 'a', moduleKey: 'CRM', enabled: false, actorUserId: 'system' });
  assert.equal(result.changed, true);
  assert.equal(db.entitlements.get('a:CRM').status, 'DISABLED');
  assert.deepEqual(db.events[0], { workspaceId: 'a', moduleKey: 'CRM', eventType: 'MODULE_DISABLED', fromStatus: 'LEGACY_ENABLED', toStatus: 'DISABLED' });
});

test('repeated disable is idempotent and creates no duplicate event', async () => {
  const db = new FakeDb([{ workspaceId: 'a', moduleKey: 'CRM', status: 'DISABLED' }]);
  const result = await setWorkspaceModuleStatus({ db, workspaceId: 'a', moduleKey: 'CRM', enabled: false, actorUserId: 'system' });
  assert.equal(result.changed, false);
  assert.equal(db.events.length, 0);
});

test('enable already legacy-enabled is an idempotent no-op', async () => {
  const db = new FakeDb();
  const result = await setWorkspaceModuleStatus({ db, workspaceId: 'a', moduleKey: 'CRM', enabled: true, actorUserId: 'system' });
  assert.equal(result.changed, false);
  assert.equal(db.entitlements.size, 0);
});

test('re-enable restores access and records audit event', async () => {
  const db = new FakeDb([{ workspaceId: 'a', moduleKey: 'CRM', status: 'DISABLED' }]);
  await setWorkspaceModuleStatus({ db, workspaceId: 'a', moduleKey: 'CRM', enabled: true, actorUserId: 'system' });
  assert.equal((await requireWorkspaceModule({ db, workspaceId: 'a', moduleKey: 'CRM' })).enabled, true);
  assert.equal(db.events[0].eventType, 'MODULE_ENABLED');
});

test('CAMPAIGN enable fails closed when CRM dependency is disabled', async () => {
  const db = new FakeDb([
    { workspaceId: 'a', moduleKey: 'CRM', status: 'DISABLED' },
    { workspaceId: 'a', moduleKey: 'CAMPAIGN', status: 'DISABLED' },
  ]);
  await assert.rejects(
    () => setWorkspaceModuleStatus({ db, workspaceId: 'a', moduleKey: 'CAMPAIGN', enabled: true, actorUserId: 'system' }),
    /MODULE_DEPENDENCY_NOT_ENABLED/,
  );
  assert.equal(db.entitlements.get('a:CAMPAIGN').status, 'DISABLED');
});

test('CAMPAIGN runtime access fails closed if CRM is later disabled', async () => {
  const db = new FakeDb([
    { workspaceId: 'a', moduleKey: 'CRM', status: 'DISABLED' },
    { workspaceId: 'a', moduleKey: 'CAMPAIGN', status: 'ENABLED' },
  ]);
  await assert.rejects(() => requireWorkspaceModule({ db, workspaceId: 'a', moduleKey: 'CAMPAIGN' }), /MODULE_DEPENDENCY_NOT_ENABLED/);
});

test('TRAVEL enable requires both CRM and COMMERCE without auto-enable', async () => {
  const db = new FakeDb([
    { workspaceId: 'a', moduleKey: 'CRM', status: 'ENABLED' },
    { workspaceId: 'a', moduleKey: 'COMMERCE', status: 'DISABLED' },
    { workspaceId: 'a', moduleKey: 'TRAVEL', status: 'DISABLED' },
  ]);
  await assert.rejects(
    () => setWorkspaceModuleStatus({ db, workspaceId: 'a', moduleKey: 'TRAVEL', enabled: true, actorUserId: 'system' }),
    /MODULE_DEPENDENCY_NOT_ENABLED/,
  );
  assert.equal(db.entitlements.get('a:COMMERCE').status, 'DISABLED');
});

const routeMappings = [
  ['/api/projects', 'CORE_MENU'],
  ['/api/templates/template-safe', 'CORE_MENU'],
  ['/api/crm/people', 'CRM'],
  ['/api/campaign/audiences', 'CAMPAIGN'],
  ['/api/campaigns/campaign-safe/execute', 'CAMPAIGN'],
  ['/api/commerce/products', 'COMMERCE'],
  ['/api/dealers', 'DEALER_COMMISSION'],
  ['/api/commission-settlements', 'DEALER_COMMISSION'],
  ['/api/points-summary', 'POINTS_REWARDS'],
  ['/api/contribution-rules', 'POINTS_REWARDS'],
  ['/api/detect-layout', 'AI'],
  ['/api/projects/project-safe/guide', 'AI'],
];
for (const [path, moduleKey] of routeMappings) {
  test(`${path} maps to ${moduleKey}`, () => assert.equal(tenantModuleForPath(path), moduleKey));
}

test('verified NewebPay notify is an integrity exception', () => assert.equal(tenantModuleForPath('/api/commerce/payments/newebpay/notify'), null));
test('system routes are not tenant module-gated', () => assert.equal(tenantModuleForPath('/api/system/workspaces/safe/modules'), null));
test('workspace module read route is not self-gated', () => assert.equal(tenantModuleForPath('/api/workspace/modules'), null));
test('TRAVEL has no business route mapping', () => assert.equal(tenantModuleForPath('/api/travel/itineraries'), null));

test('TRAVEL entitlement can be disabled and re-enabled without a Travel business route', async () => {
  const db = new FakeDb();
  await setWorkspaceModuleStatus({ db, workspaceId: 'a', moduleKey: 'TRAVEL', enabled: false, actorUserId: 'system' });
  await assert.rejects(() => requireWorkspaceModule({ db, workspaceId: 'a', moduleKey: 'TRAVEL' }), /MODULE_NOT_ENABLED/);
  await setWorkspaceModuleStatus({ db, workspaceId: 'a', moduleKey: 'TRAVEL', enabled: true, actorUserId: 'system' });
  assert.equal((await requireWorkspaceModule({ db, workspaceId: 'a', moduleKey: 'TRAVEL' })).enabled, true);
});

const sourceContracts = [
  ['System Admin catalog endpoint exists', routeSource, /app\.get\('\/api\/system\/modules'/],
  ['System Admin workspace module list exists', routeSource, /:safeWorkspaceReference\/modules'/],
  ['System Admin status mutation exists', routeSource, /:safeWorkspaceReference\/modules\/:moduleKey\/status'/],
  ['System Admin authority is reused', routeSource, /deps\.requireSystemAdmin\(c\)/],
  ['Tenant owner cannot mutate entitlement', routeSource, /const actor = await deps\.requireSystemAdmin\(c\)/],
  ['Tenant admin cannot mutate entitlement', routeSource, /const actor = await deps\.requireSystemAdmin\(c\)/],
  ['Tenant editor cannot mutate entitlement', routeSource, /const actor = await deps\.requireSystemAdmin\(c\)/],
  ['Tenant viewer cannot mutate entitlement', routeSource, /const actor = await deps\.requireSystemAdmin\(c\)/],
  ['safe workspace slug is the lookup authority', routeSource, /WHERE slug = \? AND deleted_at IS NULL/],
  ['status input is exact boolean-only', routeSource, /typeof body\.enabled !== 'boolean'.*Object\.keys\(body\).*key !== 'enabled'/s],
  ['dependency conflict is safe and explicit', routeSource, /MODULE_DEPENDENCY_NOT_ENABLED'.*409/s],
  ['Tenant safe module endpoint exists', routeSource, /app\.get\('\/api\/workspace\/modules'/],
  ['Tenant response is key and enabled only', routeSource, /modules\.map\(module => \(\{ moduleKey: module\.moduleKey, enabled: module\.enabled \}\)\)/],
  ['disabled response is 403 MODULE_NOT_ENABLED', routeSource, /MODULE_NOT_ENABLED'.*403/s],
  ['dependency-disabled response is normalized to 403 MODULE_NOT_ENABLED', routeSource, /MODULE_DEPENDENCY_NOT_ENABLED'[\s\S]*error: 'MODULE_NOT_ENABLED'[\s\S]*403/],
  ['disabled response uses safe message', routeSource, /此工作區目前未啟用這項功能/],
  ['unauthenticated boundary runs before entitlement registration', indexSource, /app\.use\('\/api\/\*'.*registerModuleEntitlementRoutes/s],
  ['new workspace defaults are wired into all three creation paths', indexSource, /newWorkspaceModuleEntitlementStatements/g],
  ['Member Self Commerce explicitly requires COMMERCE', commerceMemberRoutes, /verifiedReferralMember[\s\S]*'COMMERCE'/],
  ['Member Self Commerce preserves MODULE_NOT_ENABLED 403', commerceMemberRoutes, /code === 'MODULE_NOT_ENABLED' \? 403/],
  ['member module check occurs after LIFF verification', indexSource, /verifyLiffAccessToken[\s\S]*requiredModuleKey[\s\S]*establishMember/],
  ['module mutations only target entitlement tables', entitlementSource, /INSERT INTO workspace_module_entitlement_events/],
  ['module source does not mutate CRM business tables', entitlementSource, /^(?![\s\S]*(UPDATE|DELETE FROM) crm_)/i],
  ['module source does not mutate Commerce business tables', entitlementSource, /^(?![\s\S]*(UPDATE|DELETE FROM) commerce_)/i],
  ['module source does not mutate Campaign business tables', entitlementSource, /^(?![\s\S]*(UPDATE|DELETE FROM) campaign_)/i],
  ['module source does not mutate Referral Points or Commission business tables', entitlementSource, /^(?![\s\S]*(UPDATE|DELETE FROM) (member_referral|point_|commission_))/i],
];
for (const [name, source, pattern] of sourceContracts) test(name, () => assert.match(source, pattern));

test('all three workspace creation paths initialize explicit defaults', () => {
  assert.equal((indexSource.match(/\.\.\.newWorkspaceModuleEntitlementStatements/g) || []).length, 3);
});

test('0049 creates workspace-scoped unique entitlement rows', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS workspace_module_entitlements/);
  assert.match(migration, /UNIQUE \(workspace_id, module_key\)/);
});
test('0049 status is explicitly ENABLED or DISABLED', () => assert.match(migration, /status IN \('ENABLED', 'DISABLED'\)/));
test('0049 creates auditable module events', () => assert.match(migration, /MODULE_ENABLED', 'MODULE_DISABLED/));
test('0049 is additive with no destructive SQL statements', () => assert.doesNotMatch(migration, /^\s*(DROP|DELETE|TRUNCATE|ALTER TABLE)\b/im));
test('0049 has no business-table update or backfill', () => assert.doesNotMatch(migration, /\bUPDATE\b|INSERT INTO workspaces|SELECT .* FROM workspaces/is));
test('0049 creates no fake entitlements or Travel data', () => assert.doesNotMatch(migration, /INSERT INTO workspace_module_entitlements|travel_(itineraries|orders|customers)/i));

test('public projections expose no entitlement internal ID', () => assert.doesNotMatch(routeSource, /entitlementId/));
test('public projections expose no granted user internal ID', () => assert.doesNotMatch(routeSource, /grantedByUserId|granted_by_user_id/));
test('public projections expose no workspace internal ID', () => {
  const responseLines = routeSource.split('\\n').filter(line => line.includes('return c.json'));
  assert.ok(responseLines.every(line => !/workspaceId\\s*:/.test(line)));
});
test('public projections expose no billing data', () => assert.doesNotMatch(routeSource, /price|invoice|subscription|billing|trial|renewal/i));

test('disable semantics preserve historical data', () => assert.match(policy, /never deletes, archives, rewrites, or backfills business data/));
test('Campaign disable policy blocks new execute and resume', () => assert.match(policy, /New Campaign execute and resume requests are blocked/));
test('verified payment callback completion is documented', () => assert.match(policy, /NewebPay notify endpoint remains outside the entitlement guard/));
test('TRAVEL depends on future CRM and COMMERCE without auto-enable', () => assert.match(policy, /future `TRAVEL` requires `CRM` and `COMMERCE`/));
test('TravelKeeper is not imported', () => assert.doesNotMatch(`${indexSource}\n${entitlementSource}`, /from ['"].*travelkeeper/i));
test('Travel business tables are not created', () => assert.doesNotMatch(migration, /CREATE TABLE.*travel_/i));
