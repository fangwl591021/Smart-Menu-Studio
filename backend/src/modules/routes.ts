import {
  listWorkspaceModuleAvailability,
  requireWorkspaceModule,
  safeWorkspaceModuleCatalog,
  setWorkspaceModuleStatus,
  tenantModuleForPath,
  workspaceModuleKey,
} from './entitlements';

export const MODULE_DISABLED_HTTP_STATUS = 403;
export const MODULE_DISABLED_RESPONSE = Object.freeze({
  success: false,
  error: 'MODULE_NOT_ENABLED',
  message: '此工作區尚未啟用此功能模組。',
});

async function resolveWorkspaceBySafeReference(db: D1Database, safeReference: string) {
  return db.prepare(`
    SELECT id
    FROM workspaces
    WHERE slug = ? AND deleted_at IS NULL
    LIMIT 1
  `).bind(safeReference).first<{ id: string }>();
}

export function registerModuleEntitlementRoutes(app: any, deps: {
  requireSystemAdmin: (c: any) => Promise<{ id: string }>;
  workspaceIdOf: (c: any) => string;
  text: (value: unknown, maxLength?: number) => string;
}) {
  app.use('/api/*', async (c: any, next: () => Promise<void>) => {
    if (c.req.path.startsWith('/api/member/')) return next();
    const moduleKey = tenantModuleForPath(c.req.path);
    if (!moduleKey) return next();
    try {
      await requireWorkspaceModule({ db: c.env.smart_menu_db, workspaceId: deps.workspaceIdOf(c), moduleKey });
      return next();
    } catch (error) {
      if (error instanceof Error && (error.message === 'MODULE_NOT_ENABLED' || error.message === 'MODULE_DEPENDENCY_NOT_ENABLED')) {
        return c.json(MODULE_DISABLED_RESPONSE, MODULE_DISABLED_HTTP_STATUS);
      }
      throw error;
    }
  });

  app.get('/api/system/modules', async (c: any) => {
    try {
      await deps.requireSystemAdmin(c);
      return c.json({ success: true, modules: safeWorkspaceModuleCatalog() });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return c.json({ success: false, error: code === 'SYSTEM_ADMIN_REQUIRED' ? 'SYSTEM_ADMIN_REQUIRED' : 'MODULE_CATALOG_READ_FAILED' }, code === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500);
    }
  });

  app.get('/api/system/workspaces/:safeWorkspaceReference/modules', async (c: any) => {
    try {
      await deps.requireSystemAdmin(c);
      const workspace = await resolveWorkspaceBySafeReference(c.env.smart_menu_db, deps.text(c.req.param('safeWorkspaceReference'), 100));
      if (!workspace) return c.json({ success: false, error: 'WORKSPACE_NOT_FOUND' }, 404);
      const availability = await listWorkspaceModuleAvailability(c.env.smart_menu_db, workspace.id);
      const byKey = new Map(availability.map(module => [module.moduleKey, module.enabled]));
      return c.json({
        success: true,
        modules: safeWorkspaceModuleCatalog().map(module => ({
          moduleKey: module.moduleKey,
          label: module.label,
          description: module.description,
          enabled: byKey.get(module.moduleKey) === true,
        })),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return c.json({ success: false, error: code === 'SYSTEM_ADMIN_REQUIRED' ? 'SYSTEM_ADMIN_REQUIRED' : 'WORKSPACE_MODULE_LIST_FAILED' }, code === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500);
    }
  });

  app.post('/api/system/workspaces/:safeWorkspaceReference/modules/:moduleKey/status', async (c: any) => {
    try {
      const actor = await deps.requireSystemAdmin(c);
      const moduleKey = workspaceModuleKey(c.req.param('moduleKey'));
      const body: any = await c.req.json().catch(() => ({}));
      if (typeof body.enabled !== 'boolean' || Object.keys(body).some(key => key !== 'enabled')) {
        return c.json({ success: false, error: 'INVALID_MODULE_STATUS_INPUT' }, 400);
      }
      const workspace = await resolveWorkspaceBySafeReference(c.env.smart_menu_db, deps.text(c.req.param('safeWorkspaceReference'), 100));
      if (!workspace) return c.json({ success: false, error: 'WORKSPACE_NOT_FOUND' }, 404);
      const result = await setWorkspaceModuleStatus({
        db: c.env.smart_menu_db,
        workspaceId: workspace.id,
        moduleKey,
        enabled: body.enabled,
        actorUserId: actor.id,
      });
      return c.json({ success: true, module: result, idempotent: !result.changed });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'SYSTEM_ADMIN_REQUIRED') return c.json({ success: false, error: code }, 403);
      if (code === 'INVALID_MODULE_KEY') return c.json({ success: false, error: code }, 400);
      if (code === 'MODULE_DEPENDENCY_NOT_ENABLED') return c.json({ success: false, error: code }, 409);
      return c.json({ success: false, error: 'WORKSPACE_MODULE_UPDATE_FAILED' }, 500);
    }
  });

  app.get('/api/workspace/modules', async (c: any) => {
    try {
      const modules = await listWorkspaceModuleAvailability(c.env.smart_menu_db, deps.workspaceIdOf(c));
      return c.json({
        success: true,
        modules: modules.map(module => ({ moduleKey: module.moduleKey, enabled: module.enabled })),
      });
    } catch {
      return c.json({ success: false, error: 'WORKSPACE_MODULE_LIST_FAILED' }, 500);
    }
  });
}
