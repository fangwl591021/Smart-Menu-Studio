import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const STATUS_META = {
  draft: { label: '草案', style: 'bg-gray-100 text-gray-700' },
  reviewed: { label: '已檢視', style: 'bg-blue-100 text-blue-700' },
  approved: { label: '已核准', style: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: '已拒絕', style: 'bg-red-100 text-red-700' },
  stale: { label: '已失效', style: 'bg-amber-100 text-amber-800' },
};

const EVENT_LABELS = {
  CREATED: '建立草案',
  REVIEWED: '標記已檢視',
  APPROVED: '核准方案',
  REJECTED: '拒絕方案',
  STALE_DETECTED: '偵測為已失效',
  REGENERATED: '重新產生方案',
};

const FIELD_LABELS = {
  action_display_text: '顯示文字',
  action_uri: '網址',
};

const displayValue = value => value === '' || value === null ? '未設定' : String(value);
const formatTime = value => value ? new Date(value.replace(' ', 'T') + (value.includes('T') ? '' : 'Z')).toLocaleString('zh-TW') : '—';

function ProposalChanges({ snapshot }) {
  const changes = Array.isArray(snapshot?.changes) ? snapshot.changes : [];
  if (changes.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        此方案需要人工判斷，因此沒有自動修改內容。
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {changes.map(change => (
        <div key={change.id} className="rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-bold text-gray-500">{FIELD_LABELS[change.field] || change.field}</div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-gray-100 p-3">
              <div className="text-[11px] font-bold text-gray-500">目前</div>
              <div className="mt-1 break-all">{displayValue(change.before)}</div>
            </div>
            <div className="rounded-md bg-emerald-50 p-3">
              <div className="text-[11px] font-bold text-emerald-700">建議</div>
              <div className="mt-1 break-all">{displayValue(change.after)}</div>
            </div>
          </div>
          <div className="mt-3 text-xs leading-5 text-gray-600">原因：{change.reason}</div>
        </div>
      ))}
    </div>
  );
}

