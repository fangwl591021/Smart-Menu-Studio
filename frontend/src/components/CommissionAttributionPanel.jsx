import React, { useCallback, useEffect, useState } from 'react';
import CommissionLedgerPanel from './CommissionLedgerPanel';
import TenantSettlementPayoutPanel from './TenantSettlementPayoutPanel';
import { commissionSourceKey, commissionSourceLabel } from '../commission-source-presentation';

const number = value => Number(value || 0).toLocaleString('zh-TW');

export default function CommissionAttributionPanel({ request, userRole }) {
  const [period, setPeriod] = useState('30d');
  const [programId, setProgramId] = useState('');
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  const load = useCallback(async () => {
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const accountResponse = await request('/api/line/account');
      const accountBody = await accountResponse.json();
      if (!accountResponse.ok || !accountBody?.success || !accountBody.account?.id) throw new Error('經銷歸因目前無法載入。');
      const query = new URLSearchParams({ lineAccountId: accountBody.account.id, period });
      if (programId) query.set('programId', programId);
      const response = await request(`/api/commission-attributions?${query.toString()}`);
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error('經銷歸因目前無法載入。');
      setState({ loading: false, data: body, error: '' });
    } catch {
      setState({ loading: false, data: null, error: '經銷歸因目前無法載入。' });
    }
  }, [period, programId, request]);

  useEffect(() => { load(); }, [load]);
  const data = state.data;
  const programs = data?.programs || [];
  const isEmpty = data && Number(data.summary?.attributedConversions || 0) === 0;

  return <>
    <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="經銷歸因">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-bold text-gray-900">經銷歸因</h2><p className="mt-1 text-xs text-gray-500">顯示已依確定性規則歸屬至經銷商的轉換紀錄，不代表佣金金額。</p></div>
        <div className="flex gap-2">{['7d', '30d'].map(value => <button type="button" key={value} onClick={() => setPeriod(value)} className={period === value ? 'rounded bg-slate-900 px-3 py-1 text-sm text-white' : 'rounded border border-gray-300 px-3 py-1 text-sm'}>{value}</button>)}<button type="button" onClick={load} className="rounded border border-gray-300 px-3 py-1 text-sm">重新整理</button></div>
      </div>
      {state.loading && <p className="py-5 text-sm text-gray-500">載入經銷歸因中…</p>}
      {state.error && <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      {!state.loading && data && <>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-gray-200 p-4"><div className="text-xs text-gray-500">已歸因轉換數</div><div className="mt-1 text-2xl font-bold">{number(data.summary?.attributedConversions)}</div><div className="mt-1 text-xs text-gray-500">最近 {period === '7d' ? '7' : '30'} 天</div></div><label className="rounded-lg border border-gray-200 p-4 text-sm"><span className="text-xs text-gray-500">方案篩選</span><select value={programId} onChange={event => setProgramId(event.target.value)} className="mt-1 block w-full rounded border border-gray-300 p-2"><option value="">全部方案</option>{programs.map(program => <option key={program.programId} value={program.programId}>{program.programName}</option>)}</select></label></div>
        {isEmpty ? <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">目前尚無已歸因轉換。新的轉換只有在具備可信推薦證據，且符合有效經銷商與方案資格時才會建立歸因。</div> : <>
          <section className="mt-5" aria-label="歸因趨勢"><h3 className="font-bold text-gray-900">歸因趨勢</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(data.trend || []).map(item => <div key={item.day} className="rounded border border-gray-100 p-3 text-sm"><div className="text-xs text-gray-500">{item.day}</div><b>{number(item.attributedConversions)}</b></div>)}</div></section>
          <section className="mt-5" aria-label="方案歸因"><h3 className="font-bold text-gray-900">方案歸因</h3><div className="mt-2 space-y-2">{programs.map(program => <div key={program.programId} className="flex justify-between rounded border border-gray-100 p-3 text-sm"><span>{program.programName}</span><b>{number(program.attributedConversions)}</b></div>)}</div></section>
          <section className="mt-5" aria-label="經銷商歸因"><h3 className="font-bold text-gray-900">經銷商歸因</h3><div className="mt-2 space-y-2">{(data.dealers || []).map(dealer => <div key={dealer.publicSafeLabel} className="flex justify-between rounded border border-gray-100 p-3 text-sm"><span>{dealer.publicSafeLabel}</span><b>{number(dealer.attributedConversions)}</b></div>)}</div></section>
          <section className="mt-5" aria-label="歸因來源"><h3 className="font-bold text-gray-900">歸因來源</h3><div className="mt-2 space-y-2">{(data.sources || []).map(source => <div key={commissionSourceKey(source)} className="flex justify-between rounded border border-gray-100 p-3 text-sm"><span>{commissionSourceLabel(source)}</span><b>{number(source.attributedConversions)}</b></div>)}</div></section>
        </>}
      </>}
    </section>
    <CommissionLedgerPanel request={request} />
    <TenantSettlementPayoutPanel request={request} userRole={userRole} />
  </>;
}
