import React, { Component, useMemo, useRef, useState } from 'react';

const PRIORITY_META = {
  high: { label: '高優先', symbol: '⚠', style: 'border-red-200 bg-red-50 text-red-900' },
  medium: { label: '中優先', symbol: '○', style: 'border-amber-200 bg-amber-50 text-amber-900' },
  low: { label: '低優先', symbol: '○', style: 'border-gray-200 bg-gray-50 text-gray-800' },
};

const FIELD_LABELS = {
  action_display_text: '顯示文字',
  action_uri: '網址',
};

const displayProposalValue = value => value === '' || value === null ? '未設定' : String(value);

class RecommendationErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('Smart Guide recommendation rendering failed', error);
  }

  render() {
    if (this.state.failed) {
      return <div className="border-t border-current/15 pt-3 text-sm text-red-700">目前無法取得智慧建議。</div>;
    }
    return this.props.children;
  }
}

function RecommendationContent({ result, onAction, request, projectId, userRole = 'viewer', onProposalSaved }) {
  const [expandedId, setExpandedId] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [fallbackId, setFallbackId] = useState('');
  const [explanationStates, setExplanationStates] = useState({});
  const [proposalState, setProposalState] = useState({ status: 'idle', recommendation: null, proposal: null, error: '' });
  const proposalRequestRef = useRef(0);
  const recommendations = Array.isArray(result?.recommendations) ? result.recommendations : [];
  const visible = showAll ? recommendations : recommendations.slice(0, 5);
  const groups = useMemo(() => [
    { priority: 'improvement', label: '改善建議', items: visible.filter(item => item?.tone !== 'positive') },
    { priority: 'positive', label: '表現良好', items: visible.filter(item => item?.tone === 'positive') },
  ].filter(group => group.items.length), [visible]);

  if (result?.error) {
    return <div className="border-t border-current/15 pt-3 text-sm text-red-700">目前無法取得智慧建議。</div>;
  }

  const viewSetting = async recommendation => {
    setFallbackId('');
    const action = recommendation.suggestedAction;
    const intelligenceTarget = recommendation.ruleCode === 'R109' || recommendation.ruleCode === 'R110'
      ? 'intelligence-trend'
      : recommendation.entityType === 'project_area'
        ? `intelligence-area-${recommendation.entityId}`
        : 'intelligence-summary';
    const handled = await onAction?.({
      type: action?.type || 'none',
      target: action?.target === 'intelligence' ? intelligenceTarget : (action?.target || recommendation.target || ''),
    });
    if (handled === false) setFallbackId(recommendation.id);
  };

  const loadExplanation = async recommendation => {
    setExplanationStates(previous => ({ ...previous, [recommendation.id]: { status: 'loading' } }));
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/guide/recommendations/${encodeURIComponent(recommendation.id)}/explain`,
        { method: 'POST' },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '目前無法取得 AI 說明。');
      if (
        payload.recommendation?.id !== recommendation.id
        || payload.recommendation?.ruleCode !== recommendation.ruleCode
        || payload.recommendation?.priority !== recommendation.priority
      ) {
        throw new Error('AI 說明與目前建議不一致。');
      }
      const explanation = payload.explanation;
      if (
        !explanation
        || !['generated', 'fallback'].includes(explanation.status)
        || typeof explanation.summary !== 'string'
        || typeof explanation.whyItMatters !== 'string'
        || typeof explanation.suggestedApproach !== 'string'
      ) {
        throw new Error('AI 說明格式無效。');
      }
      setExplanationStates(previous => ({
        ...previous,
        [recommendation.id]: { status: explanation.status === 'fallback' ? 'fallback' : 'success', explanation },
      }));
    } catch (error) {
      console.error('Smart Guide explanation request failed', error);
      setExplanationStates(previous => ({ ...previous, [recommendation.id]: { status: 'error' } }));
    }
  };

  const loadProposal = async recommendation => {
    const requestId = proposalRequestRef.current + 1;
    proposalRequestRef.current = requestId;
    setProposalState({ status: 'loading', recommendation, proposal: null, error: '' });
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/guide/recommendations/${encodeURIComponent(recommendation.id)}/proposal`,
        { method: 'POST' },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '目前無法產生改善方案預覽。');
      const proposal = payload.proposal;
      if (
        payload.recommendation?.id !== recommendation.id
        || payload.recommendation?.ruleCode !== recommendation.ruleCode
        || !proposal
        || proposal.recommendationId !== recommendation.id
        || proposal.projectId !== projectId
        || proposal.status !== 'preview'
        || proposal.canApply !== false
        || !Array.isArray(proposal.changes)
        || !Array.isArray(proposal.warnings)
      ) {
        throw new Error('改善方案預覽格式無效。');
      }
      if (proposalRequestRef.current === requestId) {
        setProposalState({ status: 'success', recommendation, proposal, error: '' });
      }
    } catch (error) {
      console.error('Smart Guide proposal request failed', error);
      if (proposalRequestRef.current === requestId) {
        setProposalState({ status: 'error', recommendation, proposal: null, error: '目前無法產生改善方案預覽。' });
      }
    }
  };

  const saveProposal = async () => {
    const recommendation = proposalState.recommendation;
    if (!recommendation || proposalState.status !== 'success') return;
    setProposalState(previous => ({ ...previous, saveStatus: 'saving', saveError: '' }));
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/guide/recommendations/${encodeURIComponent(recommendation.id)}/proposals`,
        { method: 'POST' },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success || payload.proposal?.status !== 'draft') {
        throw new Error(payload.error || '改善方案草案儲存失敗。');
      }
      setProposalState(previous => ({ ...previous, saveStatus: 'success', saveError: '', savedProposal: payload.proposal }));
      onProposalSaved?.(payload.proposal);
    } catch (error) {
      console.error('Proposal draft save failed', error);
      setProposalState(previous => ({ ...previous, saveStatus: 'error', saveError: error.message || '改善方案草案儲存失敗。' }));
    }
  };
  const closeProposal = () => {
    proposalRequestRef.current += 1;
    setProposalState({ status: 'idle', recommendation: null, proposal: null, error: '' });
  };
  return (
    <section className="mt-4 border-t border-current/15 pt-3" aria-label="智慧建議">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">💡 智慧建議</h3>
        <span className="rounded-full bg-white/75 px-2 py-1 text-xs font-bold">{recommendations.length}</span>
      </div>

      {result?.behaviorDataQuality?.sufficient === false && (<div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">目前尚無足夠的 LINE 互動資料，因此暫時無法提供智慧建議。</div>)}

      {recommendations.length === 0 ? (
        <div className="mt-2 text-xs opacity-70">目前沒有智慧建議。</div>
      ) : (
        <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
          {groups.map(group => {
            const meta = PRIORITY_META[group.priority] || (group.priority === 'positive' ? { label: group.label, symbol: 'OK', style: 'border-emerald-200 bg-emerald-50 text-emerald-900' } : { label: group.label, symbol: '!', style: 'border-amber-200 bg-amber-50 text-amber-900' });
            return (
              <div key={group.priority}>
                <div className="mb-1.5 text-[11px] font-bold opacity-70">{meta.label}</div>
                <div className="space-y-2">
                  {group.items.map(recommendation => {
                    const expanded = expandedId === recommendation.id;
                    const actionType = recommendation.suggestedAction?.type;
                    const canNavigate = actionType && actionType !== 'none';
                    const explanationState = explanationStates[recommendation.id] || { status: 'idle' };
                    return (
                      <article key={recommendation.id} className={`rounded-lg border p-3 text-xs ${meta.style}`}>
                        <div className="flex items-start gap-2">
                          <span className="shrink-0">{meta.symbol}</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold">{recommendation.title}</div>
                            <div className="mt-1 leading-5 opacity-85">{recommendation.message}</div>
                          </div>
                        </div>

                        {expanded && (
                          <div className="mt-2 border-t border-current/15 pt-2 leading-5">
                            <div><span className="font-bold">原因：</span>{recommendation.reason}</div>
                            {Array.isArray(recommendation.evidence) && recommendation.evidence.length > 0 && (
                              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 opacity-75">
                                {recommendation.evidence.map(item => (
                                  <React.Fragment key={`${recommendation.id}-${item.key}`}>
                                    <dt className="font-mono">{item.key}</dt>
                                    <dd className="break-words">{String(item.value)}</dd>
                                  </React.Fragment>
                                ))}
                              </dl>
                            )}
                          </div>
                        )}

                        {expanded && recommendation.proposal?.available === false && (
                          <div className="mt-2 text-[11px] opacity-70">目前僅提供改善建議，尚無安全的自動變更草案。</div>
                        )}

                        {fallbackId === recommendation.id && (
                          <div className="mt-2 font-medium text-red-700">請前往對應設定頁完成此步驟。</div>
                        )}
                        {explanationState.status !== 'idle' && (
                          <div className="mt-2 rounded-md border border-current/15 bg-white/70 p-2 leading-5" aria-live="polite">
                            {explanationState.status === 'loading' && <div className="font-medium">AI 說明載入中…</div>}
                            {explanationState.status === 'error' && <div className="font-medium text-red-700">目前無法取得 AI 說明，請稍後再試。</div>}
                            {(explanationState.status === 'success' || explanationState.status === 'fallback') && (
                              <>
                                <div className="font-bold">{explanationState.status === 'success' ? 'AI 說明' : '規則說明（AI 暫不可用）'}</div>
                                <div className="mt-1">{explanationState.explanation.summary}</div>
                                <div className="mt-1"><span className="font-bold">為什麼重要：</span>{explanationState.explanation.whyItMatters}</div>
                                {explanationState.explanation.suggestedApproach && (
                                  <div className="mt-1"><span className="font-bold">建議方向：</span>{explanationState.explanation.suggestedApproach}</div>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        <div className="mt-2 flex justify-end gap-3">
                          <button type="button" onClick={() => setExpandedId(expanded ? '' : recommendation.id)} className="font-bold underline">
                            {expanded ? '收合' : '查看'}
                          </button>
                          {recommendation.tone !== 'positive' && recommendation.proposal?.available && (
                            <button
                              type="button"
                              onClick={() => loadProposal(recommendation)}
                              className="font-bold underline"
                            >
                              查看改善方案
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => loadExplanation(recommendation)}
                            disabled={explanationState.status === 'loading'}
                            className="font-bold underline disabled:cursor-wait disabled:opacity-60"
                          >
                            {explanationState.status === 'loading' ? '載入中…' : 'AI 說明'}
                          </button>
                          {canNavigate && (
                            <button type="button" onClick={() => viewSetting(recommendation)} className="font-bold underline">
                              帶我查看
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {recommendations.length > 5 && (
        <button type="button" onClick={() => setShowAll(value => !value)} className="mt-2 text-xs font-bold underline">
          {showAll ? '只顯示前 5 項' : `顯示全部 ${recommendations.length} 項`}
        </button>
      )}

      {proposalState.status !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4" role="dialog" aria-modal="true" aria-label="改善方案預覽">
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 text-gray-900 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-700">僅供預覽</div>
                <h3 className="mt-2 text-lg font-bold">✨ 改善方案預覽</h3>
              </div>
              <button type="button" onClick={closeProposal} className="rounded-md px-2 py-1 text-sm font-bold text-gray-500 hover:bg-gray-100">關閉</button>
            </div>

            {proposalState.status === 'loading' && (
              <div className="py-10 text-center text-sm text-gray-600">正在重新計算改善方案預覽…</div>
            )}

            {proposalState.status === 'error' && (
              <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{proposalState.error}</div>
            )}

            {proposalState.status === 'success' && proposalState.proposal && (
              <div className="mt-5 space-y-4 text-sm">
                <div>
                  <div className="font-bold">{proposalState.proposal.title}</div>
                  <div className="mt-1 leading-6 text-gray-600">{proposalState.proposal.summary}</div>
                </div>

                {proposalState.proposal.changes.length > 0 ? (
                  <div className="space-y-3">
                    {proposalState.proposal.changes.map(change => (
                      <div key={change.id} className="rounded-lg border border-gray-200 p-4">
                        <div className="text-xs font-bold text-gray-500">{FIELD_LABELS[change.field] || change.field}</div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className="rounded-md bg-gray-100 p-3">
                            <div className="text-[11px] font-bold text-gray-500">目前</div>
                            <div className="mt-1 break-all">{displayProposalValue(change.before)}</div>
                          </div>
                          <div className="rounded-md bg-emerald-50 p-3">
                            <div className="text-[11px] font-bold text-emerald-700">建議</div>
                            <div className="mt-1 break-all">{displayProposalValue(change.after)}</div>
                          </div>
                        </div>
                        <div className="mt-3 text-xs leading-5 text-gray-600">原因：{change.reason}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    此建議目前需要人工判斷，因此沒有自動修改內容。
                  </div>
                )}

                {proposalState.proposal.warnings.map(warning => (
                  <div key={warning.code} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                    ⚠ {warning.message}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 rounded-lg bg-indigo-50 p-3 text-xs font-medium text-indigo-800">
              ⚠ 這只是預覽，系統尚未修改任何資料。
            </div>
            {proposalState.saveStatus === 'success' && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-700">✓ 已儲存改善方案</div>
            )}
            {proposalState.saveStatus === 'error' && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{proposalState.saveError}</div>
            )}
            {proposalState.status === 'success' && ['editor', 'admin', 'owner'].includes(String(userRole).toLowerCase()) && proposalState.saveStatus !== 'success' && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={saveProposal}
                  disabled={proposalState.saveStatus === 'saving'}
                  className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {proposalState.saveStatus === 'saving' ? '儲存中…' : '儲存為草案'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function RecommendationSection(props) {
  return (
    <RecommendationErrorBoundary>
      <RecommendationContent {...props} />
    </RecommendationErrorBoundary>
  );
}
