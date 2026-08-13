import React from 'react';

const inputClass = 'mt-1 w-full rounded border px-3 py-2 disabled:bg-slate-100';
const lines = value => Array.isArray(value) ? value.join('\n') : '';
const list = value => String(value || '').split(/\r?\n/u).map(item => item.trim()).filter(Boolean);

function Field({ label, value, onChange, type = 'text', wide = false, disabled = false }) {
  return <label className={`text-sm font-medium ${wide ? 'md:col-span-2' : ''}`}>{label}<input type={type} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value)} className={inputClass} /></label>;
}
function Area({ label, value, onChange, rows = 3 }) {
  return <label className="text-sm font-medium md:col-span-2">{label}<textarea rows={rows} value={value ?? ''} onChange={event => onChange(event.target.value)} className={inputClass} /></label>;
}
function Leg({ title, leg, set }) {
  return <fieldset className="grid gap-3 rounded-lg border p-3 md:col-span-2 md:grid-cols-2"><legend className="px-1 text-sm font-bold">{title}</legend>
    <Field label="出發時間" value={leg.departureTime} onChange={value => set('departureTime', value)} />
    <Field label="出發機場／城市" value={leg.departureAirportOrCity} onChange={value => set('departureAirportOrCity', value)} />
    <Field label="抵達時間" value={leg.arrivalTime} onChange={value => set('arrivalTime', value)} />
    <Field label="抵達機場／城市" value={leg.arrivalAirportOrCity} onChange={value => set('arrivalAirportOrCity', value)} />
  </fieldset>;
}

export default function TravelPromotionExtractionEditor({ extraction, onChange }) {
  if (!extraction) return <div className="flex min-h-72 items-center justify-center rounded-lg border border-dashed p-5 text-sm text-slate-500">上傳 DM 後執行 AI 分析，結果會自動回填至此。</div>;
  const set = (path, value) => onChange(path, value);
  const confidence = extraction.confidence || {};
  return <section data-testid="travel-promotion-extraction-editor" className="space-y-5">
    <div><h3 className="font-bold">AI 分析結果／人工校正</h3><p className="mt-1 text-xs text-slate-500">圖片為主要來源；不確定內容保持空白，人工確認後再儲存草稿。</p></div>
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="標題" value={extraction.title} onChange={value => set(['title'], value)} />
      <Field label="副標題" value={extraction.subtitle} onChange={value => set(['subtitle'], value)} />
      <Field label="品牌" value={extraction.brand} onChange={value => set(['brand'], value)} />
      <Field label="主題" value={extraction.theme} onChange={value => set(['theme'], value)} />
      <Field label="出發地" value={extraction.departurePlace} onChange={value => set(['departurePlace'], value)} />
      <Field label="國家" value={extraction.country} onChange={value => set(['country'], value)} />
      <Field label="地區" value={extraction.region} onChange={value => set(['region'], value)} />
      <Field label="旅遊天數" type="number" value={extraction.travelDays ?? ''} onChange={value => set(['travelDays'], value === '' ? null : Number(value))} />
      <Field label="出發月份原文" value={extraction.departureMonthText} onChange={value => set(['departureMonthText'], value)} />
      <Field label="出發模式原文" value={extraction.departurePatternText} onChange={value => set(['departurePatternText'], value)} />
      <Field label="價格金額" type="number" value={extraction.price?.amount ?? ''} onChange={value => set(['price', 'amount'], value === '' ? null : Number(value))} />
      <Field label="幣別" value="TWD" disabled onChange={() => {}} />
      <Field label="價格原文" value={extraction.price?.displayText} onChange={value => set(['price', 'displayText'], value)} />
      <Field label="價格備註" value={extraction.price?.priceNote} onChange={value => set(['price', 'priceNote'], value)} />
      <Area label="促銷亮點（每行一項）" value={lines(extraction.promotionHighlights)} onChange={value => set(['promotionHighlights'], list(value))} />
      <Area label="行程摘要（每行一項）" value={lines(extraction.itinerarySummary)} onChange={value => set(['itinerarySummary'], list(value))} />
      <Field label="航空公司" value={extraction.transportation?.airline} onChange={value => set(['transportation', 'airline'], value)} />
      <Field label="交通備註" value={extraction.transportation?.notes} onChange={value => set(['transportation', 'notes'], value)} />
      <Leg title="去程" leg={extraction.transportation?.outbound || {}} set={(key, value) => set(['transportation', 'outbound', key], value)} />
      <Leg title="回程" leg={extraction.transportation?.return || {}} set={(key, value) => set(['transportation', 'return', key], value)} />
      <Area label="電話（每行一筆）" value={lines(extraction.contact?.phones)} onChange={value => set(['contact', 'phones'], list(value))} />
      <Field label="LINE ID" value={extraction.contact?.lineId} onChange={value => set(['contact', 'lineId'], value)} />
      <Field label="地址" value={extraction.contact?.address} onChange={value => set(['contact', 'address'], value)} />
      <Area label="證照（每行一筆）" value={lines(extraction.contact?.licenses)} onChange={value => set(['contact', 'licenses'], list(value))} />
      <Field label="Instagram" value={extraction.social?.instagram} onChange={value => set(['social', 'instagram'], value)} />
      <Field label="Facebook" value={extraction.social?.facebook} onChange={value => set(['social', 'facebook'], value)} />
      <Area label="OCR 原文" rows={8} value={extraction.rawOcrText} onChange={value => set(['rawOcrText'], value)} />
      <Area label="Warnings（每行一項）" value={lines(extraction.warnings)} onChange={value => set(['warnings'], list(value))} />
    </div>
    <div><h4 className="text-sm font-bold">Confidence</h4><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">{['title','price','transportation','contact','social'].map(key => <div key={key} className="rounded border bg-slate-50 p-2 text-center text-xs"><span className="block text-slate-500">{key}</span><strong>{Math.round(Number(confidence[key] || 0) * 100)}%</strong></div>)}</div></div>
  </section>;
}
