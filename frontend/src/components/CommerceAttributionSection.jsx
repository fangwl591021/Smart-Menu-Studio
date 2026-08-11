import React from 'react';

const SECTIONS = [
  { type: 'CAMPAIGN', title: 'Campaign', empty: '目前尚未提供可信任的 Campaign 歸因資料。' },
  { type: 'REFERRAL', title: '推薦關係', empty: '目前尚未提供可信任的推薦關係資料。' },
  { type: 'DEALER', title: '經銷關係', empty: '目前尚未提供可信任的經銷關係資料。' },
];

const safeSummary = (summaries, type) => (Array.isArray(summaries) ? summaries : [])
  .find(item => String(item?.attributionType || '').toUpperCase() === type);

export default function CommerceAttributionSection({ summaries = [] }) {
  return <section aria-label="歸因證據" className="mt-6">
    <h4 className="font-bold text-slate-900">歸因證據</h4>
    <p className="mt-1 text-sm text-slate-600">歸因代表可驗證的來源證據，與轉換本身是不同概念。</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">{SECTIONS.map(section => {
      const summary = safeSummary(summaries, section.type);
      const label = typeof summary?.safeLabel === 'string' ? summary.safeLabel.trim().slice(0, 120) : '';
      return <article key={section.type} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h5 className="text-sm font-bold text-slate-900">{section.title}</h5>
        <p className="mt-2 text-xs leading-5 text-slate-600">{label || section.empty}</p>
      </article>;
    })}</div>
    <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">沒有歸因資料不代表轉換無效；歸因需要可驗證的來源證據。</p>
  </section>;
}
