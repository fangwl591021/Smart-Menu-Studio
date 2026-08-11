/* oxlint-disable react/only-export-components -- provider and hooks intentionally share one transient authority context */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { moduleKeyForView, normalizeWorkspaceModuleProjection } from '../module-entitlements';

const WorkspaceModuleContext = createContext(null);

export function useWorkspaceModuleAuthority({ enabled, request, workspaceKey }) {
  const [state, setState] = useState({ status: 'idle', modules: {}, error: '' });

  const reload = useCallback(async () => {
    if (!enabled) {
      setState({ status: 'idle', modules: {}, error: '' });
      return;
    }
    if (!workspaceKey) {
      setState({ status: 'error', modules: {}, error: '目前無法載入模組設定，請稍後再試。' });
      return;
    }

    setState(current => ({ ...current, status: 'loading', error: '' }));
    try {
      const response = await request('/api/workspace/modules');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'WORKSPACE_MODULE_LIST_FAILED');
      const modules = normalizeWorkspaceModuleProjection(data.modules);
      setState({ status: 'ready', modules, error: '' });
    } catch (error) {
      console.error(error);
      setState({ status: 'error', modules: {}, error: '目前無法載入模組設定，請稍後再試。' });
    }
  }, [enabled, request, workspaceKey]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!enabled) return undefined;
    const refreshAfterBackendDenial = () => reload();
    window.addEventListener('smart-menu:module-not-enabled', refreshAfterBackendDenial);
    return () => window.removeEventListener('smart-menu:module-not-enabled', refreshAfterBackendDenial);
  }, [enabled, reload]);

  const value = useMemo(() => ({
    ...state,
    retry: reload,
    isEnabled(moduleKey) {
      if (state.status !== 'ready') return null;
      return state.modules[moduleKey] === true;
    },
    canAccessView(view) {
      const moduleKey = moduleKeyForView(view);
      if (!moduleKey) return true;
      if (state.status === 'ready') return state.modules[moduleKey] === true;
      return moduleKey === 'CORE_MENU';
    },
  }), [reload, state]);

  return value;
}

export function WorkspaceModuleProvider({ children, enabled, request, workspaceKey }) {
  const value = useWorkspaceModuleAuthority({ enabled, request, workspaceKey });
  return <WorkspaceModuleContext.Provider value={value}>{children}</WorkspaceModuleContext.Provider>;
}

export function useWorkspaceModules() {
  const context = useContext(WorkspaceModuleContext);
  if (!context) throw new Error('WorkspaceModuleProvider is required');
  return context;
}
