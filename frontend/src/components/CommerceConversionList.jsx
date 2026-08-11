import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import CommerceConversionDetail from './CommerceConversionDetail';

const money = (amount, currency = 'TWD') => currency === 'TWD'
  ? 'NT$ ' + Number(amount || 0).toLocaleString('zh-TW')
  : currency + ' ' + Number(amount || 0).toLocaleString('zh-TW');

const dateTime = value => value ? new Date(value).toLocaleString('zh-TW') : '—';
const conversionTypeLabel = value => value === 'ORDER_PAID' ? '已付款訂單' : '轉換';

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.success) throw new Error('REQUEST_FAILED');
  return body;
}

export default function CommerceConversionList({ request, onOpenOrder }) {
  const [state, setState] = useState({ loading: true, loadingMore: false, conversions: [], nextCursor: null, selected: null, detailLoading: false, error: '', detailError: '' });
  const load = useCallback(async (cursor = null) => {
    setState(value => ({ ...value, loading: !cursor, loadingMore: Boolean(cursor), error: '', ...(cursor ? {} : { selected: null, detailError: '' }) }));
    try {
      const path = cursor ? '/api/commerce/conversions?limit=25&cursor=' + encodeURIComponent(cursor) : '/api/commerce/conversions?limit=25';
      const body = await readJson(await request(path));
      setState(value => ({ ...value, loading: false, loadingMore: false, conversions: cursor ? [...value.conversions, ...(body.conversions || [])] : (body.conversions || []), nextCursor: body.nextCursor || null }));
    } catch { setState(value => ({ ...value, loading: false, loadingMore: false, error: '目前無法讀取轉換紀錄，請稍後再試。' })); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const open = async conversion => {
    setState(value => ({ ...value, detailLoading: true, detailError: '', selected: null }));
    try {
      const ref = encodeURIComponent(conversion.safeConversionReference);
      const body = await readJson(await request('/api/commerce/conversions/' + ref));
      setState(value => ({ ...value, detailLoading: false, selected: body.conversion }));
    } catch { setState(value => ({ ...value, detailLoading: false, detailError: '找不到可查看的轉換紀錄，或您沒有權限查看。' })); }
  };

  return <section aria-label="轉換紀錄" data-testid="commerce-conversions">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">轉換紀錄</h2><p className="mt-1 text-sm text-slate-500">查看由已驗證付款建立的轉換紀錄，以及目前可安全顯示的歸因證據。</p><p className="mt-1 text-sm text-slate-500">轉換可以成立，即使目前沒有可信任的來源歸因。</p></div><button type="button" onClick={() => load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"><RefreshCw size={16} />重新整理</button></div>
    <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">轉換代表已驗證的付款結果；歸因代表可驗證的來源證據，兩者並不相同。</p>
    <p className="mt-2 text-xs text-slate-500">此頁不以目前載入的分頁估算總筆數或總金額。</p>
    {state.error && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state.error}</p>}
    {state.loading ? <p className="mt-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" />正在讀取轉換紀錄…</p> : <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]"><div><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">轉換時間</th><th className="px-4 py-3">類型</th><th className="px-4 py-3">安全訂單編號</th><th className="px-4 py-3">顧客</th><th className="px-4 py-3">金額</th><th className="px-4 py-3">歸因狀態</th><th className="px-4 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{state.conversions.map(conversion => <tr key={conversion.safeConversionReference}><td className="whitespace-nowrap px-4 py-3">{dateTime(conversion.occurredAt)}</td><td className="px-4 py-3 font-medium">{conversionTypeLabel(conversion.conversionType)}</td><td className="max-w-48 break-all px-4 py-3 text-xs">{conversion.safeOrderReference}</td><td className="px-4 py-3">{conversion.customerLabel || '—'}</td><td className="whitespace-nowrap px-4 py-3 font-bold">{money(conversion.amountMinor, conversion.currencyCode)}</td><td className="px-4 py-3">{(conversion.attributionSummaries || []).length ? '有可信任歸因' : '尚未提供歸因'}</td><td className="px-4 py-3"><button type="button" onClick={() => open(conversion)} className="font-medium text-blue-700">查看明細</button></td></tr>)}</tbody></table>{state.conversions.length === 0 && <div className="p-6 text-center"><p className="text-sm font-medium text-slate-700">目前尚無已驗證的轉換紀錄。</p><p className="mt-1 text-xs text-slate-500">訂單經伺服器確認為已付款後，才會建立轉換紀錄。</p></div>}</div>{state.nextCursor && <button type="button" disabled={state.loadingMore} onClick={() => load(state.nextCursor)} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50">{state.loadingMore ? '載入中…' : '載入更多轉換'}</button>}</div><div>{state.detailLoading && <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" />正在讀取轉換明細…</p>}{state.detailError && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state.detailError}</p>}{state.selected && <CommerceConversionDetail conversion={state.selected} onClose={() => setState(value => ({ ...value, selected: null, detailError: '' }))} onOpenOrder={onOpenOrder} />}{!state.detailLoading && !state.detailError && !state.selected && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">選擇轉換以查看唯讀明細與歸因狀態。</p>}</div></div>}
  </section>;
}
