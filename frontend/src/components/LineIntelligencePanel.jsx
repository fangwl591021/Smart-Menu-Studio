import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import JourneyIntelligencePanel from './JourneyIntelligencePanel';

const number = value => value === null || value === undefined ? 'Not available' : Number(value).toLocaleString('zh-TW');
const percent = value => value === null || value === undefined ? 'Not available' : `${(Number(value) * 100).toFixed(1)}%`;

export default function LineIntelligencePanel({ projectId, request, userRole }) {
  const [period, setPeriod] = useState(30);
  const [state, setState] = useState({ loading: true, data: null, daily: [], error: '' });
  const [richMenuId, setRichMenuId] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const from = new Date(Date.now() - (period - 1) * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const [summaryResponse, dailyResponse] = await Promise.all([
        request(`/api/projects/${encodeURIComponent(projectId)}/intelligence/summary?from=${from}&to=${to}`),
        request(`/api/projects/${encodeURIComponent(projectId)}/intelligence/daily?from=${from}&to=${to}`),
      ]);
      const summary = await summaryResponse.json(); const daily = await dailyResponse.json();
      if (!summaryResponse.ok || !summary.success) throw new Error(summary.error || 'Unable to load LINE intelligence.');
      if (!dailyResponse.ok || !daily.success) throw new Error(daily.error || 'Unable to load LINE intelligence trend.');
      setState({ loading: false, data: summary, daily: daily.days || [], error: '' });
    } catch (error) { setState({ loading: false, data: null, daily: [], error: error.message || 'Unable to load LINE intelligence.' }); }
  }, [period, projectId, request]);
  useEffect(() => { load(); }, [load]);
  const admin = ['admin', 'owner'].includes(String(userRole || '').toLowerCase());
  const submit = async kind => {
    setBusy(kind);
    try {
      const options = kind === 'bind' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineRichMenuId: richMenuId }) } : { method: 'POST' };
      const response = await request(`/api/projects/${encodeURIComponent(projectId)}/intelligence/${kind === 'bind' ? 'bindings' : 'sync'}`, options); const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to complete LINE intelligence request.');
      await load();
    } catch (error) { setState(previous => ({ ...previous, error: error.message || 'Unable to complete LINE intelligence request.' })); } finally { setBusy(''); }
  };
  const data = state.data; const metrics = data?.project || {}; const privacy = data?.privacySuppressed || data?.areas?.some(area => area.dataStatus === 'privacy_suppressed');
  return <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-gray-900">LINE OA Intelligence</h3><p className="mt-1 text-xs text-gray-500">Cached LINE Rich Menu aggregates and gateway-observed action counts. No LINE token or raw event content is shown here.</p></div><div className="flex gap-2">{[7, 30].map(days => <button type="button" key={days} onClick={() => setPeriod(days)} className={`rounded-md px-3 py-1.5 text-xs font-bold ${period === days ? 'bg-blue-600 text-white' : 'border border-gray-300'}`}>{days} days</button>)}<button type="button" onClick={load} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-bold">Refresh</button></div></div>
    {state.loading && <div className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" />Loading cached LINE intelligence...</div>}
    {state.error && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</div>}
    {!state.loading && data && <><div data-guide-target="intelligence-summary" className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">{[['Impressions', metrics.impressions], ['Clicks', metrics.clicks], ['Unique clickers', metrics.uniqueClickers], ['CTR', percent(metrics.ctr)], ['Metrics through', data.dataFreshness?.metricsThrough || 'Not synced']].map(([label, value]) => <div key={label} className="rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-lg font-bold">{label === 'CTR' || label === 'Metrics through' ? value : number(value)}</div></div>)}</div>
      {privacy && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">LINE suppressed this period under its privacy threshold. Suppressed metrics are deliberately not displayed as zero.</div>}
      <div className="mt-5"><div className="font-bold text-sm">Area ranking</div><div className="mt-2 space-y-2">{data.areas?.map((area, index) => <div key={area.projectAreaId} data-guide-target={`intelligence-area-${area.projectAreaId}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm"><span>{index + 1}. {area.label} <span className="text-xs text-gray-500">{area.actionType}</span></span><span className="font-bold">{area.dataStatus === 'privacy_suppressed' ? 'Suppressed' : `${number(area.clicks)} clicks`}</span></div>)}</div></div>
      <div data-guide-target="intelligence-trend" className="mt-5"><div className="font-bold text-sm">Daily trend</div><div className="mt-2 max-h-44 overflow-auto rounded-lg border border-gray-100 text-xs">{state.daily.map(item => <div key={item.date} className="grid grid-cols-3 border-b border-gray-100 px-3 py-2 last:border-0"><span>{item.date}</span><span>{item.dataStatus === 'privacy_suppressed' ? 'Suppressed' : `${number(item.impressions)} impressions`}</span><span>{item.dataStatus === 'privacy_suppressed' ? 'Suppressed' : `${number(item.clicks)} clicks`}</span></div>)}</div></div>
      <div className="mt-4 text-xs text-gray-500">Last cache sync: {data.dataFreshness?.lastLineSyncAt || 'Not synced'} | Rich Menu: {data.binding?.lineRichMenuId || 'Not linked'}</div>
      {admin && <div className="mt-4 flex flex-wrap gap-2 border-t pt-4"><input value={richMenuId} onChange={event => setRichMenuId(event.target.value)} placeholder="LINE Rich Menu ID" className="min-w-[260px] rounded-md border border-gray-300 px-3 py-2 text-sm" /><button type="button" disabled={!richMenuId || Boolean(busy)} onClick={() => submit('bind')} className="rounded-md border border-blue-300 px-3 py-2 text-sm font-bold text-blue-700">Link menu</button><button type="button" disabled={!data.binding || Boolean(busy)} onClick={() => submit('sync')} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white">{busy === 'sync' ? 'Syncing...' : 'Sync LINE insight'}</button></div>}
    </>}
  <JourneyIntelligencePanel projectId={projectId} request={request} /></section>;
}
