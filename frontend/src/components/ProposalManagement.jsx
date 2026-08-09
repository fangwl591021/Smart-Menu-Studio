import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const STATUS_META = {
  draft: { label: '草案', style: 'bg-gray-100 text-gray-700' },
  reviewed: { label: '已檢視', style: 'bg-blue-100 text-blue-700' },
  approved: { label: '已核准', style: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: '已拒絕', style: 'bg-red-100 text-red-700' },
  executed: { label: '已執行', style: 'bg-violet-100 text-violet-700' },
  stale: { label: '已失效', style: 'bg-amber-100 text-amber-800' },
};

const EVENT_LABELS = {
  CREATED: '建立草案',
  REVIEWED: '標記已檢視',
  APPROVED: '核准方案',
  REJECTED: '拒絕方案',
  STALE_DETECTED: '偵測為已失效',
  REGENERATED: '重新產生方案',
  EXECUTION_STARTED: '開始套用方案',
  EXECUTION_SUCCEEDED: '方案套用成功',
  EXECUTION_FAILED: '方案套用失敗',
  ROLLBACK_STARTED: '開始回復操作',
  ROLLBACK_SUCCEEDED: '操作回復成功',
  ROLLBACK_FAILED: '操作回復失敗',
  ROLLBACK_BLOCKED: '操作回復已阻擋',
};

const FIELD_LABELS = {
  action_display_text: 'Postback 顯示文字',
  action_uri: '網址',
};

