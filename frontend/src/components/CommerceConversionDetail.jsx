import React from 'react';
import CommerceAttributionSection from './CommerceAttributionSection';

const money = (amount, currency = 'TWD') => currency === 'TWD'
  ? 'NT$ ' + Number(amount || 0).toLocaleString('zh-TW')
  : currency + ' ' + Number(amount || 0).toLocaleString('zh-TW');

const dateTime = value => value ? new Date(value).toLocaleString('zh-TW') : '—';
const conversionTypeLabel = value => value === 'ORDER_PAID' ? '已付款訂單' : '轉換';

export default function CommerceConversionDetail({ conversion, onClose, onOpenOrder }) {
  if (!conversion) return null;
  return <aside aria-label="轉換明細" className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-lg font-bold">轉換明細</h3><p className="mt-1 text-sm text-slate-500">唯讀的已驗證付款結果。</p></div>
      <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-900">關閉</button>
    </div>
    <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
      <div><dt className="text-slate-500">轉換類型</dt><dd className="mt-1 font-bold">{conversionTypeLabel(conversion.conversionType)}</dd></div>
      <div><dt className="text-slate-500">轉換時間</dt><dd className="mt-1 font-medium">{dateTime(conversion.occurredAt)}</dd></div>
      <div><dt className="text-slate-500">金額</dt><dd className="mt-1 font-bold">{money(conversion.amountMinor, conversion.currencyCode)}</dd></div>
      <div><dt className="text-slate-500">顧客</dt><dd className="mt-1 font-medium">{conversion.customerLabel || '—'}</dd></div>
      <div className="col-span-2"><dt className="text-slate-500">安全訂單編號</dt><dd className="mt-1 break-all font-medium">{conversion.safeOrderReference}</dd></div>
    </dl>
    <button type="button" onClick={() => onOpenOrder(conversion.safeOrderReference)} className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800">查看訂單明細</button>
    <p className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">此轉換由伺服器確認的已付款訂單建立。</p>
    <CommerceAttributionSection summaries={conversion.attributionSummaries} />
  </aside>;
}
