import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { emitGuideEvent } from '../guide-events';

const RISK_META = {
  LOW: { label: '低風險', icon: '🟢', style: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  MEDIUM: { label: '中風險', icon: '🟡', style: 'border-amber-200 bg-amber-50 text-amber-900' },
  HIGH: { label: '高風險', icon: '🔴', style: 'border-red-200 bg-red-50 text-red-800' },
};

const STATUS_META = {
  draft: { label: '草案', style: 'bg-gray-100 text-gray-700' },
  reviewed: { label: '已檢視', style: 'bg-blue-100 text-blue-700' },
  approved: { label: '已核准', style: 'bg-emerald-100 text-emerald-700' },
  executing: { label: '執行中', style: 'bg-blue-100 text-blue-700' },
  executed: { label: '已執行', style: 'bg-emerald-100 text-emerald-700' },
  failed: { label: '執行失敗', style: 'bg-red-100 text-red-700' },
  rolled_back: { label: '已安全回復', style: 'bg-amber-100 text-amber-800' },
  partially_compensated: { label: '未完全回復', style: 'bg-red-100 text-red-800' },
  stale: { label: '已失效', style: 'bg-amber-100 text-amber-800' },
  cancelled: { label: '已取消', style: 'bg-gray-200 text-gray-600' },
};

const PREFLIGHT_LABELS = {
  PLAN_POLICY_VALID: '計畫政策有效',
  ALL_STEPS_EXECUTABLE: '所有步驟皆為既有 typed operation',
  ALL_PROPOSALS_APPROVED: '所有改善方案皆已核准',
  NO_CONFLICTS: '沒有欄位衝突',
  ALL_FINGERPRINTS_MATCH: '所有 Proposal fingerprint 一致',
  ALL_TARGETS_EXIST: '所有目標仍存在',
  ALL_TARGETS_IN_WORKSPACE: '所有目標屬於目前 Workspace',
  P002_PROBES_FRESH: 'P002 HTTPS SAFE Probe 仍有效',
  POLICY_VERSION_VALID: 'Policy version 有效',
};

const EVENT_LABELS = {
  PLAN_CREATED: '建立計畫',
  PLAN_REVIEWED: '完成檢視',
  PLAN_APPROVED: '核准計畫',
  PLAN_STALE: '計畫失效',
  PLAN_CANCELLED: '取消計畫',
  PLAN_EXECUTION_STARTED: '開始執行',
  PLAN_STEP_STARTED: '步驟開始',
  PLAN_STEP_SUCCEEDED: '步驟完成',
  PLAN_STEP_FAILED: '步驟失敗',
  PLAN_COMPENSATION_STARTED: '開始安全回復',
  PLAN_STEP_ROLLBACK_SUCCEEDED: '步驟已回復',
  PLAN_STEP_ROLLBACK_FAILED: '步驟回復失敗',
  PLAN_EXECUTED: '計畫執行完成',
  PLAN_FAILED: '計畫執行失敗',
  PLAN_ROLLED_BACK: '計畫已安全回復',
  PLAN_PARTIALLY_COMPENSATED: '計畫未完全回復',
};

const displayValue = value => value === '' || value === null || value === undefined ? '未設定' : String(value);
const formatTime = value => value ? new Date(value.replace(' ', 'T') + (value.includes('T') ? '' : 'Z')).toLocaleString('zh-TW') : '—';

export default function OperationPlanManagement({ projectId, request, refreshKey = 0 }) {
  const [state, setState] = useState({ status: 'loading', proposals: [], plans: [], permissions: {}, error: '' });
  const [selected, setSelected] = useState([]);
  const [detail, setDetail] = useState({ status: 'idle', plan: null, events: [], runs: [], error: '' });
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [executeConfirm, setExecuteConfirm] = useState(false);

  const load = useCallback(async () => {
    setState(previous => ({ ...previous, status: 'loading', error: '' }));
    try {
      const [proposalResponse, planResponse] = await Promise.all([
        request(`/api/projects/${encodeURIComponent(projectId)}/proposals`),
        request(`/api/projects/${encodeURIComponent(projectId)}/operation-plans`),
      ]);
      const [proposalPayload, planPayload] = await Promise.all([proposalResponse.json(), planResponse.json()]);
      if (!proposalResponse.ok || !proposalPayload.success) throw new Error(proposalPayload.error || '改善方案讀取失敗。');
      if (!planResponse.ok || !planPayload.success) throw new Error(planPayload.error || '執行計畫讀取失敗。');
      setState({
        status: 'success',
        proposals: Array.isArray(proposalPayload.proposals) ? proposalPayload.proposals : [],
        plans: Array.isArray(planPayload.plans) ? planPayload.plans : [],
        permissions: planPayload.permissions || {},
        error: '',
      });
      setSelected(previous => previous.filter(id => proposalPayload.proposals?.some(item => item.id === id)));
    } catch (error) {
      console.error('Composite Plan list request failed', error);
      setState(previous => ({ ...previous, status: 'error', error: error.message || '目前無法取得執行計畫。' }));
    }
  }, [projectId, request]);

  useEffect(() => {
    if (projectId) load();
  }, [load, projectId, refreshKey]);

  const eligibleProposals = useMemo(() => state.proposals.filter(proposal =>
    ['LOW', 'MEDIUM'].includes(proposal.policy?.riskLevel)
    && proposal.policy?.requirements?.rollbackSupported === true
    && !['executed', 'stale', 'rejected'].includes(proposal.status)
  ), [state.proposals]);

  const toggleProposal = proposalId => {
    setSelected(previous => previous.includes(proposalId)
      ? previous.filter(id => id !== proposalId)
      : [...previous, proposalId]);
    setFeedback(null);
  };

  const createPlan = async () => {
    if (selected.length === 0 || busy) return;
    setBusy('create');
    setFeedback(null);
    try {
      const response = await request(`/api/projects/${encodeURIComponent(projectId)}/operation-plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalIds: selected }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        const failure = new Error(payload.error || '執行計畫建立失敗。');
        failure.code = payload.code;
        failure.details = payload.details;
        throw failure;
      }
      setSelected([]);
      await load();
      await openPlan(payload.plan.id);
      setFeedback({ type: 'success', message: '✓ 執行計畫已建立；目前沒有修改任何專案資料。' });
    } catch (error) {
      console.error('Composite Plan create request failed', error);
      setFeedback({
        type: error.code === 'PLAN_CONFLICT' ? 'conflict' : 'error',
        message: error.message || '執行計畫建立失敗。',
        details: error.details,
      });
    } finally {
      setBusy('');
    }
  };

  const openPlan = async planId => {
    setDetail({ status: 'loading', plan: null, events: [], runs: [], error: '' });
    try {
      const response = await request(`/api/projects/${encodeURIComponent(projectId)}/operation-plans/${encodeURIComponent(planId)}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '執行計畫讀取失敗。');
      setDetail({ status: 'success', plan: payload.plan, events: payload.events || [], runs: payload.runs || [], error: '' });
    } catch (error) {
      console.error('Composite Plan detail request failed', error);
      setDetail({ status: 'error', plan: null, events: [], runs: [], error: error.message || '執行計畫讀取失敗。' });
    }
  };

  const closePlan = () => { setExecuteConfirm(false); setDetail({ status: 'idle', plan: null, events: [], runs: [], error: '' }); };

  const runPlanAction = async action => {
    const plan = detail.plan;
    if (!plan || busy) return;
    setBusy(action);
    setFeedback(null);
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/operation-plans/${encodeURIComponent(plan.id)}/${action}`,
        { method: 'POST' },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '執行計畫狀態更新失敗。');
      await load();
      await openPlan(plan.id);
      setFeedback({
        type: 'success',
        message: action === 'approve'
          ? '✓ 計畫已核准；核准不會修改專案資料。'
          : action === 'cancel' ? '計畫已取消。' : '計畫已完成檢視。',
      });
    } catch (error) {
      console.error('Composite Plan workflow request failed', error);
      setDetail(previous => ({ ...previous, error: error.message || '執行計畫狀態更新失敗。' }));
    } finally {
      setBusy('');
    }
  };

  const refreshExecutionState = async planId => {
    try {
      const response = await request(`/api/projects/${encodeURIComponent(projectId)}/operation-plans/${encodeURIComponent(planId)}`);
      const payload = await response.json();
      if (response.ok && payload.success) {
        setDetail({ status: 'success', plan: payload.plan, events: payload.events || [], runs: payload.runs || [], error: '' });
      }
    } catch {
      // The execute request remains authoritative; a transient polling failure is non-fatal.
    }
  };

  const executePlan = async () => {
    const plan = detail.plan;
    if (!plan || busy || !executeConfirm) return;
    setBusy('execute');
    setFeedback(null);
    let pollTimer;
    try {
      pollTimer = window.setInterval(() => refreshExecutionState(plan.id), 500);
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/operation-plans/${encodeURIComponent(plan.id)}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: true }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        const failure = new Error(payload.error || '執行計畫失敗。');
        failure.code = payload.code;
        throw failure;
      }
      setExecuteConfirm(false);
      setDetail({ status: 'success', plan: payload.plan, events: payload.events || [], runs: payload.runs || [], error: '' });
      await load();
      const finalStatus = payload.plan?.status;
      setFeedback({
        type: finalStatus === 'executed' || finalStatus === 'rolled_back' ? 'success' : 'error',
        message: finalStatus === 'executed'
          ? '✓ 執行計畫完成。'
          : finalStatus === 'rolled_back'
            ? '⚠ 計畫執行失敗，已安全回復先前修改。'
            : '⚠ 計畫未完全回復，請依執行紀錄人工處理。',
      });
      emitGuideEvent({ type: 'guide-refresh', source: 'composite-plan-execution', projectId });
    } catch (error) {
      console.error('Composite Plan execute request failed', error);
      setDetail(previous => ({ ...previous, error: error.message || '執行計畫失敗。' }));
      await refreshExecutionState(plan.id);
    } finally {
      if (pollTimer) window.clearInterval(pollTimer);
      setBusy('');
    }
  };
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="AI 執行計畫">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-gray-900">AI 執行計畫</h3>
          <p className="mt-1 text-xs text-gray-500">將既有 P001／P002 Proposal 組成有順序與完整安全檢查的計畫；核准後由後端依序安全執行。</p>
        </div>
        <button type="button" onClick={load} className="text-xs font-bold text-blue-600 underline">重新整理</button>
      </div>

      {state.status === 'loading' && <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" />載入執行計畫…</div>}
      {state.status === 'error' && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</div>}

      {state.status === 'success' && state.permissions?.canCreate && (
        <div className="mt-5 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
          <div className="text-sm font-bold text-indigo-950">手動選擇改善方案</div>
          <div className="mt-1 text-xs text-indigo-800">只傳送 Proposal IDs；operation、risk、target 與順序由後端重新驗證。</div>
          <div className="mt-3 space-y-2">
            {eligibleProposals.length === 0 && <div className="text-sm text-gray-500">目前沒有可加入計畫的 P001／P002 Proposal。</div>}
            {eligibleProposals.map(proposal => {
              const risk = RISK_META[proposal.policy?.riskLevel] || RISK_META.LOW;
              return (
                <label key={proposal.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-indigo-100 bg-white p-3">
                  <input type="checkbox" checked={selected.includes(proposal.id)} onChange={() => toggleProposal(proposal.id)} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-gray-900">{proposal.title}</span>
                    <span className="mt-1 block text-xs text-gray-500">{proposal.ruleCode} · Proposal {proposal.status}</span>
                  </span>
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${risk.style}`}>{risk.icon} {risk.label}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={createPlan} disabled={selected.length === 0 || Boolean(busy)} className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy === 'create' ? '建立中…' : `建立執行計畫（${selected.length}）`}
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <div className={`mt-4 rounded-lg border p-3 text-sm font-medium ${feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : feedback.type === 'conflict' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {feedback.type === 'conflict' && <div className="font-bold">⚠ 無法建立安全執行計畫</div>}
          <div className={feedback.type === 'conflict' ? 'mt-1' : ''}>{feedback.message}</div>
          {Array.isArray(feedback.details?.proposalIds) && <div className="mt-2 text-xs">衝突 Proposal：{feedback.details.proposalIds.join('、')}</div>}
        </div>
      )}

      {state.status === 'success' && (
        <div className="mt-5">
          <div className="text-sm font-bold text-gray-900">執行計畫</div>
          {state.plans.length === 0 ? (
            <div className="mt-2 rounded-lg bg-gray-50 p-4 text-sm text-gray-500">尚未建立執行計畫。</div>
          ) : (
            <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
              {state.plans.map(plan => {
                const status = STATUS_META[plan.status] || STATUS_META.draft;
                const risk = RISK_META[plan.riskLevel] || RISK_META.LOW;
                return (
                  <button key={plan.id} type="button" onClick={() => openPlan(plan.id)} className="grid w-full grid-cols-[1fr_auto] gap-3 border-b border-gray-100 p-3 text-left last:border-b-0 hover:bg-gray-50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{plan.title}</span>
                      <span className="mt-1 block text-xs text-gray-500">{plan.steps.length} 個步驟 · {formatTime(plan.createdAt)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${risk.style}`}>{risk.icon} {risk.label}</span>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${status.style}`}>{status.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {detail.status !== 'idle' && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-gray-950/55 p-4" role="dialog" aria-modal="true" aria-label="執行計畫詳情">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-gray-900 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><div className="inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-700">Composite Plan</div><h3 className="mt-2 text-lg font-bold">執行計畫詳情</h3></div>
              <button type="button" onClick={closePlan} className="rounded-md px-2 py-1 text-sm font-bold text-gray-500 hover:bg-gray-100">關閉</button>
            </div>
            {detail.status === 'loading' && <div className="flex justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 size={17} className="animate-spin" />載入中…</div>}
            {detail.status === 'error' && <div className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{detail.error}</div>}
            {detail.status === 'success' && detail.plan && (() => {
              const plan = detail.plan;
              const status = STATUS_META[plan.status] || STATUS_META.draft;
              const risk = RISK_META[plan.riskLevel] || RISK_META.LOW;
              const currentRun = detail.runs?.[0] || null;
              return (
                <div className="mt-5 space-y-5">
                  <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${risk.style}`}>{risk.icon} {risk.label}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.style}`}>{status.label}</span><span className="text-xs text-gray-500">Policy v{plan.policyVersion}</span></div>
                  <div><div className="font-bold">{plan.title}</div><div className="mt-1 text-sm text-gray-600">{plan.riskReason}</div></div>
                  {plan.status === 'stale' && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">⚠ 此計畫建立後，部分專案設定已改變。</div>}
                  {plan.status === 'approved' && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"><div className="font-bold">✓ 計畫已核准</div><div className="mt-1">執行前仍會由後端重建所有 Proposal 並重新執行完整安全檢查。</div></div>}
                  <div className="space-y-3">{plan.steps.map(step => (
                    <div key={step.id} className="rounded-lg border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold text-indigo-600">Step {step.sequence}</div><div className="mt-1 font-bold">{step.snapshot.title}</div><div className="mt-1 text-xs text-gray-500">{step.operationType}</div></div><span className="text-xs font-bold text-gray-500">{step.proposalType === 'https-upgrade-candidate' ? 'P002' : 'P001'}</span></div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div className="rounded-md bg-gray-100 p-3"><div className="text-[11px] font-bold text-gray-500">目前</div><div className="mt-1 break-all">{displayValue(step.snapshot.before)}</div></div><div className="rounded-md bg-emerald-50 p-3"><div className="text-[11px] font-bold text-emerald-700">計畫修改</div><div className="mt-1 break-all">{displayValue(step.snapshot.after)}</div></div></div>
                      {step.requirements.freshProbeRequired && <div className="mt-3 text-xs font-bold">HTTPS Probe：{step.snapshot.probeEligibility}</div>}
                      {step.dependencies.length > 0 && <div className="mt-3 rounded-md bg-blue-50 p-2 text-xs text-blue-800">需在 Step {plan.steps.find(item => item.id === step.dependencies[0])?.sequence || '前一步'} 完成後執行</div>}
                    </div>
                  ))}</div>
                                    {currentRun && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
                      <div className="flex items-center justify-between gap-3"><div className="text-sm font-bold">執行紀錄</div><div className="text-xs font-bold">{STATUS_META[currentRun.status]?.label || currentRun.status}</div></div>
                      <div className="mt-1 text-xs text-gray-500">{currentRun.actorName || '使用者'} · {formatTime(currentRun.startedAt)}</div>
                      <div className="mt-3 space-y-2">{currentRun.steps.map(runStep => {
                        const sourceStep = plan.steps.find(item => item.id === runStep.planStepId);
                        return <div key={runStep.id} className="rounded-md bg-white px-3 py-2 text-xs"><div className="flex items-center justify-between"><span>Step {runStep.sequence} · {sourceStep?.snapshot?.title || runStep.planStepId}</span><span className="font-bold">{runStep.status === 'succeeded' ? '✓ 完成' : runStep.status === 'rollback_succeeded' ? '↩ 已回復' : runStep.status === 'rollback_failed' ? '⚠ 需人工處理' : runStep.status === 'failed' ? '✕ 失敗' : runStep.status === 'executing' ? '執行中…' : '等待中'}</span></div>{runStep.operationLogId && <div className="mt-1 break-all text-[11px] text-gray-500">Operation: {runStep.operationLogId}</div>}{runStep.rollbackOperationLogId && <div className="mt-1 break-all text-[11px] text-gray-500">Rollback: {runStep.rollbackOperationLogId}</div>}</div>;
                      })}</div>
                      {currentRun.status === 'rolled_back' && <div className="mt-3 text-sm font-bold text-amber-800">⚠ 計畫執行失敗，已安全回復先前修改。</div>}
                      {currentRun.status === 'partially_compensated' && <div className="mt-3 text-sm font-bold text-red-700">⚠ 計畫未完全回復；請依失敗步驟人工處理，系統不提供 Force rollback。</div>}
                    </div>
                  )}
                  <div className="rounded-lg border border-gray-200 p-4"><div className="text-sm font-bold">Plan Preflight</div><div className="mt-3 grid gap-2 text-xs">{plan.preflight.checks.map(check => <div key={check.code} className="flex items-start gap-2"><span>{check.passed ? '✓' : '○'}</span><span>{PREFLIGHT_LABELS[check.code] || check.code}</span></div>)}</div></div>
                  <div><div className="text-sm font-bold">計畫歷程</div><div className="mt-2 space-y-2">{detail.events.map(event => <div key={event.id} className="rounded-lg border border-gray-200 p-3 text-xs"><div className="font-bold">{EVENT_LABELS[event.eventType] || event.eventType}</div><div className="mt-1 text-gray-500">{event.actorName || '系統'} · {formatTime(event.createdAt)}</div></div>)}</div></div>
                  {detail.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{detail.error}</div>}
                                    {executeConfirm && plan.capabilities?.canExecute && (
                    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
                      <div className="font-bold">確認執行正式專案修改</div>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt>計畫</dt><dd>{plan.title}</dd><dt>風險</dt><dd>{risk.label}</dd><dt>步驟</dt><dd>{plan.steps.length}</dd><dt>Rollback</dt><dd>{plan.steps.every(step => step.rollbackSupported) ? '所有步驟皆支援' : '部分步驟不支援'}</dd></dl>
                      <div className="mt-3 font-bold">此操作將依序修改正式 Project 資料。</div>
                      <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setExecuteConfirm(false)} disabled={Boolean(busy)} className="rounded-md border border-gray-300 bg-white px-3 py-2 font-bold">取消</button><button type="button" onClick={executePlan} disabled={Boolean(busy)} className="rounded-md bg-red-700 px-3 py-2 font-bold text-white disabled:opacity-50">{busy === 'execute' ? '等待後端執行結果…' : '確認執行計畫'}</button></div>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    {plan.capabilities?.canReview && <button type="button" onClick={() => runPlanAction('review')} disabled={Boolean(busy)} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-bold disabled:opacity-50">標記已檢視</button>}
                    {plan.capabilities?.canApprove && <button type="button" onClick={() => runPlanAction('approve')} disabled={Boolean(busy)} className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">核准計畫</button>}
                    {plan.capabilities?.canCancel && <button type="button" onClick={() => runPlanAction('cancel')} disabled={Boolean(busy)} className="rounded-md bg-gray-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">取消計畫</button>}
                    {plan.capabilities?.canExecute && !executeConfirm && <button type="button" onClick={() => setExecuteConfirm(true)} disabled={Boolean(busy)} className="rounded-md bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">執行已核准計畫</button>}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </section>
  );
}
