import React, { Component, useMemo, useState } from 'react';

const PRIORITY_META = {
  high: { label: '高優先', symbol: '⚠', style: 'border-red-200 bg-red-50 text-red-900' },
  medium: { label: '中優先', symbol: '○', style: 'border-amber-200 bg-amber-50 text-amber-900' },
  low: { label: '低優先', symbol: '○', style: 'border-gray-200 bg-gray-50 text-gray-800' },
};

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

function RecommendationContent({ result, onAction }) {
  const [expandedId, setExpandedId] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [fallbackId, setFallbackId] = useState('');
  const recommendations = Array.isArray(result?.recommendations) ? result.recommendations : [];
  const visible = showAll ? recommendations : recommendations.slice(0, 5);
  const groups = useMemo(() => ['high', 'medium', 'low'].map(priority => ({
    priority,
    items: visible.filter(item => item?.priority === priority),
  })).filter(group => group.items.length), [visible]);

  if (result?.error) {
    return <div className="border-t border-current/15 pt-3 text-sm text-red-700">目前無法取得智慧建議。</div>;
  }

  const viewSetting = async recommendation => {
    setFallbackId('');
    const action = recommendation.suggestedAction;
    const handled = await onAction?.({
      type: action?.type || 'none',
      target: action?.target || recommendation.target || '',
    });
    if (handled === false) setFallbackId(recommendation.id);
  };

  return (
    <section className="mt-4 border-t border-current/15 pt-3" aria-label="智慧建議">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">💡 智慧建議</h3>
        <span className="rounded-full bg-white/75 px-2 py-1 text-xs font-bold">{recommendations.length}</span>
      </div>

      {recommendations.length === 0 ? (
        <div className="mt-2 text-xs opacity-70">目前沒有智慧建議。</div>
      ) : (
        <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
          {groups.map(group => {
            const meta = PRIORITY_META[group.priority];
            return (
              <div key={group.priority}>
                <div className="mb-1.5 text-[11px] font-bold opacity-70">{meta.label}</div>
                <div className="space-y-2">
                  {group.items.map(recommendation => {
                    const expanded = expandedId === recommendation.id;
                    const actionType = recommendation.suggestedAction?.type;
                    const canNavigate = actionType && actionType !== 'none';
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

                        {fallbackId === recommendation.id && (
                          <div className="mt-2 font-medium text-red-700">請前往對應設定頁完成此步驟。</div>
                        )}

                        <div className="mt-2 flex justify-end gap-3">
                          <button type="button" onClick={() => setExpandedId(expanded ? '' : recommendation.id)} className="font-bold underline">
                            {expanded ? '收合' : '查看'}
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
