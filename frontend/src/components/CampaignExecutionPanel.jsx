import React, { useCallback, useEffect, useRef, useState } from 'react';
import CampaignDeliveryList from './CampaignDeliveryList';
import CampaignExecutionHistory from './CampaignExecutionHistory';
import { executionStatusLabels, formatCampaignExecutionTime } from '../utils/campaignExecutionPresentation';

const requestJson = async (request, path, options) => {
  const response = await request(path, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error || 'REQUEST_FAILED');
  return payload;
};

const executionErrorLabel = (code) => {
  const labels = {
    FORBIDDEN: '你目前沒有執行此操作的權限。',
    CAMPAIGN_EXECUTION_NOT_RESUMABLE: '目前沒有可繼續處理的收件人。',
    CAMPAIGN_EXECUTION_COMPLETED: '本次發送已完成。',
    CAMPAIGN_EXECUTION_CANCELLED: '本次發送已取消。',
    LINE_CREDENTIAL_MISSING: '找不到此工作區的 LINE Messaging API 設定。',
    LINE_INVALID_CREDENTIAL: 'LINE 官方帳號驗證失敗，請確認 Messaging API 設定。',
  };
  return labels[code] || '發送執行發生錯誤，請稍後再試。';
};

const counterCards = (execution) => [
  ['總數', execution?.total ?? 0],
  ['已發送', execution?.sent ?? 0],
  ['失敗', execution?.failed ?? 0],
  ['待處理', execution?.pending ?? 0],
  ['已取消', execution?.cancelled ?? 0],
  ['已略過', execution?.skipped ?? 0],
];

