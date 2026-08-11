import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  WORKSPACE_MODULE_KEYS,
  firstAvailableTenantView,
  isTenantNavigationItemVisible,
  moduleKeyForView,
  normalizeWorkspaceModuleProjection,
} from '../src/module-entitlements.js';

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const [app, systemModules, toggle, provider, entitlementSource] = await Promise.all([
  read('../src/App.jsx'),
  read('../src/components/SystemWorkspaceModules.jsx'),
  read('../src/components/ModuleEntitlementToggle.jsx'),
  read('../src/components/WorkspaceModuleProvider.jsx'),
  read('../src/module-entitlements.js'),
]);
const moduleUi = `${systemModules}\n${toggle}\n${provider}\n${entitlementSource}`;

const acceptance = [
  ['System Admin navigation has module management entry', app, /id: 'modules', label: '模組管理'/],
  ['module management is in platform navigation only', app, /isPlatformAdminMode[\s\S]*\['accounts', 'modules', 'templates'/],
  ['tenant navigation does not include module management', app, /return \['dashboard', 'projects', 'templates', 'crm', 'campaigns', 'commerce', 'travel', 'ai-usage'\]/],
  ['module management renders only in platform mode', app, /currentView === 'modules' && isPlatformAdminMode[\s\S]*<SystemWorkspaceModules request=\{authFetch\}/],
  ['workspace module panel has stable landmark', systemModules, /data-testid="workspace-module-panel"/],
  ['workspace module panel title is zh-TW', systemModules, /工作區模組設定/],
  ['workspace list uses actual system workspaces contract', systemModules, /loadJson\(request, '\/api\/system\/workspaces'\)/],
  ['catalog uses actual system modules contract', systemModules, /loadJson\(request, '\/api\/system\/modules'\)/],
  ['workspace module read uses safe slug', systemModules, /encodeURIComponent\(workspace\.slug\)[\s\S]*\/api\/system\/workspaces\/\$\{safeReference\}\/modules/],
  ['workspace list shows safe slug', systemModules, /安全工作區代號：\{workspace\.slug\}/],
  ['workspace list shows enabled module count', systemModules, /已啟用模組數：\{enabledCount\} \/ \{catalog\.length\}/],
  ['workspace list exposes manage modules action', systemModules, /管理模組/],
  ['all eight canonical module keys are declared', entitlementSource, /'CORE_MENU'[\s\S]*'CRM'[\s\S]*'CAMPAIGN'[\s\S]*'COMMERCE'[\s\S]*'TRAVEL'[\s\S]*'DEALER_COMMISSION'[\s\S]*'POINTS_REWARDS'[\s\S]*'AI'/],
  ['backend label is the primary module heading', systemModules, /<h3[^>]*>\{module\.label\}<\/h3>/],
  ['backend description is rendered', systemModules, /\{module\.description\}/],
  ['TRAVEL appears in canonical catalog', entitlementSource, /'TRAVEL'/],
  ['TRAVEL has active UI hint', systemModules, /旅遊模組需先啟用電商模組/],
  ['TRAVEL dependency hint does not auto-enable CRM', systemModules, /CRM 為建議搭配，不會自動啟用/],
  ['module control is an accessible switch', toggle, /role="switch"[\s\S]*aria-label=[\s\S]*aria-checked=\{enabled\}/],
  ['module control is keyboard-native button', toggle, /<button[\s\S]*type="button"[\s\S]*role="switch"/],
  ['module status says enabled in zh-TW', toggle, /已啟用/],
  ['module status says disabled in zh-TW', toggle, /未啟用/],
  ['pending mutation disables switch', toggle, /disabled=\{pending\}/],
  ['pending mutation has visible loading state', toggle, /更新中\.\.\.[\s\S]*Loader2/],
  ['duplicate mutation is blocked', systemModules, /if \(!selectedWorkspace \|\| pendingModuleKey\) return/],
  ['enable requires confirmation', systemModules, /確認啟用此模組？/],
  ['disable requires confirmation', systemModules, /確認停用此模組？/],
  ['disable warning promises data preservation', systemModules, /停用後，該工作區將無法進入此模組，但既有資料不會被刪除。/],
  ['mutation uses exact backend status contract', systemModules, /\/modules\/\$\{encodeURIComponent\(module\.moduleKey\)\}\/status`/],
  ['mutation sends only enabled boolean', systemModules, /body: JSON\.stringify\(\{ enabled: nextEnabled \}\)/],
  ['mutation waits for backend response', systemModules, /await loadJson\([\s\S]*method: 'POST'/],
  ['mutation success refreshes backend truth', systemModules, /await loadJson\([\s\S]*await loadWorkspaceModules\(selectedWorkspace\)/],
  ['mutation failure refreshes actual state', systemModules, /catch \(updateError\)[\s\S]*await loadWorkspaceModules\(selectedWorkspace\)/],
  ['dependency error has safe zh-TW mapping', entitlementSource, /MODULE_DEPENDENCY_NOT_ENABLED[\s\S]*請先啟用此模組需要的相依功能/],
  ['generic mutation failure is safe zh-TW', entitlementSource, /模組設定更新失敗，請稍後再試。/],
  ['workspace authority fetch uses approved endpoint', provider, /request\('\/api\/workspace\/modules'\)/],
  ['workspace projection is transient React state', provider, /useState\(\{ status: 'idle', modules: \{\}, error: '' \}\)/],
  ['projection validates all eight backend entries', entitlementSource, /value\.length !== WORKSPACE_MODULE_KEYS\.length/],
  ['read failure retains explicit error state', provider, /status: 'error', modules: \{\}/],
  ['read failure provides retry', provider, /retry: reload/],
  ['read failure copy is safe zh-TW', provider, /目前無法載入模組設定，請稍後再試。/],
  ['App displays module loading state', app, /正在載入工作區模組/],
  ['App displays retry control', app, /moduleAuthority\.retry[\s\S]*重新載入/],
  ['CORE_MENU maps dashboard projects and templates', entitlementSource, /dashboard: 'CORE_MENU'[\s\S]*projects: 'CORE_MENU'[\s\S]*templates: 'CORE_MENU'/],
  ['CRM maps only CRM view', entitlementSource, /crm: 'CRM'/],
  ['CAMPAIGN maps campaign view', entitlementSource, /campaigns: 'CAMPAIGN'/],
  ['COMMERCE maps commerce view', entitlementSource, /commerce: 'COMMERCE'/],
  ['AI maps explicit AI usage view', entitlementSource, /'ai-usage': 'AI'/],
  ['tenant navigation applies module projection', app, /filter\(item => isTenantNavigationItemVisible\(item, moduleAuthority\)\)/],
  ['module-dependent views have render guard', app, /tenantViewAccessible[\s\S]*<CrmWorkspace[\s\S]*tenantViewAccessible[\s\S]*<CampaignWorkspace[\s\S]*tenantViewAccessible[\s\S]*<CommerceAdminWorkspace/],
  ['disabled current view redirects safely', app, /moduleAuthority\.modules\[moduleKey\] !== true[\s\S]*firstAvailableTenantView/],
  ['unavailable view message is exact zh-TW', app, /此工作區尚未啟用此功能模組。/],
  ['backend module denial triggers projection refresh', app, /response\.status === 403[\s\S]*MODULE_NOT_ENABLED[\s\S]*smart-menu:module-not-enabled/],
  ['provider listens for backend authority denial', provider, /addEventListener\('smart-menu:module-not-enabled'[\s\S]*reload/],
  ['AI entitlement keeps existing provider panel separate', app, /<AIUsagePanel request=\{authFetch\} systemAdmin=\{isPlatformAdminMode\}/],
  ['module UI does not claim AI is available', moduleUi, /AI 可用/, false],
  ['module UI exposes no API key', moduleUi, /GEMINI_API_KEY|apiKey|secret/i, false],
  ['module UI exposes no entitlement row ID', moduleUi, /entitlementId|entitlement_id|granted_by_user_id|grantedByUserId/, false],
  ['module UI exposes no workspace DB ID', moduleUi, /workspace\.id|workspace_id|workspaceId/, false],
  ['module UI exposes no billing internals', moduleUi, /billing|subscription|月費|年費|試用|到期日|升級方案/i, false],
  ['module authority is never browser-persisted', moduleUi, /localStorage|sessionStorage|indexedDB/, false],
  ['module UI performs no CRM deletion', moduleUi, /deleteCrm|DELETE[^\n]*crm/i, false],
  ['module UI performs no Commerce order mutation', moduleUi, /commerce\/orders|createOrder|cancelOrder/i, false],
  ['module UI performs no Campaign execution mutation', moduleUi, /campaigns?\/[^\n]*(?:execute|resume)|cancelExecution/i, false],
  ['module UI imports no TravelKeeper', moduleUi, /from ['"][^'"]*travelkeeper/i, false],
  ['module UI contains no billing mutation', moduleUi, /purchase|checkout|subscribe|paymentIntent/i, false],
  ['module UI contains no event history query', systemModules, /entitlement_events|eventHistory|auditEvents/i, false],
  ['Project Editor receives AI entitlement from backend projection', app, /<ProjectEditorView[\s\S]*aiEnabled=\{moduleAuthority\.isEnabled\('AI'\) === true\}/],
  ['Smart Guide is hidden when AI is disabled', app, /\{aiEnabled && \([\s\S]*<SmartGuide/],
  ['Proposal and operation plan actions are AI-gated', app, /\{aiEnabled && \([\s\S]*<ProposalManagement[\s\S]*<OperationPlanManagement/],
  ['core publish does not require AI guide readiness when AI is disabled', app, /if \(aiEnabled && !publishReadiness\.loaded\)[\s\S]*if \(aiEnabled && !publishReadiness\.ready\)/],
  ['new template Gemini entry is hidden when AI is disabled', app, /TemplatesView = \(\{ onNavigate, onEditTemplate, aiEnabled \}\)[\s\S]*\{aiEnabled \? \([\s\S]*建立新模板/],
  ['existing template editor explains hidden AI detection', app, /AI 模組未啟用，智慧熱區偵測目前隱藏。您仍可編輯已有模板/],
  ['Settings CRM panels require CRM entitlement', app, /isEnabled\('CRM'\) === true[\s\S]*LiffReferralConfigPanel[\s\S]*ReferralGrowthPanel/],
  ['Settings Dealer panel requires dealer commission entitlement', app, /isEnabled\('DEALER_COMMISSION'\) === true[\s\S]*CommissionAttributionPanel/],
  ['Settings Points panels require points rewards entitlement', app, /isEnabled\('POINTS_REWARDS'\) === true[\s\S]*RewardRedemptionPanel[\s\S]*ContributionTierPanel/],
];

for (const [name, source, pattern, expected = true] of acceptance) {
  test(`8A-UI acceptance: ${name}`, () => {
    if (expected) assert.match(source, pattern);
    else assert.doesNotMatch(source, pattern);
  });
}

test('8A-UI behavior: legacy-compatible enabled projection remains enabled', () => {
  const modules = WORKSPACE_MODULE_KEYS.map(moduleKey => ({ moduleKey, enabled: true }));
  assert.equal(normalizeWorkspaceModuleProjection(modules).CRM, true);
});

test('8A-UI behavior: missing projection entry is not independently treated as disabled', () => {
  const incomplete = WORKSPACE_MODULE_KEYS.slice(0, -1).map(moduleKey => ({ moduleKey, enabled: true }));
  assert.throws(() => normalizeWorkspaceModuleProjection(incomplete), /MODULE_PROJECTION_INVALID/);
});

test('8A-UI behavior: new workspace backend defaults render exactly as returned', () => {
  const modules = WORKSPACE_MODULE_KEYS.map(moduleKey => ({ moduleKey, enabled: moduleKey === 'CORE_MENU' }));
  assert.deepEqual(normalizeWorkspaceModuleProjection(modules), {
    CORE_MENU: true,
    CRM: false,
    CAMPAIGN: false,
    COMMERCE: false,
    TRAVEL: false,
    DEALER_COMMISSION: false,
    POINTS_REWARDS: false,
    AI: false,
  });
});

test('8A-UI behavior: failed reads preserve core shell without exposing CRM', () => {
  const authority = { status: 'error', modules: {} };
  assert.equal(isTenantNavigationItemVisible({ id: 'projects' }, authority), true);
  assert.equal(isTenantNavigationItemVisible({ id: 'crm' }, authority), false);
});

test('8A-UI behavior: disabled modules are hidden and enabled modules remain visible', () => {
  const authority = { status: 'ready', modules: { CORE_MENU: true, CRM: false, CAMPAIGN: true } };
  assert.equal(isTenantNavigationItemVisible({ id: 'crm' }, authority), false);
  assert.equal(isTenantNavigationItemVisible({ id: 'campaigns' }, authority), true);
});

test('8A-UI behavior: safe redirect selects first backend-enabled module', () => {
  assert.equal(firstAvailableTenantView({ CORE_MENU: false, CRM: true }), 'crm');
  assert.equal(firstAvailableTenantView({ CORE_MENU: false, CRM: false }), 'account');
});

test('8A-UI behavior: TRAVEL uses the approved tenant route', () => {
  assert.equal(moduleKeyForView('travel'), 'TRAVEL');
  assert.match(entitlementSource, /travel: 'TRAVEL'/);
});

test('8A-UI focused suite contains at least 53 acceptance checks', () => {
  assert.ok(acceptance.length >= 53, `expected at least 53 checks, received ${acceptance.length}`);
});
