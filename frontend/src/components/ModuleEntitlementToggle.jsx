import React from 'react';
import { Loader2 } from 'lucide-react';

export default function ModuleEntitlementToggle({ enabled, label, pending, onChange }) {
  const statusLabel = enabled ? '已啟用' : '未啟用';
  return (
    <div className="flex items-center gap-3">
      <span className={`text-sm font-medium ${enabled ? 'text-emerald-700' : 'text-gray-500'}`}>
        {pending ? '更新中...' : statusLabel}
      </span>
      <button
        type="button"
        role="switch"
        aria-label={`${label}：${statusLabel}`}
        aria-checked={enabled}
        disabled={pending}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
      >
        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}>
          {pending && <Loader2 size={12} className="animate-spin text-gray-500" />}
        </span>
      </button>
    </div>
  );
}
