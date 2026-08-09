import React, { useCallback, useEffect, useState } from 'react';

const formatMoney = (amountMinor, currencyCode) => {
  const amount = Number(amountMinor || 0);
  if (String(currencyCode).toUpperCase() === 'TWD') return `NT$ ${amount.toLocaleString('zh-TW')}`;
  return `${currencyCode || '—'} ${amount.toLocaleString('zh-TW')}`;
};
const formatDate = value => value ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const statusLabel = value => ({ REQUESTED: '已提出申請', APPROVED: '已核准', REJECTED: '未核准', CANCELLED: '已取消' }[value] || value || '—');
const paymentLabel = value => ({ PENDING: '等待處理', PROCESSING: '處理中', SUCCEEDED: '模擬處理成功', FAILED: '模擬處理未完成', CANCELLED: '已取消' }[value] || '尚無付款處理');
const rejectionLabel = value => ({ INVALID_REQUEST: '申請資料不符合規則', SETTLEMENT_MISMATCH: '結算資料不一致', DEALER_NOT_ELIGIBLE: '目前資格不符合', DUPLICATE_REQUEST: '已有進行中的申請', OTHER_POLICY: '不符合目前政策' }[value] || '—');

export default function DealerSettlementPayoutPanel({ request, auth }) {
  const [period, setPeriod] = useState('30d');
  const [settlements, setSettlements] = useState({ loading: true, error: '', data: null });
  const [payouts, setPayouts] = useState({ loading: true, error: '', data: null });
  const [payments, setPayments] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const accessToken = String(auth?.accessToken || '');

  const loadSettlements = useCallback(async selectedPeriod => {
    if (!accessToken) return;
    setSettlements(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const response = await request(`/api/member/dealer/settlements?period=${encodeURIComponent(selectedPeriod)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error('READ_FAILED');
      setSettlements({ loading: false, error: '', data: body });
    } catch { setSettlements({ loading: false, error: '目前無法讀取結算紀錄。', data: null }); }
  }, [accessToken, request]);
  const loadPayouts = useCallback(async () => {
    if (!accessToken) return;
    setPayouts(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const response = await request('/api/member/dealer/payout-requests', { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error('READ_FAILED');
      setPayouts({ loading: false, error: '', data: body });
    } catch { setPayouts({ loading: false, error: '目前無法讀取佣金申請紀錄。', data: null }); }
  }, [accessToken, request]);
  const loadPayments = useCallback(async () => {
    if (!accessToken) return;
    setPayments(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const response = await request('/api/member/dealer/payment-status', { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error('READ_FAILED');
      setPayments({ loading: false, error: '', data: body });
    } catch { setPayments({ loading: false, error: '目前無法讀取模擬付款狀態。', data: null }); }
  }, [accessToken, request]);
  const refresh = useCallback(async selectedPeriod => { await Promise.all([loadSettlements(selectedPeriod), loadPayouts(), loadPayments()]); }, [loadPayments, loadPayouts, loadSettlements]);

  useEffect(() => { refresh(period); }, [period, refresh]);
  const selectPeriod = value => { setPeriod(value); };
  const createRequest = async settlementHandle => {
    if (!accessToken || !settlementHandle) return;
    setBusy('create'); setActionError('');
    try {
      const response = await request('/api/member/dealer/payout-requests', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ settlementHandle }) });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error(body?.error || 'CREATE_FAILED');
      await refresh(period);
    } catch (error) { setActionError(error?.message === 'DEALER_NOT_ACTIVE' ? '目前經銷資格無法提出新的佣金申請。' : '佣金申請暫時無法建立。'); } finally { setBusy(''); }
  };
  const cancelRequest = async payoutRequestHandle => {
    if (!accessToken || !payoutRequestHandle) return;
    setBusy('cancel'); setActionError('');
    try {
      const response = await request('/api/member/dealer/payout-requests/cancel', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ payoutRequestHandle }) });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error(body?.error || 'CANCEL_FAILED');
      await refresh(period);
    } catch { setActionError('此佣金申請目前無法取消。'); } finally { setBusy(''); }
  };

  const settlementRows = Array.isArray(settlements.data?.settlements) ? settlements.data.settlements : [];
  const earned = Array.isArray(settlements.data?.summary?.earnedByCurrency) ? settlements.data.summary.earnedByCurrency : [];
  const payoutRows = Array.isArray(payouts.data?.requests) ? payouts.data.requests : [];
  const paymentRows = Array.isArray(payments.data?.payments) ? payments.data.payments : [];
  const notEnrolled = [settlements, payouts, payments].some(state => state.data?.status === 'NOT_ENROLLED');

  return <section className="mt-5 rounded-xl border border-slate-200 p-4" aria-label="我的結算與佣金申請">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">我的結算與佣金申請</h2><p className="mt-1 text-xs text-slate-500">結算、申請與付款狀態均由系統提供；不同幣別不合併，金額不可編輯。</p></div><div className="flex gap-2">{['7d', '30d'].map(value => <button type="button" key={value} onClick={() => selectPeriod(value)} className={period === value ? 'rounded bg-slate-900 px-3 py-1 text-xs font-bold text-white' : 'rounded border border-slate-300 px-3 py-1 text-xs font-bold'}>{value}</button>)}<button type="button" onClick={() => refresh(period)} className="rounded border border-slate-300 px-3 py-1 text-xs font-bold">重新整理</button></div></div>
    {notEnrolled && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">目前尚未完成經銷資格設定。</p>}
    {actionError && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{actionError}</p>}
    <section className="mt-5" aria-label="結算紀錄"><h3 className="font-bold">結算紀錄</h3>{settlements.loading && <p className="mt-2 text-sm text-slate-500">正在讀取結算紀錄…</p>}{settlements.error && <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-700">{settlements.error}</p>}{!settlements.loading && !settlements.error && !notEnrolled && <><div className="mt-2 grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">結算筆數</div><b>{Number(settlements.data?.summary?.settlementCount || 0).toLocaleString('zh-TW')}</b></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">結算項目</div><b>{Number(settlements.data?.summary?.itemCount || 0).toLocaleString('zh-TW')}</b></div>{earned.map(item => <div key={item.currencyCode} className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{item.currencyCode}</div><b>{formatMoney(item.amountMinor, item.currencyCode)}</b></div>)}</div>{settlementRows.length === 0 ? <p className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-600">目前尚無已完成結算紀錄。</p> : <div className="mt-3 space-y-2">{settlementRows.map((row, index) => <article key={`${row.periodStart}-${row.periodEnd}-${index}`} className="rounded border border-slate-100 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{row.periodStart} — {row.periodEnd}</b><div className="mt-1 text-xs text-slate-500">完成於 {formatDate(row.finalizedAt)} · {Number(row.entryCount || 0).toLocaleString('zh-TW')} 項</div></div><div className="text-right"><b>{formatMoney(row.amountMinor, row.currencyCode)}</b><button type="button" disabled={busy !== ''} onClick={() => createRequest(row.settlementHandle)} className="mt-2 block rounded bg-slate-900 px-3 py-1 text-xs font-bold text-white disabled:opacity-50">提出佣金申請</button></div></div></article>)}</div>}</>}</section>
    <section className="mt-6" aria-label="佣金申請紀錄"><h3 className="font-bold">佣金申請紀錄</h3>{payouts.loading && <p className="mt-2 text-sm text-slate-500">正在讀取佣金申請紀錄…</p>}{payouts.error && <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-700">{payouts.error}</p>}{!payouts.loading && !payouts.error && !notEnrolled && (payoutRows.length === 0 ? <p className="mt-2 rounded bg-slate-50 p-3 text-sm text-slate-600">目前尚無佣金申請紀錄。</p> : <div className="mt-2 space-y-2">{payoutRows.map((row, index) => <article key={`${row.requestedAt}-${row.status}-${index}`} className="rounded border border-slate-100 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{statusLabel(row.status)}</b><div className="mt-1 text-xs text-slate-500">申請於 {formatDate(row.requestedAt)}{row.reviewedAt ? ` · 審核於 ${formatDate(row.reviewedAt)}` : ''}</div>{row.status === 'REJECTED' && <div className="mt-1 text-xs text-amber-800">原因：{rejectionLabel(row.rejectionReasonCode)}</div>}</div><div className="text-right"><b>{formatMoney(row.amountMinor, row.currencyCode)}</b>{row.status === 'REQUESTED' && <button type="button" disabled={busy !== ''} onClick={() => cancelRequest(row.payoutRequestHandle)} className="mt-2 block rounded border border-slate-300 px-3 py-1 text-xs font-bold disabled:opacity-50">取消申請</button>}</div></div></article>)}</div>)}</section>
    <section className="mt-6" aria-label="付款狀態"><h3 className="font-bold">付款狀態</h3><p className="mt-1 text-xs text-slate-500">僅顯示模擬處理資訊；不會執行真實付款、轉帳或匯款。</p>{payments.loading && <p className="mt-2 text-sm text-slate-500">正在讀取付款狀態…</p>}{payments.error && <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-700">{payments.error}</p>}{!payments.loading && !payments.error && !notEnrolled && (paymentRows.length === 0 ? <p className="mt-2 rounded bg-slate-50 p-3 text-sm text-slate-600">目前尚無付款處理紀錄。</p> : <div className="mt-2 space-y-2">{paymentRows.map((row, index) => <article key={`${row.payoutRequestStatus}-${row.paymentStatus}-${index}`} className="rounded border border-slate-100 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{paymentLabel(row.paymentStatus)}</b><div className="mt-1 text-xs text-slate-500">申請狀態：{statusLabel(row.payoutRequestStatus)}</div><div className="mt-1 text-xs text-slate-500">模式：{row.executionMode || '—'}{row.executionMode === 'SIMULATED' ? ' · INTERNAL_TEST' : ''}</div>{row.paymentStatus === 'SUCCEEDED' && <p className="mt-2 text-xs text-slate-600">此為模擬付款結果，不代表真實付款完成。</p>}{row.paymentStatus === 'FAILED' && <p className="mt-2 text-xs text-amber-800">模擬付款未完成，請由管理員依系統流程處理。</p>}</div><b>{formatMoney(row.amountMinor, row.currencyCode)}</b></div></article>)}</div>)}</section>
  </section>;
}