const STALE_CODES = new Set(['PROPOSAL_STALE', 'TARGET_CHANGED', 'STALE_DURING_EXECUTION']);
const PROBE_REASON_LABELS = {
  HTTPS_REACHABLE: 'HTTPS 端點可連線。',
  PROBE_TIMEOUT: '檢查逾時。',
  HTTPS_FETCH_FAILED: 'HTTPS 端點目前無法連線。',
  HTTPS_STATUS_RESTRICTED: '端點需要授權，系統無法確認。',
  HTTPS_STATUS_NOT_ACCEPTABLE: '端點回應狀態不在允許範圍。',
  URL_CONTAINS_CREDENTIALS: '網址包含帳號密碼，禁止自動檢查。',
  PRIVATE_TARGET_BLOCKED: '內部或私有目標已被阻擋。',
  IP_LITERAL_NOT_SUPPORTED: '不支援 IP 位址網址。',
  NON_STANDARD_PORT_NOT_SUPPORTED: '不支援非標準連接埠。',
  HTTPS_REDIRECT_HOST_CHANGED: '重新導向至不同 hostname，已阻擋。',
  HTTPS_REDIRECT_DOWNGRADE: '重新導向回 HTTP，已阻擋。',
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

export default function ProposalManagement({ projectId, project, userRole = 'viewer', request, refreshKey = 0, onExecuted, onRolledBack }) {
  const [state, setState] = useState({ status: 'loading', proposals: [], error: '' });
  const [detail, setDetail] = useState({ status: 'idle', proposal: null, events: [], operationLogs: [], rollbackPreview: null, httpsProbe: null, error: '' });
  const [busy, setBusy] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [approveConfirm, setApproveConfirm] = useState(false);
  const [executeConfirm, setExecuteConfirm] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [executionFeedback, setExecutionFeedback] = useState(null);

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
    setDetail({ status: 'loading', proposal: null, events: [], operationLogs: [], rollbackPreview: null, httpsProbe: null, error: '' });
    setApproveConfirm(false);
    setExecuteConfirm(false);
    setRejectReason('');
    setRollbackConfirm(false);
    setExecutionFeedback(null);
    try {
      const response = await request(`/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '改善方案讀取失敗。');
      setDetail({
        status: 'success',
        proposal: payload.proposal,
        events: payload.events || [],
        operationLogs: payload.operationLogs || [],
        error: '',
        rollbackPreview: payload.rollbackPreview || null,
        httpsProbe: payload.httpsProbe || null,
      });
      await loadList();
    } catch (error) {
      console.error('Proposal detail request failed', error);
      setDetail({ status: 'error', proposal: null, events: [], operationLogs: [], rollbackPreview: null, httpsProbe: null, error: '目前無法讀取改善方案。' });
    }
  };

  const closeDetail = () => {
    setDetail({ status: 'idle', proposal: null, events: [], operationLogs: [], rollbackPreview: null, httpsProbe: null, error: '' });
    setApproveConfirm(false);
    setExecuteConfirm(false);
    setRejectReason('');
    setExecutionFeedback(null);
    setRollbackConfirm(false);
  };

  const runAction = async (action, options = {}) => {
    const proposal = detail.proposal;
    if (!proposal) return;
    setBusy(action);
    setExecutionFeedback(null);
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

  const probeHttps = async () => {
    const proposal = detail.proposal;
    if (!proposal || busy === 'https-probe') return;
    setBusy('https-probe');
    setExecutionFeedback(null);
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposal.id)}/https-probe`,
        { method: 'POST' },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        const failure = new Error(payload.error || 'HTTPS 檢查失敗。');
        failure.code = payload.code || 'HTTPS_PROBE_UNKNOWN';
        throw failure;
      }
      await loadList();
      await openDetail(proposal.id);
      setExecutionFeedback({
        type: payload.httpsProbe?.status === 'SAFE' ? 'success' : 'blocked',
        message: payload.httpsProbe?.status === 'SAFE'
          ? '✓ HTTPS 可使用'
          : payload.httpsProbe?.status === 'UNSAFE'
            ? '⚠ 不建議自動升級'
            : '○ 無法確認 HTTPS，請人工確認。',
      });
    } catch (error) {
      console.error('HTTPS probe request failed', error);
      setExecutionFeedback({ type: 'error', message: error.message || 'HTTPS 檢查失敗。' });
    } finally {
      setBusy('');
    }
  };

  const executeProposal = async () => {
    const proposal = detail.proposal;
    if (!proposal) return;
    setBusy('execute');
    setExecutionFeedback(null);
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposal.id)}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: true }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        const failure = new Error(payload.error || '改善方案套用失敗。');
        failure.code = payload.code || 'EXECUTION_FAILED';
        throw failure;
      }
      setExecuteConfirm(false);
      setDetail({
        status: 'success',
        proposal: payload.proposal,
        events: payload.events || [],
        operationLogs: payload.operationLogs || [],
        error: '',
      });
      await loadList();
      onExecuted?.(payload.operation);
      await openDetail(payload.proposal.id);
      setExecutionFeedback({
        type: 'success',
        message: proposal.proposalType === 'https-upgrade-candidate' ? '✓ 已升級為 HTTPS' : '✓ 改善方案已套用',
      });
    } catch (error) {
      console.error('Proposal execution request failed', error);
      setExecuteConfirm(false);
      const isStale = STALE_CODES.has(error.code);
      if (isStale || error.code === 'PROPOSAL_ALREADY_EXECUTED') {
        await loadList();
        await openDetail(proposal.id);
      }
      setExecutionFeedback({
        type: isStale ? 'stale' : 'error',
        message: isStale
          ? '⚠ 方案已失效：專案內容在核准後已發生變更，系統沒有覆寫新的設定。'
          : error.message || '改善方案套用失敗。',
      });
    } finally {
      setBusy('');
    }
  };

  const rollbackProposal = async () => {
    const proposal = detail.proposal;
    if (!proposal) return;
    setBusy('rollback');
    setExecutionFeedback(null);
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposal.id)}/rollback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: true }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        const failure = new Error(payload.error || '操作回復失敗。');
        failure.code = payload.code || 'ROLLBACK_EXECUTION_FAILED';
        throw failure;
      }
      setRollbackConfirm(false);
      setDetail({
        status: 'success',
        proposal: payload.proposal,
        events: payload.events || [],
        operationLogs: payload.operationLogs || [],
        rollbackPreview: payload.rollbackPreview || null,
        error: '',
      });
      setExecutionFeedback({
        type: 'success',
        message: proposal.proposalType === 'https-upgrade-candidate' ? '↩ 已回復 HTTP 網址' : '↩ 已安全回復這次修改',
      });
      await loadList();
      onRolledBack?.(payload.rollback);
    } catch (error) {
      console.error('Proposal rollback request failed', error);
      setRollbackConfirm(false);
      const blocked = ['ROLLBACK_TARGET_CHANGED', 'ROLLBACK_TARGET_NOT_FOUND'].includes(error.code);
      const completed = error.code === 'ROLLBACK_ALREADY_COMPLETED';
      if (blocked || completed) {
        await loadList();
        await openDetail(proposal.id);
      }
      setExecutionFeedback({
        type: blocked ? 'blocked' : completed ? 'success' : 'error',
        message: blocked
          ? '⚠ 無法自動回復：此欄位在執行後又被修改，為避免覆蓋較新的資料，系統已阻擋回復。'
          : completed
            ? '此操作已經回復。'
            : error.message || '操作回復失敗。',
      });
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="改善方案">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-gray-900">改善方案</h3>
          <p className="mt-1 text-xs text-gray-500">檢視已儲存的 Proposal、審核狀態、執行結果與完整歷程。</p>
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
              const change = proposal.snapshot?.changes?.[0];
              const area = project?.areas?.find(item => String(item.id) === String(change?.entityId));
              const succeededLog = [...detail.operationLogs].reverse().find(log => log.status === 'succeeded' && !log.revertsOperationId);
              const rollbackLog = [...detail.operationLogs].reverse().find(log => log.status === 'succeeded' && log.revertsOperationId);
              const roleCanManage = ['admin', 'owner'].includes(String(userRole).toLowerCase());
              const roleCanProbe = ['editor', 'admin', 'owner'].includes(String(userRole).toLowerCase());
              const isHttpsProposal = proposal.proposalType === 'https-upgrade-candidate';
              const httpsProbe = detail.httpsProbe;
              const probeEligibility = proposal.execution?.eligibility || httpsProbe?.eligibility || 'NEEDS_PROBE';
              const canProbe = isHttpsProposal
                && roleCanProbe
                && !['executed', 'stale', 'rejected'].includes(proposal.status);
              const canExecute = proposal.status === 'approved'
                && proposal.execution?.executable === true
                && proposal.permissions?.canExecute === true
                && roleCanManage;
              const rollbackPreview = detail.rollbackPreview;
              const canRollback = proposal.status === 'executed'
                && rollbackPreview?.eligible === true
                && rollbackPreview?.canRollback === true
                && roleCanManage;
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
                      ⚠ 方案已失效：專案內容在核准後已發生變更，系統沒有覆寫新的設定。
                    </div>
                  )}
                  {rollbackPreview?.reasonCode === 'TARGET_CHANGED_AFTER_EXECUTION' && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900">
                      ⚠ 無法自動回復：此欄位在執行後又被修改，為避免覆蓋較新的資料，系統已阻擋回復。
                    </div>
                  )}

                  {executionFeedback && (
                    <div className={`rounded-lg border p-4 text-sm font-bold ${executionFeedback.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : ['stale', 'blocked'].includes(executionFeedback.type) ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-700'}`}>
                      {executionFeedback.message}
                    </div>
                  )}

                  <ProposalChanges snapshot={proposal.snapshot} />

                  {(proposal.snapshot?.warnings || [])
                    .filter(warning => !(isHttpsProposal && probeEligibility === 'SAFE' && warning.code === 'HTTPS_SUPPORT_NOT_VERIFIED'))
                    .map(warning => (
                    <div key={warning.code} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">⚠ {warning.message}</div>
                  ))}

                  {isHttpsProposal && (
                    <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950">
                      <div className="font-bold">HTTP → HTTPS 改善方案</div>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                        <dt className="font-bold">目前</dt><dd className="break-all">{displayValue(change?.before)}</dd>
                        <dt className="font-bold">候選</dt><dd className="break-all">{displayValue(change?.after)}</dd>
                      </dl>

                      {busy === 'https-probe' && (
                        <div className="mt-4 flex items-center gap-2 font-bold text-cyan-800">
                          <Loader2 size={15} className="animate-spin" />正在檢查 HTTPS 是否可安全使用…
                        </div>
                      )}
                      {busy !== 'https-probe' && probeEligibility === 'NEEDS_PROBE' && (
                        <div className="mt-4 font-medium">狀態：尚未安全檢查</div>
                      )}
                      {busy !== 'https-probe' && probeEligibility === 'SAFE' && httpsProbe && (
                        <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                          <div className="font-bold">✓ HTTPS 可使用</div>
                          <div className="mt-2 text-xs">檢查時間：{formatTime(httpsProbe.probedAt)}</div>
                          <div className="mt-1 text-xs">HTTP status：{httpsProbe.httpStatus ?? '—'}</div>
                          <div className="mt-1 text-xs">最終 hostname：{httpsProbe.finalUrlHost || '—'}</div>
                        </div>
                      )}
                      {busy !== 'https-probe' && probeEligibility === 'UNSAFE' && httpsProbe && (
                        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                          <div className="font-bold">⚠ 不建議自動升級</div>
                          <div className="mt-1 text-xs">{PROBE_REASON_LABELS[httpsProbe.reasonCode] || httpsProbe.reasonCode}</div>
                        </div>
                      )}
                      {busy !== 'https-probe' && probeEligibility === 'UNKNOWN' && httpsProbe && (
                        <div className="mt-4 rounded-md border border-gray-300 bg-gray-50 p-3 text-gray-800">
                          <div className="font-bold">○ 無法確認 HTTPS</div>
                          <div className="mt-1 text-xs">系統沒有足夠資訊安全地自動修改網址，請人工確認。</div>
                          <div className="mt-1 text-xs">{PROBE_REASON_LABELS[httpsProbe.reasonCode] || httpsProbe.reasonCode}</div>
                        </div>
                      )}
                      {busy !== 'https-probe' && probeEligibility === 'EXPIRED' && (
                        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 font-bold text-amber-950">HTTPS 檢查已過期，請重新檢查。</div>
                      )}
                      <div className="mt-3 text-xs text-cyan-900">此檢查只確認 HTTPS 端點可連線，不代表網站內容或安全性已完整驗證。</div>
                      {canProbe && (
                        <button type="button" onClick={probeHttps} disabled={Boolean(busy)} className="mt-4 rounded-md bg-cyan-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                          {busy === 'https-probe' ? '檢查中…' : httpsProbe ? '重新檢查 HTTPS' : '檢查 HTTPS'}
                        </button>
                      )}
                    </div>
                  )}

                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-4 text-xs">
                    <dt className="font-bold text-gray-500">建立者</dt><dd>{proposal.createdBy?.name || '使用者'}</dd>
                    <dt className="font-bold text-gray-500">建立時間</dt><dd>{formatTime(proposal.createdAt)}</dd>
                    <dt className="font-bold text-gray-500">檢視者</dt><dd>{proposal.reviewedBy?.name || '—'}</dd>
                    <dt className="font-bold text-gray-500">核准者</dt><dd>{proposal.approvedBy?.name || '—'}</dd>
                    <dt className="font-bold text-gray-500">執行時間</dt><dd>{formatTime(proposal.executedAt)}</dd>
                  </dl>

                  {proposal.status === 'executed' && succeededLog && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                      <div className="font-bold">✓ 改善方案已套用</div>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                        <dt className="font-bold">修改欄位</dt><dd>{succeededLog.operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS' ? 'HTTP → HTTPS' : 'Postback 顯示文字'}</dd>
                        <dt className="font-bold">Before</dt><dd className="break-all">{displayValue(succeededLog.before?.actionUri ?? succeededLog.before?.actionDisplayText)}</dd>
                        <dt className="font-bold">After</dt><dd className="break-all">{displayValue(succeededLog.after?.actionUri ?? succeededLog.after?.actionDisplayText)}</dd>
                        <dt className="font-bold">執行者</dt><dd>{succeededLog.actorName || '使用者'}</dd>
                        <dt className="font-bold">執行時間</dt><dd>{formatTime(succeededLog.completedAt)}</dd>
                      </dl>
                    </div>
                  )}


                  {rollbackLog && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                      <div className="font-bold">↩ 已回復</div>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                        <dt className="font-bold">Before</dt><dd className="break-all">{displayValue(rollbackLog.before?.actionUri ?? rollbackLog.before?.actionDisplayText)}</dd>
                        <dt className="font-bold">After</dt><dd className="break-all">{displayValue(rollbackLog.after?.actionUri ?? rollbackLog.after?.actionDisplayText)}</dd>
                        <dt className="font-bold">回復者</dt><dd>{rollbackLog.actorName || '使用者'}</dd>
                        <dt className="font-bold">回復時間</dt><dd>{formatTime(rollbackLog.completedAt)}</dd>
                      </dl>
                    </div>
                  )}

                  <div>
                    <div className="text-sm font-bold">操作歷程</div>
                    <div className="mt-2 space-y-2">
                      {detail.operationLogs.map(log => (
                        <div key={log.id} className="rounded-lg border border-gray-200 p-3 text-xs">
                          <div className="font-bold">
                            {log.operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS'
                              ? log.revertsOperationId ? '↩ 回復 HTTP 網址' : 'HTTP → HTTPS'
                              : log.revertsOperationId ? '↩ 回復 Postback 顯示文字' : '套用 Postback 顯示文字'}
                          </div>
                          <div className="mt-1 text-gray-500">{log.actorName || '使用者'} · {formatTime(log.completedAt || log.createdAt)}</div>
                          <div className="mt-2 break-all">{displayValue(log.before?.actionUri ?? log.before?.actionDisplayText)} → {displayValue(log.after?.actionUri ?? log.after?.actionDisplayText)}</div>
                          <div className="mt-1 font-medium">狀態：{log.status === 'succeeded' ? '成功' : log.status === 'failed' ? '失敗' : '處理中'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-bold">Timeline</div>
                    <div className="mt-2 space-y-2">
                      {detail.events.map(event => (
                        <div key={event.id} className="rounded-lg border border-gray-200 p-3 text-xs">
                          <div className="font-bold">{EVENT_LABELS[event.eventType] || event.eventType}</div>
                          <div className="mt-1 text-gray-500">{event.actorName || '系統'} · {formatTime(event.createdAt)}</div>
                          {event.metadata?.rejectReason && <div className="mt-2 text-gray-700">原因：{event.metadata.rejectReason}</div>}
                          {event.metadata?.errorCode && <div className="mt-2 text-red-700">錯誤代碼：{event.metadata.errorCode}</div>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {detail.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{detail.error}</div>}

                  {approveConfirm && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                      <div>核准代表同意此改善方案；只有後續由管理員確認套用，才會修改正式 Project Area。</div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button type="button" onClick={() => setApproveConfirm(false)} className="rounded-md border border-blue-300 px-3 py-2 font-bold">取消</button>
                        <button type="button" onClick={() => runAction('approve')} disabled={busy === 'approve'} className="rounded-md bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-50">確認核准</button>
                      </div>
                    </div>
                  )}

                  {executeConfirm && canExecute && (
                    <div className="rounded-lg border-2 border-violet-300 bg-violet-50 p-4 text-sm text-violet-950">
                      <div className="font-bold">即將修改正式專案資料</div>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                        <dt className="font-bold">專案</dt><dd>{project?.name || '目前專案'}</dd>
                        <dt className="font-bold">區域</dt><dd>{area?.label || `區域 ${change?.entityId ?? ''}`}</dd>
                        <dt className="font-bold">欄位</dt><dd>{isHttpsProposal ? '網址（HTTP → HTTPS）' : 'Postback 顯示文字'}</dd>
                        <dt className="font-bold">目前</dt><dd>{displayValue(change?.before)}</dd>
                        <dt className="font-bold">修改後</dt><dd>{displayValue(change?.after)}</dd>
                      </dl>
                      {isHttpsProposal && <div className="mt-3 text-xs font-bold">HTTPS Probe：{httpsProbe?.status || '—'} · {formatTime(httpsProbe?.probedAt)}</div>}
                      <div className="mt-4 font-bold">{isHttpsProposal ? '此操作只修改此 Project Area 的網址，不會修改 Template。' : '此操作會修改正式專案資料。'}</div>
                      <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setExecuteConfirm(false)} className="rounded-md border border-violet-300 px-3 py-2 font-bold">取消</button>
                        <button type="button" onClick={executeProposal} disabled={busy === 'execute'} className="rounded-md bg-violet-700 px-3 py-2 font-bold text-white disabled:opacity-50">
                          {busy === 'execute' ? '套用中…' : isHttpsProposal ? '確認套用 HTTPS' : '確認套用'}
                        </button>
                      </div>
                    </div>
                  )}

                  {rollbackConfirm && canRollback && (
                    <div className="rounded-lg border-2 border-sky-300 bg-sky-50 p-4 text-sm text-sky-950">
                      <div className="font-bold">即將回復這次 AI Operation</div>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                        <dt className="font-bold">區域</dt><dd>{rollbackPreview.target?.label || '專案區域'}</dd>
                        <dt className="font-bold">欄位</dt><dd>{isHttpsProposal ? '網址' : 'Postback 顯示文字'}</dd>
                        <dt className="font-bold">目前</dt><dd>{displayValue(rollbackPreview.rollback?.current)}</dd>
                        <dt className="font-bold">回復為</dt><dd>{displayValue(rollbackPreview.rollback?.restoreTo)}</dd>
                      </dl>
                      <div className="mt-4 font-bold">{isHttpsProposal ? '只有目前網址仍保持本次套用結果時才會回復。' : '只有這次 AI Operation 所修改的欄位會被回復。'}</div>
                      <div className="mt-1">如果資料已被其他操作修改，系統將拒絕回復；不提供強制回復。</div>
                      <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setRollbackConfirm(false)} className="rounded-md border border-sky-300 px-3 py-2 font-bold">取消</button>
                        <button type="button" onClick={rollbackProposal} disabled={busy === 'rollback'} className="rounded-md bg-sky-700 px-3 py-2 font-bold text-white disabled:opacity-50">{busy === 'rollback' ? '回復中…' : isHttpsProposal ? '確認回復 HTTP 網址' : '確認回復'}</button>
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
                    {canExecute && !executeConfirm && <button type="button" onClick={() => setExecuteConfirm(true)} disabled={Boolean(busy)} className="rounded-md bg-violet-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{isHttpsProposal ? '套用 HTTPS' : '套用已核准方案'}</button>}
                    {canRollback && !rollbackConfirm && <button type="button" onClick={() => setRollbackConfirm(true)} disabled={Boolean(busy)} className="rounded-md bg-sky-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{isHttpsProposal ? '回復 HTTP 網址' : '回復這次修改'}</button>}
                  </div>

                  <div className="rounded-lg bg-indigo-50 p-3 text-xs font-medium text-indigo-800">
                    P001 與通過新鮮 SAFE Probe 的 P002 可由 admin／owner 套用與安全回復；P003–P005 維持不可執行。系統不會修改 Template、R2 或發布 LINE Rich Menu，也沒有略過安全檢查的操作。
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
