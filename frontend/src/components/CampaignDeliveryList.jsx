import React from 'react';
import { deliveryStatusLabels, formatCampaignExecutionTime, safeDeliveryErrorLabel } from '../utils/campaignExecutionPresentation';

export default function CampaignDeliveryList({ deliveries = [], loading, nextOffset, onLoadMore }) {
  if (loading && !deliveries.length) return <p className="mt-3 text-sm text-gray-500">載入收件人狀態中…</p>;
  if (!deliveries.length) return <p className="mt-3 text-sm text-gray-500">尚無收件人發送狀態。</p>;

  return (
    <div className="mt-3">
      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-gray-500">
            <tr>
              {['收件人', '狀態', '嘗試次數', '結果說明', '最近嘗試時間'].map((label) => <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {deliveries.map((delivery, index) => (
              <tr key={`${delivery.personLabel}-${delivery.attemptedAt || 'pending'}-${index}`}>
                <td className="px-3 py-2 font-medium text-gray-900">{delivery.personLabel || 'LINE member'}</td>
                <td className="whitespace-nowrap px-3 py-2">{deliveryStatusLabels[delivery.status] || '未知狀態'}</td>
                <td className="px-3 py-2">{delivery.attemptCount ?? 0}</td>
                <td className="max-w-sm px-3 py-2 text-gray-600">{delivery.safeErrorCode ? safeDeliveryErrorLabel(delivery.safeErrorCode) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatCampaignExecutionTime(delivery.attemptedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextOffset !== null && nextOffset !== undefined && (
        <button type="button" onClick={onLoadMore} disabled={loading} className="mt-3 rounded border px-4 py-2 text-sm text-gray-700 disabled:opacity-50">
          {loading ? '載入中…' : '載入更多'}
        </button>
      )}
    </div>
  );
}
