import React from 'react';
import { executionStatusLabels, formatCampaignExecutionTime } from '../utils/campaignExecutionPresentation';

export default function CampaignExecutionHistory({ executions = [], selectedReference, onSelect }) {
  if (!executions.length) {
    return <p className="mt-3 text-sm text-gray-500">尚無發送紀錄。</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto rounded border">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-gray-500">
          <tr>
            {['建立時間', '狀態', '總數', '已發送', '失敗', '已取消', '完成時間', '操作'].map((label) => (
              <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {executions.map((execution) => (
            <tr key={execution.safeExecutionReference} className={selectedReference === execution.safeExecutionReference ? 'bg-blue-50' : ''}>
              <td className="whitespace-nowrap px-3 py-2">{formatCampaignExecutionTime(execution.createdAt)}</td>
              <td className="whitespace-nowrap px-3 py-2"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">{executionStatusLabels[execution.status] || '未知狀態'}</span></td>
              <td className="px-3 py-2">{execution.total ?? 0}</td>
              <td className="px-3 py-2 text-emerald-700">{execution.sent ?? 0}</td>
              <td className="px-3 py-2 text-red-700">{execution.failed ?? 0}</td>
              <td className="px-3 py-2">{execution.cancelled ?? 0}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatCampaignExecutionTime(execution.completedAt)}</td>
              <td className="px-3 py-2"><button type="button" onClick={() => onSelect(execution)} className="whitespace-nowrap text-blue-700 hover:underline">查看明細</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
