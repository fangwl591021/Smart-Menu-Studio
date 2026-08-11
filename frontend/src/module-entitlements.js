export const WORKSPACE_MODULE_KEYS = Object.freeze([
  'CORE_MENU',
  'CRM',
  'CAMPAIGN',
  'COMMERCE',
  'TRAVEL',
  'DEALER_COMMISSION',
  'POINTS_REWARDS',
  'AI',
]);

const MODULE_KEY_SET = new Set(WORKSPACE_MODULE_KEYS);

export const TENANT_VIEW_MODULE = Object.freeze({
  dashboard: 'CORE_MENU',
  projects: 'CORE_MENU',
  'project-builder': 'CORE_MENU',
  'project-editor': 'CORE_MENU',
  templates: 'CORE_MENU',
  'template-builder': 'CORE_MENU',
  crm: 'CRM',
  campaigns: 'CAMPAIGN',
  commerce: 'COMMERCE',
  'ai-usage': 'AI',
});

const TENANT_MODULE_HOME = Object.freeze([
  ['CORE_MENU', 'dashboard'],
  ['CRM', 'crm'],
  ['CAMPAIGN', 'campaigns'],
  ['COMMERCE', 'commerce'],
  ['AI', 'ai-usage'],
]);

export function moduleKeyForView(view) {
  return TENANT_VIEW_MODULE[view] || null;
}

export function normalizeWorkspaceModuleProjection(value) {
  if (!Array.isArray(value) || value.length !== WORKSPACE_MODULE_KEYS.length) {
    throw new Error('MODULE_PROJECTION_INVALID');
  }

  const projection = {};
  for (const item of value) {
    if (!item || !MODULE_KEY_SET.has(item.moduleKey) || typeof item.enabled !== 'boolean') {
      throw new Error('MODULE_PROJECTION_INVALID');
    }
    if (Object.hasOwn(projection, item.moduleKey)) throw new Error('MODULE_PROJECTION_INVALID');
    projection[item.moduleKey] = item.enabled;
  }

  if (Object.keys(projection).length !== WORKSPACE_MODULE_KEYS.length) {
    throw new Error('MODULE_PROJECTION_INVALID');
  }
  return Object.freeze(projection);
}

export function isTenantNavigationItemVisible(item, authority) {
  const moduleKey = moduleKeyForView(item.id);
  if (!moduleKey) return true;
  if (authority.status === 'ready') return authority.modules[moduleKey] === true;
  return moduleKey === 'CORE_MENU';
}

export function firstAvailableTenantView(modules) {
  for (const [moduleKey, view] of TENANT_MODULE_HOME) {
    if (modules[moduleKey] === true) return view;
  }
  return 'account';
}

export function moduleMutationErrorMessage(code) {
  if (code === 'MODULE_DEPENDENCY_NOT_ENABLED') {
    return '請先啟用此模組需要的相依功能，再重試。';
  }
  if (code === 'INVALID_MODULE_KEY' || code === 'INVALID_MODULE_STATUS_INPUT') {
    return '模組設定內容無效，請重新載入後再試。';
  }
  return '模組設定更新失敗，請稍後再試。';
}
