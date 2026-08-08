import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { emitGuideEvent, GUIDE_REFRESH_EVENT } from '../guide-events';
import RecommendationSection from './RecommendationSection';

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

const STEP_SYMBOLS = {
  complete: '✓',
  active: '●',
  pending: '○',
  blocked: '!',
};

export default function SmartGuide({ projectId, selectedAreaId, request, onAction, userRole, onProposalSaved }) {
  const [state, setState] = useState({ loading: true, error: '', payload: null });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [toast, setToast] = useState('');
  const [fallback, setFallback] = useState('');
  const workflowRef = useRef(null);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    const refresh = () => setRefreshNonce(value => value + 1);
    window.addEventListener(GUIDE_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(GUIDE_REFRESH_EVENT, refresh);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    const params = new URLSearchParams({ route: 'project-detail' });
    if (selectedAreaId !== null && selectedAreaId !== undefined) {
      params.set('selectedAreaId', String(selectedAreaId));
    }

    setState(previous => ({ ...previous, loading: true, error: '' }));
    request(`/api/projects/${encodeURIComponent(projectId)}/guide?${params.toString()}`)
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '目前無法取得引導狀態。');
        if (!active) return;

        const previousWorkflow = workflowRef.current;
        const nextWorkflow = payload.workflow || null;
        if (previousWorkflow && nextWorkflow && previousWorkflow.currentStepId !== nextWorkflow.currentStepId) {
          const previousStep = previousWorkflow.steps.find(step => step.id === previousWorkflow.currentStepId);
          const updatedPreviousStep = nextWorkflow.steps.find(step => step.id === previousWorkflow.currentStepId);
          const nextStep = nextWorkflow.steps.find(step => step.id === nextWorkflow.currentStepId);
          if (previousStep && updatedPreviousStep?.status === 'complete') {
            const nextText = nextWorkflow.status === 'complete' ? '圖文選單基本設定已完成' : `下一步：${nextStep?.title || ''}`;
            setToast(`✓「${previousStep.title}」已完成\n${nextText}`);
            if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = window.setTimeout(() => setToast(''), 3200);
          }
        }

        workflowRef.current = nextWorkflow;
        setFallback('');
        setState({ loading: false, error: '', payload });
      })
      .catch(error => {
        console.error(error);
        if (active) setState({ loading: false, error: '目前無法取得引導狀態。', payload: null });
      });

    return () => { active = false; };
  }, [projectId, selectedAreaId, refreshNonce, request]);

  const guide = state.payload?.guide;
  const workflow = state.payload?.workflow;
  const progress = workflow?.progress || guide?.progress || { completed: 0, total: 5, percent: 0 };
  const currentStep = workflow?.steps?.find(step => step.id === workflow.currentStepId);
  const action = currentStep?.action && currentStep.action.type !== 'none' ? currentStep.action : guide?.nextAction;
  const canAct = action && action.type !== 'none';
  const matchingIssues = (guide?.issues || []).filter(issue => currentStep?.issueCodes?.includes(issue.code));
  const currentIssue = matchingIssues.find(issue => issue.code !== 'PROJECT_AREA_ACTION_INCOMPLETE') || matchingIssues[0];
  const currentStepNumber = workflow
    ? workflow.steps.findIndex(step => step.id === workflow.currentStepId) + 1
    : Math.min(progress.completed + 1, progress.total);

  const handleAction = async () => {
    setFallback('');
    emitGuideEvent({
      type: 'guide-action',
      workflowId: workflow?.id,
      stepId: workflow?.currentStepId,
    });
    const handled = await onAction?.(action);
    if (handled === false) setFallback('請前往對應設定頁完成此步驟。');
  };

  return (
    <aside data-guide-state={guide?.status || (state.loading ? 'loading' : 'error')} className={`fixed bottom-5 right-5 z-40 w-[min(380px,calc(100vw-2.5rem))] rounded-2xl border p-4 shadow-xl ${STATUS_STYLES[guide?.status] || 'border-gray-200 bg-white text-gray-900'}`}>
      {toast && (
        <div className="absolute bottom-[calc(100%+10px)] left-0 right-0 whitespace-pre-line rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900 shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 font-bold">
        <span className="flex items-center gap-2"><Sparkles size={18} />Smart Guide</span>
        {guide && <span className="rounded-full bg-white/70 px-2 py-1 text-[11px]">{STATUS_LABELS[guide.status]}</span>}
      </div>

      {state.loading && !state.payload && (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          <Loader2 size={16} className="animate-spin" />分析專案狀態中...
        </div>
      )}

      {!state.loading && state.error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{state.error}
        </div>
      )}

      {guide && (
        <>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-sm font-bold">{workflow?.title || '圖文選單設定'}</div>
              <div className="mt-0.5 text-xs opacity-75">步驟 {currentStepNumber} / {progress.total}</div>
            </div>
            {state.loading && <Loader2 size={15} className="animate-spin opacity-60" />}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70">
            <div className="h-full rounded-full bg-current transition-all" style={{ width: `${progress.percent}%` }} />
          </div>

          {workflow ? (
            <ol className="mt-3 space-y-1.5 text-sm">
              {workflow.steps.map(step => (
                <li key={step.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${step.status === 'active' || step.status === 'blocked' ? 'bg-white/75 font-bold' : 'opacity-75'}`}>
                  <span className="w-4 shrink-0 text-center">{STEP_SYMBOLS[step.status]}</span>
                  <span>{step.title}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-3 text-sm">{guide.nextAction?.message}</div>
          )}

          <div className="mt-3 rounded-lg bg-white/70 p-3 text-sm">
            {workflow?.status === 'complete' ? (
              <span className="flex items-start gap-2"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{workflow.message}</span>
            ) : (
              <>
                <div className="text-xs font-bold opacity-70">目前要處理</div>
                <div className="mt-1">{currentIssue?.message || action?.message}</div>
              </>
            )}
          </div>

          {fallback && <div className="mt-3 text-xs font-medium text-red-700">{fallback}</div>}

          {canAct && (
            <button
              type="button"
              onClick={handleAction}
              className="mt-4 w-full rounded-lg bg-gray-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800"
            >
              帶我到這一步
            </button>
          )}

          <RecommendationSection
            result={state.payload?.recommendationResult}
            onAction={onAction}
            request={request}
            projectId={projectId}
            userRole={userRole}
            onProposalSaved={onProposalSaved}
          />
        </>
      )}
    </aside>
  );
}