export default function CampaignExecutionPanel({ campaign, request, userRole = 'viewer' }) {
  const role = String(userRole).toLowerCase();
  const canManage = role === 'owner' || role === 'admin';
  const campaignReference = campaign?.safeCampaignReference || '';
  const [executions, setExecutions] = useState([]);
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const actionReference = useRef('');

  const loadExecutions = useCallback(async ({ preserveSelection = true } = {}) => {
    if (!campaignReference) return [];
    const payload = await requestJson(request, `/api/campaigns/${encodeURIComponent(campaignReference)}/executions`);
    const nextExecutions = payload.executions || [];
    setExecutions(nextExecutions);
    setSelectedExecution((current) => {
      if (!preserveSelection || !current) return nextExecutions[0] || null;
      return nextExecutions.find((item) => item.safeExecutionReference === current.safeExecutionReference) || nextExecutions[0] || null;
    });
    return nextExecutions;
  }, [campaignReference, request]);

  useEffect(() => {
    setLoading(true);
    setError('');
    setDeliveries([]);
    setNextOffset(null);
    actionReference.current = '';
    void loadExecutions({ preserveSelection: false })
      .catch((cause) => setError(executionErrorLabel(cause.message)))
      .finally(() => setLoading(false));
  }, [loadExecutions]);

  const loadExecutionDetail = useCallback(async (executionReference) => {
    if (!executionReference) return null;
    const payload = await requestJson(request, `/api/campaigns/${encodeURIComponent(campaignReference)}/executions/${encodeURIComponent(executionReference)}`);
    setSelectedExecution(payload.execution);
    return payload.execution;
  }, [campaignReference, request]);

  const loadDeliveries = useCallback(async (executionReference, offset = 0) => {
    if (!executionReference) return;
    setDeliveryLoading(true);
    try {
      const payload = await requestJson(request, `/api/campaigns/${encodeURIComponent(campaignReference)}/executions/${encodeURIComponent(executionReference)}/deliveries?limit=25&offset=${offset}`);
      setDeliveries((current) => offset === 0 ? payload.deliveries || [] : [...current, ...(payload.deliveries || [])]);
      setNextOffset(payload.nextOffset ?? null);
    } catch (cause) {
      setError(executionErrorLabel(cause.message));
    } finally {
      setDeliveryLoading(false);
    }
  }, [campaignReference, request]);

  useEffect(() => {
    setDeliveries([]);
    setNextOffset(null);
    if (selectedExecution?.safeExecutionReference) void loadDeliveries(selectedExecution.safeExecutionReference, 0);
  }, [loadDeliveries, selectedExecution?.safeExecutionReference]);

  useEffect(() => {
    if (selectedExecution?.status !== 'RUNNING') return undefined;
    const executionReference = selectedExecution.safeExecutionReference;
    const timer = globalThis.setInterval(() => {
      void Promise.all([loadExecutionDetail(executionReference), loadExecutions()]).catch((cause) => setError(executionErrorLabel(cause.message)));
    }, 7000);
    return () => globalThis.clearInterval(timer);
  }, [loadExecutionDetail, loadExecutions, selectedExecution?.safeExecutionReference, selectedExecution?.status]);

  const runMutation = async (path, options) => {
    setMutating(true);
    setError('');
    try {
      const payload = await requestJson(request, path, options);
      setSelectedExecution(payload.execution);
      await loadExecutions();
      await loadDeliveries(payload.execution.safeExecutionReference, 0);
      return true;
    } catch (cause) {
      setError(executionErrorLabel(cause.message));
      return false;
    } finally {
      setMutating(false);
    }
  };

  const executeCampaign = async () => {
    if (!canManage || campaign?.status !== 'PREPARED' || mutating) return;
    if (!actionReference.current) actionReference.current = `campaign-execution-ui:${crypto.randomUUID()}`;
    const succeeded = await runMutation(`/api/campaigns/${encodeURIComponent(campaignReference)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionReference: actionReference.current }),
    });
    if (succeeded) actionReference.current = '';
  };

  const resumeExecution = async () => {
    if (!canManage || selectedExecution?.canResume !== true || mutating) return;
    await runMutation(`/api/campaigns/${encodeURIComponent(campaignReference)}/executions/${encodeURIComponent(selectedExecution.safeExecutionReference)}/resume`, { method: 'POST' });
  };

  const cancelExecution = async () => {
    if (!canManage || !selectedExecution || mutating) return;
    await runMutation(`/api/campaigns/${encodeURIComponent(campaignReference)}/executions/${encodeURIComponent(selectedExecution.safeExecutionReference)}/cancel`, { method: 'POST' });
  };

  const canCancel = canManage && (selectedExecution?.pending ?? 0) > 0 && !['COMPLETED', 'CANCELLED'].includes(selectedExecution?.status);
  const contentSummary = campaign?.currentContent?.text || '文字訊息';

  return (
    <section className="rounded-xl border bg-white p-5" data-testid="campaign-execution-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-bold text-gray-900">發送執行</h2><p className="mt-1 text-sm text-gray-600">本次發送使用已凍結的受眾快照。</p></div>
        {campaign?.status === 'PREPARED' && canManage && <button type="button" onClick={() => setDialog('execute')} disabled={mutating} className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">開始發送</button>}
      </div>
      <p className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">本次發送將使用已準備並凍結的受眾名單，不會重新查詢目前 CRM 分群。</p>
      {campaign?.status === 'DRAFT' && <p className="mt-3 rounded border bg-gray-50 p-3 text-sm text-gray-600">活動完成受眾準備後，才可執行發送。</p>}
      {campaign?.status === 'ARCHIVED' && <p className="mt-3 rounded border bg-gray-50 p-3 text-sm text-gray-600">此活動已封存，僅可查看發送歷程。</p>}
      {!canManage && <p className="mt-3 text-sm text-gray-500">你目前具有唯讀權限，可查看發送狀態與歷程。</p>}
      {error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="campaign-execution-precheck">
        <div className="rounded border p-3 text-sm"><span className="text-gray-500">活動名稱</span><strong className="mt-1 block">{campaign?.name || '—'}</strong></div>
        <div className="rounded border p-3 text-sm"><span className="text-gray-500">內容版本</span><strong className="mt-1 block">v{campaign?.currentContentVersion || 0}</strong></div>
        <div className="rounded border p-3 text-sm"><span className="text-gray-500">受眾版本</span><strong className="mt-1 block">v{campaign?.currentAudienceVersion || 0}</strong></div>
        <div className="rounded border p-3 text-sm"><span className="text-gray-500">可發送／排除</span><strong className="mt-1 block">{campaign?.eligibleCount ?? 0}／{campaign?.excludedCount ?? 0}</strong></div>
        <div className="rounded border p-3 text-sm"><span className="text-gray-500">準備時間</span><strong className="mt-1 block">{formatCampaignExecutionTime(campaign?.preparedAt)}</strong></div>
      </div>

      <div className="mt-6"><h3 className="font-semibold text-gray-900">發送歷程</h3>{loading ? <p className="mt-3 text-sm text-gray-500">載入發送歷程中…</p> : <CampaignExecutionHistory executions={executions} selectedReference={selectedExecution?.safeExecutionReference} onSelect={setSelectedExecution} />}</div>

      {selectedExecution && (
        <div className="mt-6 rounded-lg border p-4" data-testid="campaign-execution-detail">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-semibold text-gray-900">執行狀態：{executionStatusLabels[selectedExecution.status] || '未知狀態'}</h3>{selectedExecution.status === 'RUNNING' && <p className="mt-1 text-xs text-gray-500">每 7 秒更新一次後端統計。</p>}</div>
            <div className="flex flex-wrap gap-2">
              {selectedExecution.canResume === true && canManage && <button type="button" onClick={() => setDialog('resume')} disabled={mutating} className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">繼續未完成發送</button>}
              {canCancel && <button type="button" onClick={() => setDialog('cancel')} disabled={mutating} className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50">停止後續發送</button>}
            </div>
          </div>
          {selectedExecution.canResume === true && <p className="mt-3 text-sm font-medium text-blue-800">尚有 {selectedExecution.retryableRemaining ?? 0} 位可繼續處理</p>}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{counterCards(selectedExecution).map(([label, value]) => <div key={label} className="rounded bg-slate-50 p-3 text-sm"><span className="text-gray-500">{label}</span><strong className="mt-1 block text-lg">{value}</strong></div>)}</div>
          <h4 className="mt-5 font-semibold text-gray-900">收件人狀態</h4>
          <CampaignDeliveryList deliveries={deliveries} loading={deliveryLoading} nextOffset={nextOffset} onLoadMore={() => loadDeliveries(selectedExecution.safeExecutionReference, nextOffset)} />
        </div>
      )}

      {dialog && (
        <div role="dialog" aria-modal="true" aria-labelledby="campaign-execution-dialog-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h3 id="campaign-execution-dialog-title" className="text-lg font-bold text-gray-900">{dialog === 'execute' ? '確認發送 LINE 訊息' : dialog === 'resume' ? '確認繼續未完成發送' : '確認停止後續發送'}</h3>
            {dialog === 'execute' && <div className="mt-3 space-y-2 text-sm text-gray-700"><p>確認要向此次已準備的受眾發送 LINE 訊息嗎？已成功送出的訊息無法撤回。</p><p>可發送人數：{campaign?.eligibleCount ?? 0} 位</p><p>訊息摘要：{contentSummary.length > 120 ? `${contentSummary.slice(0, 120)}…` : contentSummary}</p><p>內容版本 v{campaign?.currentContentVersion || 0}／受眾版本 v{campaign?.currentAudienceVersion || 0}</p></div>}
            {dialog === 'resume' && <p className="mt-3 text-sm text-gray-700">系統只會繼續處理尚未成功的收件人，已發送成功者不會重複發送。</p>}
            {dialog === 'cancel' && <p className="mt-3 text-sm text-gray-700">已成功送出的訊息無法撤回；停止後僅取消尚未送出的收件人。</p>}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="rounded border px-4 py-2 text-sm">取消</button><button type="button" disabled={mutating} onClick={async () => { const action = dialog; setDialog(null); if (action === 'execute') await executeCampaign(); else if (action === 'resume') await resumeExecution(); else await cancelExecution(); }} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">確認</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
