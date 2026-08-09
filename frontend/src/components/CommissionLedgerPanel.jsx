import React, { useCallback, useEffect, useState } from 'react';

const count = value => Number(value || 0).toLocaleString('zh-TW');
const MINOR_UNIT_DIGITS = { TWD: 0 };

export const formatCommissionMoney = (amountMinor, currencyCode) => {
  const code = String(currencyCode || '').toUpperCase();
  const digits = MINOR_UNIT_DIGITS[code];
  if (digits == null) return `${code || '—'} ${count(amountMinor)}`;
  const major = Number(amountMinor || 0) / (10 ** digits);
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major);
};

export default function CommissionLedgerPanel({ request }) {
  const [period, setPeriod] = useState('30d');
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  const load = useCallback(async () => {
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const accountResponse = await request('/api/line/account');
      const accountBody = await accountResponse.json();
      if (!accountResponse.ok || !accountBody?.success || !accountBody.account?.id) throw new Error('佣金紀錄目前無法載入。');
      const query = new URLSearchParams({ lineAccountId: accountBody.account.id, period });
      const response = await request(`/api/commission-ledger?${query.toString()}`);
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error('佣金紀錄目前無法載入。');
      setState({ loading: false, data: body, error: '' });
    } catch {
      setState({ loading: false, data: null, error: '佣金紀錄目前無法載入。' });
    }
  }, [period, request]);

  useEffect(() => { load(); }, [load]);
  const data = state.data;
  const earned = Array.isArray(data?.earnedByCurrency) ? data.earnedByCurrency : [];
  const empty = data && earned.length === 0;

  return <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="已賺佣金">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-gray-900">已賺佣金</h2><p className="mt-1 text-xs text-gray-500">依幣別顯示已建立的佣金帳本紀錄；不同幣別不合併計算。</p></div>
      <div className="flex gap-2">{['7d', '30d'].map(value => <button type="button" key={value} onClick={() => setPeriod(value)} className={period === value ? 'rounded bg-slate-900 px-3 py-1 text-sm text-white' : 'rounded border border-gray-300 px-3 py-1 text-sm'}>{value}</button>)}<button type="button" onClick={load} className="rounded border border-gray-300 px-3 py-1 text-sm">重新整理</button></div>
    </div>
    {state.loading && <p className="py-5 text-sm text-gray-500">載入佣金紀錄中…</p>}
    {state.error && <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
    {!state.loading && empty && <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">目前尚無已賺佣金紀錄。</div>}
    {!state.loading && data && !empty && <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{earned.map(item => <div key={item.currencyCode} className="rounded-lg border border-gray-200 p-4"><div className="text-xs text-gray-500">{item.currencyCode}</div><div className="mt-1 text-2xl font-bold">{formatCommissionMoney(item.amountMinor, item.currencyCode)}</div><div className="mt-1 text-xs text-gray-500">{count(item.attributionCount)} 筆歸因</div></div>)}</div>
      <section className="mt-5" aria-label="佣金趨勢"><h3 className="font-bold text-gray-900">佣金趨勢</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(data.trend || []).map((item, index) => <div key={`${item.date}-${item.currencyCode}-${index}`} className="rounded border border-gray-100 p-3 text-sm"><div className="text-xs text-gray-500">{item.date} · {item.currencyCode}</div><b>{formatCommissionMoney(item.amountMinor, item.currencyCode)}</b><div className="mt-1 text-xs text-gray-500">{count(item.attributionCount)} 筆</div></div>)}</div></section>
      <section className="mt-5" aria-label="方案佣金"><h3 className="font-bold text-gray-900">方案佣金</h3><div className="mt-2 space-y-2">{(data.programBreakdown || []).map((item, index) => <div key={`${item.programName}-${item.currencyCode}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-100 p-3 text-sm"><span>{item.programName}</span><span><b>{formatCommissionMoney(item.earnedAmountMinor, item.currencyCode)}</b> · {count(item.attributionCount)} 筆</span></div>)}</div></section>
      <section className="mt-5" aria-label="經銷商佣金"><h3 className="font-bold text-gray-900">經銷商佣金</h3><div className="mt-2 space-y-2">{(data.dealerBreakdown || []).map((item, index) => <div key={`${item.publicSafeLabel}-${item.currencyCode}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-100 p-3 text-sm"><span>{item.publicSafeLabel}</span><span><b>{formatCommissionMoney(item.earnedAmountMinor, item.currencyCode)}</b> · {count(item.attributionCount)} 筆</span></div>)}</div></section>
    </>}
  </section>;
}
