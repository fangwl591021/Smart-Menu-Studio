import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, Settings } from 'lucide-react';
import ModuleEntitlementToggle from './ModuleEntitlementToggle';
import { WORKSPACE_MODULE_KEYS, moduleMutationErrorMessage } from '../module-entitlements';

const loadJson = async (request, path, options) => {
  const response = await request(path, options);
  const data = await response.json();
  if (!response.ok || !data.success) {
    const error = new Error(data.error || 'WORKSPACE_MODULE_LIST_FAILED');
    error.code = data.error || '';
    throw error;
  }
  return data;
};

export default function SystemWorkspaceModules({ request }) {
  const [catalog, setCatalog] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceModules, setWorkspaceModules] = useState({});
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingModuleKey, setPendingModuleKey] = useState('');
  const [mutationError, setMutationError] = useState('');

  const loadWorkspaceModules = useCallback(async (workspace) => {
    const safeReference = encodeURIComponent(workspace.slug);
    const data = await loadJson(request, `/api/system/workspaces/${safeReference}/modules`);
    const modules = Array.isArray(data.modules) ? data.modules : [];
    setWorkspaceModules(current => ({ ...current, [workspace.slug]: modules }));
    return modules;
  }, [request]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalogData, workspaceData] = await Promise.all([
        loadJson(request, '/api/system/modules'),
        loadJson(request, '/api/system/workspaces'),
      ]);
      const nextCatalog = Array.isArray(catalogData.modules) ? catalogData.modules : [];
      const nextWorkspaces = (workspaceData.workspaces || []).filter(workspace => workspace.slug);
      if (nextCatalog.length !== WORKSPACE_MODULE_KEYS.length) throw new Error('MODULE_CATALOG_INVALID');
      setCatalog(nextCatalog);
      setWorkspaces(nextWorkspaces);
      const projections = await Promise.all(nextWorkspaces.map(async workspace => [
        workspace.slug,
        await loadWorkspaceModules(workspace),
      ]));
      setWorkspaceModules(Object.fromEntries(projections));
    } catch (loadError) {
      console.error(loadError);
      setError('目前無法載入模組設定，請稍後再試。');
    } finally {
      setLoading(false);
    }
  }, [loadWorkspaceModules, request]);

  useEffect(() => { load(); }, [load]);

  const openWorkspace = async (workspace) => {
    setSelectedWorkspace(workspace);
    setMutationError('');
    if (!workspaceModules[workspace.slug]) {
      try {
        await loadWorkspaceModules(workspace);
      } catch (loadError) {
        console.error(loadError);
        setMutationError('目前無法載入模組設定，請稍後再試。');
      }
    }
  };

  const updateModule = async (module, nextEnabled) => {
    if (!selectedWorkspace || pendingModuleKey) return;
    const confirmation = nextEnabled
      ? '確認啟用此模組？'
      : '確認停用此模組？\n\n停用後，該工作區將無法進入此模組，但既有資料不會被刪除。';
    if (!window.confirm(confirmation)) return;

    setPendingModuleKey(module.moduleKey);
    setMutationError('');
    try {
      const safeReference = encodeURIComponent(selectedWorkspace.slug);
      await loadJson(
        request,
        `/api/system/workspaces/${safeReference}/modules/${encodeURIComponent(module.moduleKey)}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextEnabled }),
        },
      );
      await loadWorkspaceModules(selectedWorkspace);
    } catch (updateError) {
      console.error(updateError);
      setMutationError(moduleMutationErrorMessage(updateError.code));
      try {
        await loadWorkspaceModules(selectedWorkspace);
      } catch (refreshError) {
        console.error(refreshError);
      }
    } finally {
      setPendingModuleKey('');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center gap-2 p-12 text-gray-600"><Loader2 size={20} className="animate-spin" />正在載入模組設定...</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <button type="button" onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700">
          <RefreshCw size={16} />重新載入
        </button>
      </div>
    );
  }

  if (selectedWorkspace) {
    const modules = workspaceModules[selectedWorkspace.slug] || [];
    return (
      <section className="space-y-6" data-testid="workspace-module-panel">
        <button type="button" onClick={() => setSelectedWorkspace(null)} className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} />返回工作區清單
        </button>
        <header>
          <h2 className="text-2xl font-bold text-gray-900">工作區模組設定</h2>
          <p className="mt-1 text-sm text-gray-500">{selectedWorkspace.company_name || selectedWorkspace.name}</p>
          <p className="mt-1 text-xs text-gray-400">安全工作區代號：{selectedWorkspace.slug}</p>
        </header>
        {mutationError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mutationError}</div>}
        {modules.length === 0 ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            目前無法載入模組設定，請稍後再試。
            <button type="button" onClick={() => loadWorkspaceModules(selectedWorkspace)} className="ml-3 rounded-md border border-red-200 bg-white px-3 py-1.5 font-medium">重新載入</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {modules.map(module => (
              <article key={module.moduleKey} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">{module.label}</h3>
                    <p className="mt-1 text-sm text-gray-500">{module.description}</p>
                    {module.moduleKey === 'TRAVEL' && <p className="mt-2 text-xs text-blue-700">旅遊模組需先啟用電商模組；CRM 為建議搭配，不會自動啟用。</p>}
                  </div>
                  <ModuleEntitlementToggle
                    label={module.label}
                    enabled={module.enabled === true}
                    pending={pendingModuleKey === module.moduleKey}
                    onChange={nextEnabled => updateModule(module, nextEnabled)}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-6" data-testid="system-workspace-modules">
      <header>
        <h2 className="text-2xl font-bold text-gray-900">模組管理</h2>
        <p className="mt-1 text-sm text-gray-500">由系統管理員指定各工作區可使用的功能模組。租戶角色權限仍由各模組內部控制。</p>
      </header>
      {workspaces.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">目前沒有可管理的工作區。</div>
      ) : (
        <div className="space-y-3">
          {workspaces.map(workspace => {
            const modules = workspaceModules[workspace.slug] || [];
            const enabledCount = modules.filter(module => module.enabled === true).length;
            return (
              <article key={workspace.slug} className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{workspace.company_name || workspace.name}</h3>
                  <p className="mt-1 text-xs text-gray-500">安全工作區代號：{workspace.slug}</p>
                  <p className="mt-2 text-sm text-gray-600">已啟用模組數：{enabledCount} / {catalog.length}</p>
                </div>
                <button type="button" onClick={() => openWorkspace(workspace)} className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
                  <Settings size={16} />管理模組
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
