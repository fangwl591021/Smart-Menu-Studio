import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const FEATURE_LABELS = {
  recommendation_explanation: '智慧建議說明',
  proposal_explanation: '改善方案說明',
  rich_menu_image_analysis: '圖文選單圖片分析',
  guide_explanation: 'Guide 說明',
  operation_plan_assist: '執行計畫輔助',
  line_oa_intelligence: 'LINE OA 智慧功能',
  content_generation: '內容生成',
  unknown_ai_feature: '其他 AI 功能',
};

const number = value => Number(value || 0).toLocaleString('zh-TW');
const usd = micros => new Intl.NumberFormat('zh-TW', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6,
}).format(Number(micros || 0) / 1_000_000);

function Metric({ label, value, hint }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold text-gray-500">{label}</div><div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>{hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}</div>;
}

function BreakdownTable({ title, rows, identity, systemAdmin = false }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-5 py-4 font-bold text-gray-900">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-3 text-left">項目</th><th className="px-4 py-3 text-right">Requests</th><th className="px-4 py-3 text-right">Input</th><th className="px-4 py-3 text-right">Output</th><th className="px-4 py-3 text-right">Tokens</th>{systemAdmin && <th className="px-4 py-3 text-right">Provider</th>}<th className="px-4 py-3 text-right">Billable</th>{systemAdmin && <th className="px-4 py-3 text-right">Margin</th>}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, index) => <tr key={`${identity(row)}-${index}`}><td className="px-4 py-3 font-medium text-gray-800">{identity(row)}</td><td className="px-4 py-3 text-right">{number(row.requests)}</td><td className="px-4 py-3 text-right">{number(row.input_tokens)}</td><td className="px-4 py-3 text-right">{number(row.output_tokens)}</td><td className="px-4 py-3 text-right">{number(row.total_tokens)}</td>{systemAdmin && <td className="px-4 py-3 text-right">{usd(row.provider_cost_micros)}</td>}<td className="px-4 py-3 text-right">{usd(row.billable_cost_micros)}</td>{systemAdmin && <td className="px-4 py-3 text-right">{usd(row.estimated_margin_micros)}</td>}</tr>)}
            {rows.length === 0 && <tr><td colSpan={systemAdmin ? 8 : 6} className="px-4 py-8 text-center text-gray-500">本期尚無 AI 用量。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AIUsagePanel({ request, systemAdmin = false }) {
  const [state, setState] = useState({ status: 'loading', summary: null, error: '' });
  const load = useCallback(async () => {
    setState(previous => ({ ...previous, status: 'loading', error: '' }));
    try {
      const response = await request(systemAdmin ? '/api/system/ai-usage/summary' : '/api/ai-usage/summary');
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'AI 用量讀取失敗。');
      setState({ status: 'success', summary: payload.summary, error: '' });
    } catch (error) {
      setState({ status: 'error', summary: null, error: error.message || 'AI 用量讀取失敗。' });
    }
  }, [request, systemAdmin]);

  useEffect(() => { load(); }, [load]);
  const summary = state.summary;
  const total = summary?.total || {};
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-bold tracking-tight text-gray-900">AI 用量</h2><p className="mt-1 text-sm text-gray-500">{systemAdmin ? '跨 Workspace AI 成本、計費與預估毛利。' : 'Workspace 本月 AI 使用量與計費預估；目前不包含扣款、Invoice 或訂閱收費。'}</p></div><button type="button" onClick={load} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-bold">重新整理</button></div>
      {state.status === 'loading' && <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500"><Loader2 size={17} className="animate-spin" />載入 AI 用量…</div>}
      {state.status === 'error' && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{state.error}</div>}
      {state.status === 'success' && <>
        <div className="text-xs text-gray-500">期間：{new Date(summary.period.from).toLocaleDateString('zh-TW')} ～ {new Date(summary.period.to).toLocaleDateString('zh-TW')} · 範圍：{summary.scope === 'self' ? '僅本人' : summary.scope === 'system' ? '全平台' : '目前 Workspace'}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6"><Metric label="Requests" value={number(total.requests)} /><Metric label="Input Tokens" value={number(total.inputTokens)} /><Metric label="Output Tokens" value={number(total.outputTokens)} /><Metric label="Total Tokens" value={number(total.totalTokens)} /><Metric label="Provider Cost" value={usd(total.providerCostMicros)} hint={systemAdmin ? '平台 AI 成本' : '成本參考'} /><Metric label="Billable Estimate" value={usd(total.billableCostMicros)} hint={systemAdmin ? `Margin ${usd(total.estimatedMarginMicros)}` : 'Workspace 計費預估'} /></div>
        {systemAdmin && <BreakdownTable title="Workspace" rows={summary.byWorkspace || []} identity={row => row.workspaceName || row.workspaceId} systemAdmin />}
        <BreakdownTable title="Feature breakdown" rows={summary.byFeature || []} identity={row => FEATURE_LABELS[row.featureCode] || row.featureCode} systemAdmin={systemAdmin} />
        <BreakdownTable title="User breakdown" rows={summary.byUser || []} identity={row => `${row.userName || row.userId || '未知使用者'}${systemAdmin && row.workspaceId ? ` · ${row.workspaceId}` : ''}`} systemAdmin={systemAdmin} />
        <BreakdownTable title="Provider / Model" rows={summary.byModel || []} identity={row => `${row.provider} / ${row.model}`} systemAdmin={systemAdmin} />
      </>}
    </div>
  );
}
