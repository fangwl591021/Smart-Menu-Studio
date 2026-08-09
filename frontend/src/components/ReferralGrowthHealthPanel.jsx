import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const readiness = {
  READY: '推薦成長資料可用。',
  NO_REFERRAL_DATA: '尚未觀察到推薦成長資料。',
  LIFF_NOT_READY: '請完成推薦功能所需的 LIFF 設定。',
  INSUFFICIENT_REFERRAL_ACTIVITY: '推薦活動資料尚不足以判讀。',
  STALE_DATA: '推薦成長活動已過期，請確認 LIFF referral flow。',
};
const rate = value => value == null ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
const time = value => value ? new Date(value).toLocaleString('zh-TW') : '—';

export default function ReferralGrowthHealthPanel({ request }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = useCallback(async () => {
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const response = await request('/api/system/referral-growth-health');
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error('REFERRAL_GROWTH_HEALTH_UNAVAILABLE');
      setState({ loading: false, data, error: '' });
    } catch {
      setState({ loading: false, data: null, error: '無法讀取推薦成長健康狀態。' });
    }
  }, [request]);
  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const funnel = data?.funnelHealthSummary || {};
  return <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="Referral Growth Health">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-gray-900">Referral Growth Health</h2><p className="mt-1 text-sm text-gray-500">Platform aggregate health only. No member identity, referral credentials, or raw event data is shown.</p></div><button type="button" onClick={load} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-bold">Refresh</button></div>
    {state.loading && <div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500"><Loader2 size={17} className="animate-spin" />Loading referral growth health…</div>}
    {state.error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{state.error}</div>}
    {!state.loading && !state.error && !data && <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">Referral growth health is unavailable.</div>}
    {!state.loading && !state.error && data && <><div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="flex items-center gap-2"><b>Referral Growth Ready</b><span className={data.referralGrowthReady ? 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700' : 'rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800'}>{data.referralGrowthReady ? 'YES' : 'NO'}</span></div><p className="mt-2 text-sm text-slate-600">{readiness[data.referralGrowthReason] || 'Referral growth health is unavailable.'}</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['LIFF Ready Tenant Count', data.liffReadyTenantCount], ['Referral Active Tenant Count', data.referralActiveTenantCount], ['Qualified Referral Count', data.qualifiedReferralCount], ['Stale Growth Tenant Count', data.staleGrowthTenantCount]].map(([label, value]) => <div key={label} className="rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-xl font-bold">{Number(value || 0).toLocaleString('zh-TW')}</div></div>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-gray-200 p-4"><h3 className="font-bold">Funnel Health Summary</h3><div className="mt-2 text-sm text-gray-600">Landings：{Number(funnel.landings || 0).toLocaleString('zh-TW')}</div><div className="text-sm text-gray-600">Qualified：{Number(funnel.qualified || 0).toLocaleString('zh-TW')}</div><div className="text-sm text-gray-600">Qualification Rate：{rate(funnel.overallQualificationRate)}</div></div><div className="rounded-lg border border-gray-200 p-4"><h3 className="font-bold">Last Referral Growth Activity</h3><p className="mt-2 text-sm text-gray-600">{time(data.lastReferralGrowthActivityAt)}</p></div></div></>}
  </section>;
}
