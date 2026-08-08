import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';

const STATUS_STYLES = {
  blocked: 'border-red-200 bg-red-50 text-red-900',
  incomplete: 'border-amber-200 bg-amber-50 text-amber-900',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

const STATUS_LABELS = {
  blocked: '需要先處理',
  incomplete: '尚未完成',
  complete: '基本設定完成',
};

export default function SmartGuide({ projectId, selectedAreaId, refreshKey, request, onAction }) {
  const [state, setState] = useState({ loading: true, error: '', payload: null });

  useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    const params = new URLSearchParams({ route: 'project-detail' });
    if (selectedAreaId !== null && selectedAreaId !== undefined) {
      params.set('selectedAreaId', String(selectedAreaId));
    }

    setState(prev => ({ ...prev, loading: true, error: '' }));
    request(`/api/projects/${encodeURIComponent(projectId)}/guide?${params.toString()}`)
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '目前無法取得引導狀態。');
        if (active) setState({ loading: false, error: '', payload });
      })
      .catch(error => {
        console.error(error);
        if (active) setState({ loading: false, error: '目前無法取得引導狀態。', payload: null });
      });

    return () => { active = false; };
  }, [projectId, selectedAreaId, refreshKey, request]);

  const guide = state.payload?.guide;
  const progress = guide?.progress || { completed: 0, total: 5, percent: 0 };
  const canAct = guide?.nextAction && guide.nextAction.type !== 'none';

  return (
    <aside data-guide-state={guide?.status || (state.loading ? 'loading' : 'error')} className={`fixed bottom-5 right-5 z-40 w-[min(360px,calc(100vw-2.5rem))] rounded-2xl border p-4 shadow-xl ${STATUS_STYLES[guide?.status] || 'border-gray-200 bg-white text-gray-900'}`}>
      <div className="flex items-center justify-between gap-3 font-bold">
        <span className="flex items-center gap-2"><Sparkles size={18} />Smart Guide</span>
        {guide && <span className="rounded-full bg-white/70 px-2 py-1 text-[11px]">{STATUS_LABELS[guide.status]}</span>}
      </div>

      {state.loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          <Loader2 size={16} className="animate-spin" />分析專案狀態中...
        </div>
      )}

      {!state.loading && state.error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{state.error}
        </div>
      )}

      {!state.loading && guide && (
        <>
          <div className="mt-3 flex items-center justify-between text-xs font-medium">
            <span>設定進度</span>
            <span>{progress.completed} / {progress.total}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/70">
            <div className="h-full rounded-full bg-current transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-3 text-sm leading-6">{guide.nextAction?.message}</p>

          {guide.status === 'complete' ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-white/70 p-3 text-sm">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              <span>基本設定已完成，可進行下一階段檢查。</span>
            </div>
          ) : (
            <ul className="mt-3 space-y-1.5 text-xs">
              {(guide.issues || []).slice(0, 3).map(issue => (
                <li key={`${issue.code}-${issue.target}`} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span><span className="font-mono font-semibold">{issue.code}</span> · {issue.message}</span>
                </li>
              ))}
            </ul>
          )}

          {canAct && (
            <button
              type="button"
              onClick={() => onAction?.(guide.nextAction)}
              className="mt-4 w-full rounded-lg bg-gray-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800"
            >
              帶我完成
            </button>
          )}
        </>
      )}
    </aside>
  );
}
