import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { dateOnly, dateTime, travelEventLabel, travelStatusLabel, travelerTypeLabel } from '../travel-presentation';
import { canManageTravelOperations, travelOperationErrorMessage, travelOperationPaymentLabel, travelReadinessLabel, travelReadinessWarningLabel } from '../travel-operations-presentation';

async function readJson(response) { const body = await response.json().catch(() => ({})); if (!response.ok || !body?.success) throw new Error(body?.error || 'REQUEST_FAILED'); return body; }
const pageSize = 25;

export default function DepartureOperationsPanel({ request, userRole, safeDepartureReference, onClose }) {
  const canManage = canManageTravelOperations(userRole);
  const [state, setState] = useState({ loading: true, operations: null, bookings: [], travelers: [], events: [], page: 1, busy: '', success: '', error: '' });
  const load = useCallback(async (page = 1, success = '') => {
    setState(value => ({ ...value, loading: true, page, success, error: '' }));
    try {
      const ref = encodeURIComponent(safeDepartureReference);
      const [operations, bookings, travelers, events] = await Promise.all([
        readJson(await request(`/api/travel/departures/${ref}/operations`)),
        readJson(await request(`/api/travel/departures/${ref}/bookings?limit=${pageSize}&page=${page}`)),
        readJson(await request(`/api/travel/departures/${ref}/travelers?limit=${pageSize}&page=${page}`)),
        readJson(await request(`/api/travel/departures/${ref}/events?limit=100`)),
      ]);
      setState(value => ({ ...value, loading: false, operations: operations.operations, bookings: bookings.bookings || [], travelers: travelers.travelers || [], events: events.events || [], page, busy: '', success, error: '' }));
    } catch (error) { setState(value => ({ ...value, loading: false, busy: '', error: travelOperationErrorMessage(error?.message) })); }
  }, [request, safeDepartureReference]);
  useEffect(() => { load(); }, [load]);

  const mutate = async action => {
    const confirm = action === 'confirm';
    const accepted = window.confirm(confirm
      ? '確定要確認此出發日進入營運履約狀態嗎？\n此操作不代表付款完成，也不會變更訂單付款狀態。'
      : '確定要將此出發日標記為服務已完成嗎？\n此操作不會變更付款、退款、佣金或結算狀態。');
    if (!accepted) return;
    setState(value => ({ ...value, busy: action, success: '', error: '' }));
    try {
      const ref = encodeURIComponent(safeDepartureReference);
      await readJson(await request(`/api/travel/departures/${ref}/operations/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
      await load(state.page, confirm ? '營運狀態已確認' : '服務已標記完成');
    } catch (error) { setState(value => ({ ...value, busy: '', error: travelOperationErrorMessage(error?.message, action) })); }
  };

  if (state.loading && !state.operations) return <section aria-label="營運總覽" className="rounded-xl border bg-white p-6"><p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={17} />正在載入營運資訊…</p></section>;
  const data = state.operations;
  return <section aria-label="營運總覽" className="space-y-5 rounded-xl border bg-slate-50 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold">營運總覽</h3><p className="text-sm text-slate-500">所有名額、付款與履約狀態皆以後端結果為準。</p></div><div className="flex gap-2"><button type="button" onClick={() => load(state.page)} className="rounded-lg border bg-white p-2" aria-label="重新載入營運資訊"><RefreshCw size={17} /></button><button type="button" onClick={onClose} className="rounded-lg border bg-white px-3 py-2 text-sm">關閉</button></div></div>
    {state.success && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{state.success}</p>}{state.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state.error}</p>}
    {data && <>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{[['行程',data.itineraryTitle],['出發日期',`${dateOnly(data.departureStart)} ～ ${dateOnly(data.departureEnd)}`],['報名期間',`${dateTime(data.bookingOpenAt)} ～ ${dateTime(data.bookingClosesAt)}`],['狀態',travelStatusLabel(data.departureStatus)],['座位上限',data.seatLimit],['最低成團人數',data.minGroupSize]].map(([label,value]) => <p key={label} className="rounded-lg bg-white p-3 text-sm"><span className="text-slate-500">{label}</span><br /><b>{value}</b></p>)}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><p className="rounded-lg bg-white p-3 text-sm">已預訂人數<br /><b>{data.reservedSeats}</b></p><p className="rounded-lg bg-white p-3 text-sm">剩餘名額<br /><b>{data.remainingSeats}</b></p><p className="rounded-lg bg-white p-3 text-sm">報名訂單數<br /><b>{data.bookingCount}</b></p><p className="rounded-lg bg-white p-3 text-sm">旅客人數<br /><b>{data.travelerCount}</b></p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><p className="rounded-lg bg-white p-3 text-sm">未付款<br /><b>{data.unpaidBookings}</b></p><p className="rounded-lg bg-white p-3 text-sm">訂金完成<br /><b>{data.depositCompletedBookings}</b></p><p className="rounded-lg bg-white p-3 text-sm">款項已付清<br /><b>{data.fullyPaidBookings}</b></p><p className="rounded-lg bg-white p-3 text-sm">已取消<br /><b>{data.cancelledBookings}</b></p></div>
      <section className="rounded-lg bg-white p-4" aria-label="營運準備狀態"><h4 className="font-bold">{travelReadinessLabel(data.readiness?.state)}</h4><ul className="mt-2 list-disc pl-5 text-sm text-slate-600">{(data.readiness?.warnings || []).map((warning, index) => <li key={`${warning}-${index}`}>{travelReadinessWarningLabel(warning)}</li>)}</ul></section>
      <section className="rounded-lg bg-white p-4" aria-label="履約里程碑"><div className="grid gap-3 sm:grid-cols-2"><p>營運確認：<b>{data.operationalState?.confirmed ? '已確認' : '尚未確認'}</b>{data.operationalState?.confirmedAt && <small className="block text-slate-500">{dateTime(data.operationalState.confirmedAt)}</small>}</p><p>服務完成：<b>{data.operationalState?.completed ? '已完成' : '尚未完成'}</b>{data.operationalState?.completedAt && <small className="block text-slate-500">{dateTime(data.operationalState.completedAt)}</small>}</p></div>{canManage && <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={Boolean(state.busy)} onClick={() => mutate('confirm')} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">確認出團營運</button><button type="button" disabled={Boolean(state.busy)} onClick={() => mutate('complete')} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">標記服務完成</button></div>}</section>
    </>}
    <section aria-label="報名訂單名冊"><h4 className="font-bold">報名訂單</h4>{state.bookings.length === 0 ? <p className="mt-2 text-sm text-slate-500">目前沒有報名訂單。</p> : <div className="mt-2 overflow-x-auto rounded-lg border bg-white"><table className="min-w-full text-left text-sm"><thead><tr><th className="p-3">報名編號</th><th className="p-3">顧客</th><th className="p-3">付款狀態</th><th className="p-3">旅客人數</th><th className="p-3">銷售來源</th><th className="p-3">建立時間</th></tr></thead><tbody>{state.bookings.map(item => <tr key={item.safeBookingReference} className="border-t"><td className="p-3">{item.safeBookingReference}</td><td className="p-3">{item.safeCustomerLabel}</td><td className="p-3">{travelOperationPaymentLabel(item.paymentStatus)}</td><td className="p-3">{item.travelerCount}</td><td className="p-3">{item.safeSellerLabel || '無'}</td><td className="p-3">{dateTime(item.createdAt)}</td></tr>)}</tbody></table></div>}</section>
    <section aria-label="旅客名冊"><h4 className="font-bold">旅客資料</h4>{state.travelers.length === 0 ? <p className="mt-2 text-sm text-slate-500">目前沒有旅客資料。</p> : <div className="mt-2 overflow-x-auto rounded-lg border bg-white"><table className="min-w-full text-left text-sm"><thead><tr><th className="p-3">報名編號</th><th className="p-3">旅客</th><th className="p-3">類型</th><th className="p-3">聯絡電話</th></tr></thead><tbody>{state.travelers.map(item => <tr key={`${item.safeBookingReference}-${item.sequence}`} className="border-t"><td className="p-3">{item.safeBookingReference}</td><td className="p-3">{item.displayName}</td><td className="p-3">{travelerTypeLabel(item.travelerType)}</td><td className="p-3">{item.phone || '無'}</td></tr>)}</tbody></table></div>}</section>
    <div className="flex gap-2"><button type="button" disabled={state.page <= 1 || state.loading} onClick={() => load(state.page - 1)} className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-50">上一頁</button><span className="px-2 py-2 text-sm">第 {state.page} 頁</span><button type="button" disabled={state.loading || (state.bookings.length < pageSize && state.travelers.length < pageSize)} onClick={() => load(state.page + 1)} className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-50">下一頁</button></div>
    <section aria-label="旅遊進度"><h4 className="font-bold">旅遊進度</h4>{state.events.length === 0 ? <p className="mt-2 text-sm text-slate-500">目前尚無旅遊進度紀錄。</p> : <ol className="mt-3 space-y-3">{state.events.map((event, index) => <li key={`${event.occurredAt}-${index}`} className="border-l-2 border-blue-200 pl-4"><b className="text-sm">{travelEventLabel(event)}</b><p className="text-xs text-slate-500">{dateTime(event.occurredAt)}</p></li>)}</ol>}</section>
  </section>;
}