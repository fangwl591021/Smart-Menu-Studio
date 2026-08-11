export const WORKSPACE_MODULE_CATALOG = [
  {
    moduleKey: 'CORE_MENU',
    label: '圖文選單',
    description: '圖文選單專案、範本、素材與發布管理。',
  },
  {
    moduleKey: 'CRM',
    label: 'CRM 顧客管理',
    description: '顧客、標籤、洞察、分群、流程與追蹤管理。',
  },
  {
    moduleKey: 'CAMPAIGN',
    label: '行銷活動',
    description: '活動內容、受眾、準備、執行與發送紀錄。',
  },
  {
    moduleKey: 'COMMERCE',
    label: '電商',
    description: '商品、訂單、付款與轉換管理。',
  },
  {
    moduleKey: 'TRAVEL',
    label: '旅遊管理',
    description: '保留給未來旅遊行程與旅遊商務擴充。',
  },
  {
    moduleKey: 'DEALER_COMMISSION',
    label: '經銷與佣金',
    description: '經銷商、佣金、結算與請款管理。',
  },
  {
    moduleKey: 'POINTS_REWARDS',
    label: '點數與獎勵',
    description: '點數、獎勵、貢獻與等級管理。',
  },
  {
    moduleKey: 'AI',
    label: 'AI 功能',
    description: 'AI 生成、建議與智慧輔助功能。',
  },
] as const;

export type WorkspaceModuleKey = typeof WORKSPACE_MODULE_CATALOG[number]['moduleKey'];
export type WorkspaceModuleStatus = 'ENABLED' | 'DISABLED';

export type WorkspaceModuleAvailability = {
  moduleKey: WorkspaceModuleKey;
  enabled: boolean;
  source: 'EXPLICIT' | 'LEGACY_COMPATIBILITY';
};

const MODULE_KEYS = new Set<string>(WORKSPACE_MODULE_CATALOG.map(module => module.moduleKey));

export const WORKSPACE_MODULE_DEPENDENCIES: Readonly<Partial<Record<WorkspaceModuleKey, readonly WorkspaceModuleKey[]>>> = {
  CAMPAIGN: ['CRM'],
  TRAVEL: ['COMMERCE'],
};

export function isWorkspaceModuleKey(value: unknown): value is WorkspaceModuleKey {
  return typeof value === 'string' && MODULE_KEYS.has(value);
}

export function workspaceModuleKey(value: unknown): WorkspaceModuleKey {
  const normalized = String(value || '').trim().toUpperCase();
  if (!isWorkspaceModuleKey(normalized)) throw new Error('INVALID_MODULE_KEY');
  return normalized;
}

export function safeWorkspaceModuleCatalog() {
  return WORKSPACE_MODULE_CATALOG.map(module => ({ ...module }));
}

export async function listWorkspaceModuleAvailability(
  db: D1Database,
  workspaceId: string,
): Promise<WorkspaceModuleAvailability[]> {
  const result = await db.prepare(`
    SELECT module_key, status
    FROM workspace_module_entitlements
    WHERE workspace_id = ?
  `).bind(workspaceId).all<{ module_key: string; status: WorkspaceModuleStatus }>();
  const explicit = new Map((result.results || []).map(row => [row.module_key, row.status]));

  return WORKSPACE_MODULE_CATALOG.map(module => {
    const status = explicit.get(module.moduleKey);
    return {
      moduleKey: module.moduleKey,
      enabled: status ? status === 'ENABLED' : true,
      source: status ? 'EXPLICIT' : 'LEGACY_COMPATIBILITY',
    };
  });
}

export async function requireWorkspaceModule(input: {
  db: D1Database;
  workspaceId: string;
  moduleKey: WorkspaceModuleKey;
}): Promise<WorkspaceModuleAvailability> {
  const readAvailability = async (moduleKey: WorkspaceModuleKey): Promise<WorkspaceModuleAvailability> => {
    const row = await input.db.prepare(`
      SELECT status
      FROM workspace_module_entitlements
      WHERE workspace_id = ? AND module_key = ?
      LIMIT 1
    `).bind(input.workspaceId, moduleKey).first<{ status: WorkspaceModuleStatus }>();
    return row
      ? { moduleKey, enabled: row.status === 'ENABLED', source: 'EXPLICIT' }
      : { moduleKey, enabled: true, source: 'LEGACY_COMPATIBILITY' };
  };
  const availability = await readAvailability(input.moduleKey);
  if (!availability.enabled) throw new Error('MODULE_NOT_ENABLED');
  for (const dependency of WORKSPACE_MODULE_DEPENDENCIES[input.moduleKey] || []) {
    if (!(await readAvailability(dependency)).enabled) throw new Error('MODULE_DEPENDENCY_NOT_ENABLED');
  }
  return availability;
}