export default function ProposalManagement({ projectId, request, refreshKey = 0 }) {
  const [state, setState] = useState({ status: 'loading', proposals: [], error: '' });
  const [detail, setDetail] = useState({ status: 'idle', proposal: null, events: [], error: '' });
  const [busy, setBusy] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [approveConfirm, setApproveConfirm] = useState(false);

  const loadList = useCallback(async () => {
    setState(previous => ({ ...previous, status: 'loading', error: '' }));
    try {
      const response = await request(`/api/projects/${encodeURIComponent(projectId)}/proposals`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '改善方案列表讀取失敗。');
      setState({ status: 'success', proposals: Array.isArray(payload.proposals) ? payload.proposals : [], error: '' });
    } catch (error) {
      console.error('Proposal list request failed', error);
      setState({ status: 'error', proposals: [], error: '目前無法取得改善方案。' });
    }
  }, [projectId, request]);

  useEffect(() => {
    if (projectId) loadList();
  }, [loadList, projectId, refreshKey]);

  const openDetail = async proposalId => {
    setDetail({ status: 'loading', proposal: null, events: [], error: '' });
    setApproveConfirm(false);
    setRejectReason('');
    try {
      const response = await request(`/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '改善方案讀取失敗。');
      setDetail({ status: 'success', proposal: payload.proposal, events: payload.events || [], error: '' });
      await loadList();
    } catch (error) {
      console.error('Proposal detail request failed', error);
      setDetail({ status: 'error', proposal: null, events: [], error: '目前無法讀取改善方案。' });
    }
  };

  const closeDetail = () => {
    setDetail({ status: 'idle', proposal: null, events: [], error: '' });
    setApproveConfirm(false);
    setRejectReason('');
  };

  const runAction = async (action, options = {}) => {
    const proposal = detail.proposal;
    if (!proposal) return;
    setBusy(action);
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposal.id)}/${action}`,
        { method: 'POST', ...options },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '改善方案狀態更新失敗。');
      setApproveConfirm(false);
      setRejectReason('');
      await loadList();
      await openDetail(payload.proposal.id);
    } catch (error) {
      console.error('Proposal workflow request failed', error);
      setDetail(previous => ({ ...previous, error: error.message || '改善方案狀態更新失敗。' }));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="改善方案">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-gray-900">改善方案</h3>
          <p className="mt-1 text-xs text-gray-500">檢視已儲存的 Proposal 草案、審核狀態與完整歷程。</p>
        </div>
        <button type="button" onClick={loadList} className="text-xs font-bold text-blue-600 underline">重新整理</button>
      </div>

      {state.status === 'loading' && (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" />載入改善方案…</div>
      )}
      {state.status === 'error' && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</div>}
      {state.status === 'success' && state.proposals.length === 0 && (
        <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-500">尚未儲存改善方案草案。</div>
      )}
      {state.status === 'success' && state.proposals.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
          {state.proposals.map(proposal => {
            const meta = STATUS_META[proposal.status] || STATUS_META.draft;
            return (
              <button
                key={proposal.id}
                type="button"
                onClick={() => openDetail(proposal.id)}
                className="grid w-full grid-cols-[1fr_auto] gap-3 border-b border-gray-100 p-3 text-left last:border-b-0 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-gray-900">{proposal.title}</div>
                  <div className="mt-1 text-xs text-gray-500">來源 {proposal.ruleCode} · {formatTime(proposal.createdAt)} · {proposal.createdBy?.name || '使用者'}</div>
                </div>
                <span className={`self-center rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.style}`}>{meta.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {detail.status !== 'idle' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/55 p-4" role="dialog" aria-modal="true" aria-label="改善方案詳情">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-gray-900 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-700">Proposal Review</div>
                <h3 className="mt-2 text-lg font-bold">改善方案詳情</h3>
              </div>
              <button type="button" onClick={closeDetail} className="rounded-md px-2 py-1 text-sm font-bold text-gray-500 hover:bg-gray-100">關閉</button>
            </div>

            {detail.status === 'loading' && <div className="flex justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 size={17} className="animate-spin" />載入中…</div>}
            {detail.status === 'error' && <div className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{detail.error}</div>}

            {detail.status === 'success' && detail.proposal && (() => {
              const proposal = detail.proposal;
              const meta = STATUS_META[proposal.status] || STATUS_META.draft;
              return (
                <div className="mt-5 space-y-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.style}`}>{meta.label}</span>
                      <span className="text-xs text-gray-500">{proposal.ruleCode} · {proposal.generatedBy}</span>
                    </div>
                    <div className="mt-3 font-bold">{proposal.title}</div>
                    <div className="mt-1 text-sm leading-6 text-gray-600">{proposal.summary}</div>
                  </div>

                  {proposal.status === 'stale' && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900">
                      ⚠ 此改善方案建立後，相關設定已發生變更。
                    </div>
                  )}

                  <ProposalChanges snapshot={proposal.snapshot} />

                  {(proposal.snapshot?.warnings || []).map(warning => (
                    <div key={warning.code} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">⚠ {warning.message}</div>
                  ))}

                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-4 text-xs">
                    <dt className="font-bold text-gray-500">建立者</dt><dd>{proposal.createdBy?.name || '使用者'}</dd>
                    <dt className="font-bold text-gray-500">建立時間</dt><dd>{formatTime(proposal.createdAt)}</dd>
                    <dt className="font-bold text-gray-500">檢視者</dt><dd>{proposal.reviewedBy?.name || '—'}</dd>
                    <dt className="font-bold text-gray-500">核准者</dt><dd>{proposal.approvedBy?.name || '—'}</dd>
                  </dl>

                  <div>
                    <div className="text-sm font-bold">Timeline</div>
                    <div className="mt-2 space-y-2">
                      {detail.events.map(event => (
                        <div key={event.id} className="rounded-lg border border-gray-200 p-3 text-xs">
                          <div className="font-bold">{EVENT_LABELS[event.eventType] || event.eventType}</div>
                          <div className="mt-1 text-gray-500">{event.actorName || '系統'} · {formatTime(event.createdAt)}</div>
                          {event.metadata?.rejectReason && <div className="mt-2 text-gray-700">原因：{event.metadata.rejectReason}</div>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {detail.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{detail.error}</div>}

                  {approveConfirm && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                      <div>核准只代表同意此改善方案，目前不會修改任何 Project 設定。</div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button type="button" onClick={() => setApproveConfirm(false)} className="rounded-md border border-blue-300 px-3 py-2 font-bold">取消</button>
                        <button type="button" onClick={() => runAction('approve')} disabled={busy === 'approve'} className="rounded-md bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-50">確認核准</button>
                      </div>
                    </div>
                  )}

                  {proposal.permissions?.canReject && (
                    <div className="rounded-lg border border-gray-200 p-4">
                      <label className="block text-xs font-bold text-gray-600">拒絕原因</label>
                      <textarea value={rejectReason} onChange={event => setRejectReason(event.target.value)} maxLength={300} rows={2} className="mt-2 w-full rounded-md border border-gray-300 p-2 text-sm" placeholder="請輸入簡短原因" />
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-2">
                    {proposal.permissions?.canReview && <button type="button" onClick={() => runAction('review')} disabled={Boolean(busy)} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-bold disabled:opacity-50">標記已檢視</button>}
                    {proposal.permissions?.canApprove && !approveConfirm && <button type="button" onClick={() => setApproveConfirm(true)} disabled={Boolean(busy)} className="rounded-md bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">核准方案</button>}
                    {proposal.permissions?.canReject && <button type="button" onClick={() => runAction('reject', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rejectReason }) })} disabled={Boolean(busy) || rejectReason.trim().length < 3} className="rounded-md bg-red-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">拒絕方案</button>}
                    {proposal.permissions?.canRegenerate && <button type="button" onClick={() => runAction('regenerate')} disabled={Boolean(busy)} className="rounded-md bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">重新產生方案</button>}
                  </div>

                  <div className="rounded-lg bg-indigo-50 p-3 text-xs font-medium text-indigo-800">
                    此流程只保存與審核 Proposal，不會修改 Project、Project Area 或發布 LINE。
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