export function newWorkspaceModuleEntitlementStatements(
  db: D1Database,
  workspaceId: string,
): D1PreparedStatement[] {
  return WORKSPACE_MODULE_CATALOG.map(module => {
    const status: WorkspaceModuleStatus = module.moduleKey === 'CORE_MENU' ? 'ENABLED' : 'DISABLED';
    return db.prepare(`
      INSERT INTO workspace_module_entitlements (
        id, workspace_id, module_key, status, enabled_at, disabled_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      `wme_${crypto.randomUUID()}`,
      workspaceId,
      module.moduleKey,
      status,
      status === 'ENABLED' ? new Date().toISOString() : null,
      status === 'DISABLED' ? new Date().toISOString() : null,
    );
  });
}

export async function setWorkspaceModuleStatus(input: {
  db: D1Database;
  workspaceId: string;
  moduleKey: WorkspaceModuleKey;
  enabled: boolean;
  actorUserId: string;
}): Promise<{ changed: boolean; moduleKey: WorkspaceModuleKey; enabled: boolean }> {
  if (input.enabled) {
    for (const dependency of WORKSPACE_MODULE_DEPENDENCIES[input.moduleKey] || []) {
      try {
        await requireWorkspaceModule({ db: input.db, workspaceId: input.workspaceId, moduleKey: dependency });
      } catch (error) {
        if (error instanceof Error && (error.message === 'MODULE_NOT_ENABLED' || error.message === 'MODULE_DEPENDENCY_NOT_ENABLED')) {
          throw new Error('MODULE_DEPENDENCY_NOT_ENABLED');
        }
        throw error;
      }
    }
  }
  const existing = await input.db.prepare(`
    SELECT id, status
    FROM workspace_module_entitlements
    WHERE workspace_id = ? AND module_key = ?
    LIMIT 1
  `).bind(input.workspaceId, input.moduleKey).first<{ id: string; status: WorkspaceModuleStatus }>();
  const targetStatus: WorkspaceModuleStatus = input.enabled ? 'ENABLED' : 'DISABLED';
  const currentStatus: WorkspaceModuleStatus = existing?.status || 'ENABLED';
  if (currentStatus === targetStatus) {
    return { changed: false, moduleKey: input.moduleKey, enabled: input.enabled };
  }

  const occurredAt = new Date().toISOString();
  const entitlementStatement = existing
    ? input.db.prepare(`
        UPDATE workspace_module_entitlements
        SET status = ?,
            granted_by_user_id = CASE WHEN ? = 'ENABLED' THEN ? ELSE granted_by_user_id END,
            enabled_at = CASE WHEN ? = 'ENABLED' THEN ? ELSE enabled_at END,
            disabled_at = CASE WHEN ? = 'DISABLED' THEN ? ELSE NULL END,
            updated_at = ?
        WHERE id = ? AND workspace_id = ? AND module_key = ?
      `).bind(
        targetStatus,
        targetStatus,
        input.actorUserId,
        targetStatus,
        occurredAt,
        targetStatus,
        occurredAt,
        occurredAt,
        existing.id,
        input.workspaceId,
        input.moduleKey,
      )
    : input.db.prepare(`
        INSERT INTO workspace_module_entitlements (
          id, workspace_id, module_key, status, granted_by_user_id,
          enabled_at, disabled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `wme_${crypto.randomUUID()}`,
        input.workspaceId,
        input.moduleKey,
        targetStatus,
        input.enabled ? input.actorUserId : null,
        input.enabled ? occurredAt : null,
        input.enabled ? null : occurredAt,
        occurredAt,
        occurredAt,
      );

  const eventType = input.enabled ? 'MODULE_ENABLED' : 'MODULE_DISABLED';
  await input.db.batch([
    entitlementStatement,
    input.db.prepare(`
      INSERT INTO workspace_module_entitlement_events (
        id, workspace_id, module_key, event_type, from_status, to_status,
        actor_user_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `wmee_${crypto.randomUUID()}`,
      input.workspaceId,
      input.moduleKey,
      eventType,
      existing ? currentStatus : 'LEGACY_ENABLED',
      targetStatus,
      input.actorUserId,
      occurredAt,
    ),
  ]);

  return { changed: true, moduleKey: input.moduleKey, enabled: input.enabled };
}

export function tenantModuleForPath(path: string): WorkspaceModuleKey | null {
  if (path === '/api/detect-layout'
    || path === '/api/ai-usage/summary'
    || path.startsWith('/api/referral-growth/recommendations/')
    || (/^\/api\/projects\/[^/]+\/(guide|proposals|operation-plans)(?:\/|$)/).test(path)) {
    return 'AI';
  }
  if (path === '/api/projects' || path.startsWith('/api/projects/')
    || path === '/api/templates' || path.startsWith('/api/templates/')
    || path.startsWith('/api/assets/')) return 'CORE_MENU';
  if (path === '/api/crm' || path.startsWith('/api/crm/')) return 'CRM';
  if (path === '/api/campaigns' || path.startsWith('/api/campaigns/')
    || path === '/api/campaign' || path.startsWith('/api/campaign/')) return 'CAMPAIGN';
  if ((path === '/api/commerce' || path.startsWith('/api/commerce/'))
    && path !== '/api/commerce/payments/newebpay/notify') return 'COMMERCE';
  if (path === '/api/travel' || path.startsWith('/api/travel/')) return 'TRAVEL';
  if (path === '/api/dealers' || path.startsWith('/api/dealers/')
    || path === '/api/commission' || path.startsWith('/api/commission-')) return 'DEALER_COMMISSION';
  if (path.startsWith('/api/point-') || path.startsWith('/api/points-')
    || path.startsWith('/api/tier-') || path.startsWith('/api/contribution-')) return 'POINTS_REWARDS';
  return null;
}
