import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Clipboard, Loader2, Plus, RefreshCw, Search, Sparkles, UploadCloud } from 'lucide-react';
import {
  TRAVEL_PROMOTION_FORMATS,
  canManageTravelPromotions,
  formatPromotionDate,
  isTravelPromotionFormatCountValid,
  parsePromotionListText,
  promotionListText,
  travelPromotionErrorMessage,
  travelPromotionFormat,
  travelPromotionFormatCountHint,
  travelPromotionStatusLabel,
  travelPromotionUiAuthority,
} from '../travel-promotion-presentation';

const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function requestJson(request, path, options) {
  const response = await request(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.success) throw new Error(body?.error || 'REQUEST_FAILED');
  return body;
}
const localDateTime = value => value ? String(value).slice(0, 16) : '';
const toForm = promotion => {
  const draft = promotion?.draft || {};
  return {
    title: draft.title || '', summary: draft.summary || '', destination: draft.destination || '', region: draft.region || '',
    days: draft.days ?? '', departureLocation: draft.departureLocation || '', dateTexts: promotionListText(draft.dateTexts),
    pricingTexts: promotionListText(draft.pricingTexts), promotionTerms: promotionListText(draft.promotionTerms),
    highlights: promotionListText(draft.highlights), keywords: promotionListText(draft.keywords),
    faq: (draft.faq || []).map(item => `${item.question}｜${item.answer}`).join('\n'), replyTemplate: draft.replyTemplate || '',
    socialCopy: draft.socialCopy || '', expiresAt: localDateTime(promotion?.expiresAt),
  };
};
const fromForm = form => ({
  title: form.title.trim(), summary: form.summary.trim(), destination: form.destination.trim(), region: form.region.trim(),
  days: form.days === '' ? null : Number(form.days), departureLocation: form.departureLocation.trim(),
  dateTexts: parsePromotionListText(form.dateTexts, 20), pricingTexts: parsePromotionListText(form.pricingTexts, 20),
  promotionTerms: parsePromotionListText(form.promotionTerms, 20), highlights: parsePromotionListText(form.highlights, 20),
  keywords: parsePromotionListText(form.keywords, 30),
  faq: parsePromotionListText(form.faq, 12).map(row => {
    const [question, ...answer] = row.split('｜');
    return { question: question?.trim() || '', answer: answer.join('｜').trim() };
  }).filter(item => item.question && item.answer),
  replyTemplate: form.replyTemplate.trim(), socialCopy: form.socialCopy.trim(),
  expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
});

function SafeAssetImage({ request, source, alt, large = false }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true; let objectUrl = '';
    if (!source) return undefined;
    request(source).then(response => { if (!response.ok) throw new Error(); return response.blob(); })
      .then(blob => { objectUrl = URL.createObjectURL(blob); if (active) setUrl(objectUrl); }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [request, source]);
  return url
    ? <img src={url} alt={alt} className={`${large ? 'max-h-[520px]' : 'h-36'} w-full rounded-lg object-contain bg-slate-50`} />
    : <div className={`flex ${large ? 'h-64' : 'h-36'} items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400`}>DM 圖片載入中…</div>;
}

function Snapshot({ snapshot }) {
  if (!snapshot) return null;
  return <section className="rounded-lg border border-blue-100 bg-blue-50 p-4"><h4 className="font-bold text-blue-950">DM 快照</h4><div className="mt-2 space-y-1 text-sm text-blue-900"><p>DM 日期：{snapshot.dateTexts?.join('、') || '—'}</p><p>DM 價格：{snapshot.pricingTexts?.join('、') || '—'}</p><p>DM 宣傳資訊：{snapshot.promotionTerms?.join('、') || snapshot.summary || '—'}</p></div></section>;
}
function LiveFacts({ liveTravel, liveLines }) {
  if (Array.isArray(liveLines)) return <section className="rounded-lg border border-emerald-100 bg-emerald-50 p-4"><h4 className="font-bold text-emerald-950">即時資訊</h4>{liveLines.length ? <ul className="mt-2 space-y-1 text-sm text-emerald-900">{liveLines.map(line => <li key={line}>{line}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-900">此素材尚未連結正式行程，目前名額與最新價格需人工確認。</p>}</section>;
  if (!liveTravel) return <section className="rounded-lg border border-amber-100 bg-amber-50 p-4"><h4 className="font-bold text-amber-950">即時資訊</h4><p className="mt-2 text-sm text-amber-900">此素材尚未連結正式行程，目前名額與最新價格需人工確認。</p></section>;
  const departure = liveTravel.departure;
  return <section className="rounded-lg border border-emerald-100 bg-emerald-50 p-4"><h4 className="font-bold text-emerald-950">即時資訊</h4><div className="mt-2 space-y-1 text-sm text-emerald-900"><p>出發狀態：{departure?.status || liveTravel.itinerary?.status || '—'}</p>{departure?.status === 'CANCELLED' && <p className="font-bold text-red-700">此出發日已取消</p>}{liveTravel.soldOut === true && <p className="font-bold">目前已額滿</p>}<p>目前價格：{liveTravel.authoritativePrice ? `${liveTravel.authoritativePrice.currencyCode} ${Number(liveTravel.authoritativePrice.amountMinor).toLocaleString('zh-TW')}` : '—'}</p><p>剩餘名額：{liveTravel.remainingSeats ?? '—'}</p><p>是否可報名：{liveTravel.currentBookability === true ? '是' : '否'}</p></div></section>;
}

function CreateDm({ request, aiEnabled, onCreated }) {
  const [form, setForm] = useState({ displayLabel: '', sourceText: '', expiresAt: '', safeAssetReferences: [] });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const upload = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('僅支援 JPG 與 PNG 圖片。'); return; }
    setUploading(true); setError('');
    try {
      const data = new FormData(); data.append('image', file);
      const body = await requestJson(request, '/api/templates/upload-image', { method: 'POST', body: data });
      setForm(value => ({ ...value, safeAssetReferences: [...value.safeAssetReferences, body.asset.id].slice(0, 8) }));
    } catch (cause) { setError(travelPromotionErrorMessage(cause.message)); }
    finally { setUploading(false); }
  };

  const submit = async event => {
    event.preventDefault();
    if (!form.safeAssetReferences.length && !form.sourceText.trim()) { setError('請先上傳 DM 圖片；若沒有圖片，也可輸入補充文字建立草稿。'); return; }
    setBusy('create'); setError('');
    try {
      const created = await requestJson(request, '/api/travel/promotions', {
        method: 'POST',
        ...json({
          displayLabel: form.displayLabel.trim(), sourceText: form.sourceText.trim(), safeAssetReferences: form.safeAssetReferences,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        }),
      });
      let promotion = created.promotion;
      if (aiEnabled) {
        setBusy('ai');
        try {
          const analyzed = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/extract`, {
            method: 'POST',
            ...json({ expectedVersionNo: promotion.draftVersionNo, expectedSourceRevision: promotion.sourceRevision }),
          });
          promotion = { ...analyzed.promotion, __uiNotice: 'AI 已完成分析並寫入草稿，請逐欄人工校正後再啟用。' };
        } catch (cause) {
          promotion = { ...promotion, __uiNotice: `素材已建立，但 AI 分析未完成：${travelPromotionErrorMessage(cause.message)}。可在校正畫面重新分析。` };
        }
      } else {
        promotion = { ...promotion, __uiNotice: '素材已建立。此工作區尚未啟用 AI，請先人工填寫或啟用 AI 後重新分析。' };
      }
      onCreated(promotion);
    } catch (cause) { setError(travelPromotionErrorMessage(cause.message)); }
    finally { setBusy(''); }
  };

  return <form onSubmit={submit} className="space-y-5 rounded-xl border bg-white p-5" data-testid="travel-promotion-create">
    <div><h2 className="text-xl font-bold">新增宣傳 DM</h2><p className="mt-1 text-sm text-slate-500">先上傳圖片，系統建立素材後由 AI 分析寫入草稿，再進入人工校正。</p></div>
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><b>流程：</b>上傳 DM → AI 分析 → 自動寫入欄位 → 人工校正 → 核准啟用</div>
    <label className="block text-sm font-medium">素材名稱<input required maxLength={160} value={form.displayLabel} onChange={event => setForm(value => ({ ...value, displayLabel: event.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
    <label className="block text-sm font-medium">1. 上傳 DM 圖片（JPG、PNG）<span className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-3"><UploadCloud size={17} />{uploading ? '上傳中…' : `選擇圖片（已選 ${form.safeAssetReferences.length} 張）`}<input type="file" accept="image/jpeg,image/png" onChange={upload} className="sr-only" /></span></label>
    <label className="block text-sm font-medium">補充文字（選填）<textarea maxLength={20000} rows={4} value={form.sourceText} onChange={event => setForm(value => ({ ...value, sourceText: event.target.value }))} placeholder="只有圖片看不清楚、或有額外說明時再補充；一般不需要重新輸入整張 DM。" className="mt-1 w-full rounded-lg border px-3 py-2" /><span className="mt-1 flex justify-between text-xs text-slate-500"><span>AI 會以圖片內容為主要來源，這裡只做補充。</span><span>{form.sourceText.length} / 20,000</span></span></label>
    <label className="block text-sm font-medium">有效期限（選填）<input type="datetime-local" value={form.expiresAt} onChange={event => setForm(value => ({ ...value, expiresAt: event.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
    {!aiEnabled && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">此工作區尚未啟用 AI。素材仍可建立，但不會自動分析。</p>}
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">請勿上傳含身分證、護照、健康或金融個資的文件。</p>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <button disabled={Boolean(busy) || uploading} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Sparkles size={16} />{busy === 'create' ? '正在建立素材…' : busy === 'ai' ? 'AI 正在分析並寫入…' : aiEnabled ? '建立並 AI 分析' : '建立草稿'}</button>
  </form>;
}

function FormalLink({ request, promotion, onChanged }) {
  const [state, setState] = useState({ itineraries: [], departures: [], mode: promotion.formalTravelLink?.safeDepartureReference ? 'departure' : promotion.formalTravelLink ? 'itinerary' : 'none', itinerary: promotion.formalTravelLink?.safeItineraryReference || '', departure: promotion.formalTravelLink?.safeDepartureReference || '', busy: false, error: '' });
  useEffect(() => { requestJson(request, '/api/travel/itineraries').then(body => setState(value => ({ ...value, itineraries: body.itineraries || [] }))).catch(() => {}); }, [request]);
  const chooseItinerary = async reference => { setState(value => ({ ...value, itinerary: reference, departure: '', departures: [] })); if (!reference) return; try { const body = await requestJson(request, `/api/travel/itineraries/${encodeURIComponent(reference)}/departures`); setState(value => ({ ...value, departures: body.departures || [] })); } catch { setState(value => ({ ...value, error: '無法連結指定的正式行程。' })); } };
  const save = async () => { const body = state.mode === 'none' ? { safeItineraryReference: null, safeDepartureReference: null } : state.mode === 'itinerary' ? { safeItineraryReference: state.itinerary, safeDepartureReference: null } : { safeItineraryReference: state.itinerary || null, safeDepartureReference: state.departure }; setState(value => ({ ...value, busy: true, error: '' })); try { const result = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/formal-link`, { method: 'PUT', ...json(body) }); onChanged(result.formalTravelLink); } catch (cause) { setState(value => ({ ...value, error: travelPromotionErrorMessage(cause.message) })); } finally { setState(value => ({ ...value, busy: false })); } };
  return <section className="rounded-xl border bg-white p-5"><h3 className="font-bold">正式行程連結</h3><p className="mt-1 text-sm text-slate-500">{promotion.formalTravelLink ? `${promotion.formalTravelLink.itineraryTitle}${promotion.formalTravelLink.departureDate ? ` · ${promotion.formalTravelLink.departureDate}` : ''}` : '尚未連結正式行程'}</p><div className="mt-4 grid gap-3 md:grid-cols-3"><label className="text-sm font-medium">連結方式<select value={state.mode} onChange={event => setState(value => ({ ...value, mode: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2"><option value="none">不連結正式行程</option><option value="itinerary">選擇行程</option><option value="departure">選擇出發日</option></select></label>{state.mode !== 'none' && <label className="text-sm font-medium">正式行程<select value={state.itinerary} onChange={event => chooseItinerary(event.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">請選擇</option>{state.itineraries.map(item => <option key={item.safeItineraryReference} value={item.safeItineraryReference}>{item.title}</option>)}</select></label>}{state.mode === 'departure' && <label className="text-sm font-medium">出發日<select value={state.departure} onChange={event => setState(value => ({ ...value, departure: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2"><option value="">請選擇</option>{state.departures.map(item => <option key={item.safeDepartureReference} value={item.safeDepartureReference}>{item.departureDate}</option>)}</select></label>}</div>{state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}<button type="button" onClick={save} disabled={state.busy || (state.mode === 'itinerary' && !state.itinerary) || (state.mode === 'departure' && !state.departure)} className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{state.busy ? '儲存中…' : '儲存正式行程連結'}</button></section>;
}

function Review({ request, promotion, userRole, aiEnabled, onChanged, onClose }) {
  const canManage = canManageTravelPromotions(userRole);
  const [form, setForm] = useState(() => toForm(promotion));
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState(promotion.__uiNotice || ''); const [error, setError] = useState('');
  useEffect(() => { setForm(toForm(promotion)); if (promotion.__uiNotice) setMessage(promotion.__uiNotice); }, [promotion]);
  const update = event => setForm(value => ({ ...value, [event.target.name]: event.target.value }));
  const act = async kind => {
    if (!canManage) return;
    if (kind === 'activate' && !globalThis.confirm?.('確定要啟用這份推廣素材嗎？\n啟用後將可被旅遊推廣搜尋與客服建議使用。')) return;
    if (kind === 'archive' && !globalThis.confirm?.('封存後將不再提供新的推廣搜尋使用，歷史版本仍會保留。')) return;
    setBusy(kind); setError(''); setMessage('');
    try {
      let body;
      if (kind === 'save') body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/draft`, { method: 'PATCH', ...json({ ...fromForm(form), expectedVersionNo: promotion.draftVersionNo, expectedSourceRevision: promotion.sourceRevision }) });
      if (kind === 'ai') body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/extract`, { method: 'POST', ...json({ expectedVersionNo: promotion.draftVersionNo, expectedSourceRevision: promotion.sourceRevision }) });
      if (kind === 'activate') body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/activate`, { method: 'POST', ...json({ expectedVersionNo: promotion.draftVersionNo }) });
      if (kind === 'archive') body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/archive`, { method: 'POST', ...json({}) });
      onChanged(body.promotion);
      setMessage(kind === 'ai' ? 'AI 已重新分析並寫入草稿，請再次人工核對。' : kind === 'activate' ? '推廣素材已啟用。' : kind === 'archive' ? '推廣素材已封存。' : '人工校正內容已儲存。');
    } catch (cause) { setError(travelPromotionErrorMessage(cause.message)); }
    finally { setBusy(''); }
  };
  const fields = [['title','標題',120],['summary','摘要',1500],['destination','目的地',120],['region','地區',120],['days','天數',365],['departureLocation','出發地',240],['dateTexts','日期資訊（每行一筆）',3200],['pricingTexts','價格資訊（每行一筆）',4800],['promotionTerms','優惠／注意事項（每行一筆）',10000],['highlights','行程亮點（每行一筆）',6000],['keywords','關鍵字（每行一筆）',2400],['faq','FAQ（每行：問題｜答案）',12000],['replyTemplate','客服回覆模板',3000],['socialCopy','社群宣傳文案',1000],['expiresAt','有效期限',100]];
  const multiline = ['summary','dateTexts','pricingTexts','promotionTerms','highlights','keywords','faq','replyTemplate','socialCopy'];
  return <section className="space-y-5">
    <div><button type="button" onClick={onClose} className="text-sm text-blue-700">← 返回素材庫</button><h2 className="mt-2 text-xl font-bold">{promotion.displayLabel}</h2><p className="text-sm text-slate-500">狀態：{travelPromotionStatusLabel(promotion)} · 草稿 v{promotion.draftVersionNo} · 啟用版本 {promotion.activeVersion ? `v${promotion.activeVersion.versionNo}` : '—'}</p></div>
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><b>AI 分析結果僅為草稿。</b> 請對照左側原始 DM，人工確認日期、價格、優惠條件與行程資訊後再核准啟用。</div>
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.65fr)]">
      <aside className="space-y-4 rounded-xl border bg-white p-5 lg:sticky lg:top-4 lg:self-start">
        <div><h3 className="font-bold">原始 DM</h3><p className="mt-1 text-xs text-slate-500">人工校正時固定對照原圖，避免價格、日期與小字誤判。</p></div>
        <div className="space-y-3">{promotion.sourceAssets?.length ? promotion.sourceAssets.map(asset => <SafeAssetImage key={asset.safeAssetReference} request={request} source={asset.assetUrl} alt="DM 圖片" large />) : <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">沒有上傳圖片。</p>}</div>
        <div><h4 className="text-sm font-bold">補充文字</h4><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{promotion.sourceText || '無補充文字'}</p></div>
        {canManage && <button type="button" onClick={() => act('ai')} disabled={!aiEnabled || Boolean(busy) || promotion.status === 'ARCHIVED'} className="inline-flex w-full items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-bold disabled:opacity-50"><Sparkles size={16} />{busy === 'ai' ? 'AI 正在重新分析…' : '重新 AI 分析'}</button>}
        {!aiEnabled && <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">此工作區尚未啟用 AI。仍可人工編輯。</p>}
      </aside>
      <section className="rounded-xl border bg-white p-5">
        <div><h3 className="font-bold">AI 分析結果／人工校正</h3><p className="mt-1 text-sm text-slate-500">AI 已寫入的內容全部可修改；核准前以人工校正結果為準。</p></div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{fields.map(([name,label,max]) => <label key={name} className={`text-sm font-medium ${multiline.includes(name) ? 'md:col-span-2' : ''}`}>{label}{multiline.includes(name) ? <textarea name={name} maxLength={max} rows={name === 'summary' ? 3 : 4} disabled={!canManage || promotion.status === 'ARCHIVED'} value={form[name]} onChange={update} className="mt-1 w-full rounded border px-3 py-2 disabled:bg-slate-100" /> : <input name={name} type={name === 'days' ? 'number' : name === 'expiresAt' ? 'datetime-local' : 'text'} min={name === 'days' ? 1 : undefined} max={name === 'days' ? 365 : undefined} maxLength={name === 'days' ? undefined : max} disabled={!canManage || promotion.status === 'ARCHIVED'} value={form[name]} onChange={update} className="mt-1 w-full rounded border px-3 py-2 disabled:bg-slate-100" />}</label>)}</div>
        {canManage && promotion.status !== 'ARCHIVED' && <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => act('save')} disabled={Boolean(busy)} className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white">{busy === 'save' ? '儲存中…' : '儲存人工校正草稿'}</button><button type="button" onClick={() => act('activate')} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-bold text-white"><CheckCircle2 size={16} />核准並啟用</button><button type="button" onClick={() => act('archive')} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded border border-amber-300 px-4 py-2 text-sm font-bold text-amber-800"><Archive size={16} />封存素材</button></div>}
      </section>
    </div>
    {canManage && promotion.status === 'ACTIVE' && <FormalLink request={request} promotion={promotion} onChanged={() => onChanged(promotion, true)} />}
  </section>;
}

function Retrieval({ request }) {
  const [query, setQuery] = useState(''); const [state, setState] = useState({ busy: false, matches: [], reply: '', searched: false, error: '' });
  const search = async event => { event.preventDefault(); if (!query.trim()) return; setState(value => ({ ...value, busy: true, error: '' })); try { const body = await requestJson(request, '/api/travel/promotions/search', { method: 'POST', ...json({ query: query.trim(), limit: 5 }) }); setState({ busy: false, matches: body.matches || [], reply: body.replySuggestion || '', searched: true, error: '' }); } catch (cause) { setState({ busy: false, matches: [], reply: '', searched: true, error: travelPromotionErrorMessage(cause.message) }); } };
  const copy = async () => { if (state.reply) await navigator.clipboard.writeText(state.reply); };
  return <section className="rounded-xl border bg-white p-5"><h3 className="text-lg font-bold">測試旅客詢問</h3><p className="mt-1 text-sm text-slate-500">使用確定性搜尋，不需要 AI。</p><form onSubmit={search} className="mt-4 flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} maxLength={300} placeholder="10 月有日本行程嗎？" className="min-w-0 flex-1 rounded border px-3 py-2" /><button className="inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white"><Search size={16} />{state.busy ? '搜尋中…' : '測試查詢'}</button></form>{state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}{state.searched && !state.matches.length && <p className="mt-4 rounded bg-slate-50 p-4 text-sm">目前沒有符合條件且仍有效的推廣素材。</p>}{state.matches.length > 0 && <div className="mt-5 space-y-4"><h4 className="font-bold">符合條件的推廣素材</h4>{state.matches.map(match => <article key={match.safePromotionReference} className="rounded-lg border p-4"><h5 className="font-bold">{match.promotionSnapshot.title}</h5><p className="mt-1 text-xs text-slate-500">符合欄位：{match.matchedFields?.join('、') || '—'} · 關鍵字：{match.matchedKeywords?.join('、') || '—'}</p><div className="mt-3 grid gap-3 md:grid-cols-2"><Snapshot snapshot={match.promotionSnapshot} /><LiveFacts liveTravel={match.liveTravel} /></div></article>)}</div>}{state.reply && <section className="mt-5 rounded-lg border border-violet-100 bg-violet-50 p-4"><h4 className="font-bold text-violet-950">建議回覆</h4><p className="mt-2 whitespace-pre-wrap text-sm text-violet-900">{state.reply}</p><button type="button" onClick={copy} className="mt-3 inline-flex items-center gap-2 rounded border border-violet-300 px-3 py-2 text-sm font-bold"><Clipboard size={16} />複製回覆</button></section>}</section>;
}

function Composer({ request, promotions, campaignEnabled, userRole, onCampaignCreated }) {
  const active = promotions.filter(item => item.status === 'ACTIVE' && item.isExpired !== true);
  const [selected, setSelected] = useState([]); const [format, setFormat] = useState('SINGLE'); const [headline, setHeadline] = useState(''); const [campaignName, setCampaignName] = useState(''); const [state, setState] = useState({ busy: '', composition: null, error: '' });
  const valid = isTravelPromotionFormatCountValid(format, selected.length);
  const compositionBody = { format, safePromotionReferences: selected, options: { ...(headline.trim() ? { headline: headline.trim() } : {}), ctaLabel: '查看旅遊內容' } };
  const toggle = reference => setSelected(value => value.includes(reference) ? value.filter(item => item !== reference) : [...value, reference]);
  const preview = async () => { if (!valid) return; setState({ busy: 'preview', composition: null, error: '' }); try { const body = await requestJson(request, '/api/travel/promotions/compose', { method: 'POST', ...json(compositionBody) }); setState({ busy: '', composition: body.composition, error: '' }); } catch (cause) { setState({ busy: '', composition: null, error: travelPromotionErrorMessage(cause.message) }); } };
  const handoff = async () => { if (!campaignName.trim()) { setState(value => ({ ...value, error: '請輸入活動名稱。' })); return; } if (!valid || !campaignEnabled) return; setState(value => ({ ...value, busy: 'campaign', error: '' })); try { const body = await requestJson(request, '/api/campaigns', { method: 'POST', ...json({ name: campaignName.trim(), description: '由旅遊推廣素材建立', content: { contentType: 'TRAVEL_PROMOTION', composition: compositionBody } }) }); onCampaignCreated?.(body.campaign); } catch (cause) { setState(value => ({ ...value, busy: '', error: travelPromotionErrorMessage(cause.message) })); } };
  return <section className="space-y-5"><div><h2 className="text-xl font-bold">製作推廣內容</h2><p className="text-sm text-slate-500">選擇使用中的素材，使用伺服器建立預覽。</p></div><div className="grid gap-4 md:grid-cols-2"><section className="rounded-xl border bg-white p-5"><h3 className="font-bold">素材多選</h3><div className="mt-3 max-h-72 space-y-2 overflow-auto">{active.map(item => <label key={item.safePromotionReference} className="flex items-center gap-2 rounded border p-3 text-sm"><input type="checkbox" checked={selected.includes(item.safePromotionReference)} onChange={() => toggle(item.safePromotionReference)} />{item.displayLabel}</label>)}</div></section><section className="rounded-xl border bg-white p-5"><label className="text-sm font-medium">格式<select value={format} onChange={event => setFormat(event.target.value)} className="mt-1 w-full rounded border px-3 py-2">{TRAVEL_PROMOTION_FORMATS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><p className={`mt-2 text-sm ${valid ? 'text-emerald-700' : 'text-amber-800'}`}>{travelPromotionFormatCountHint(format)}目前已選 {selected.length} 份。</p><label className="mt-4 block text-sm font-medium">預覽標題<input value={headline} onChange={event => setHeadline(event.target.value)} maxLength={80} className="mt-1 w-full rounded border px-3 py-2" /></label><button type="button" onClick={preview} disabled={!valid || Boolean(state.busy)} className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{state.busy === 'preview' ? '正在建立推廣預覽…' : '預覽推廣內容'}</button></section></div>{state.error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}{state.composition && <section className="rounded-xl border bg-white p-5"><h3 className="font-bold">預覽 · {travelPromotionFormat(state.composition.format).label}</h3><div className="mt-4 grid gap-3 md:grid-cols-2">{state.composition.preview?.items?.map(item => <article key={item.safePromotionReference} className="rounded-lg border p-4"><h4 className="font-bold">{item.title}</h4><p className="mt-1 text-sm text-slate-600">{item.summary}</p><div className="mt-3 grid gap-3"><section className="rounded bg-blue-50 p-3"><b>DM 快照</b>{item.snapshotLines?.map(line => <p key={line} className="text-sm">{line}</p>)}</section><LiveFacts liveLines={item.liveLines} /></div></article>)}</div><h4 className="mt-5 font-bold">備援文字</h4><p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{state.composition.fallbackText}</p></section>}<section className="rounded-xl border bg-white p-5"><h3 className="font-bold">建立行銷活動草稿</h3><p className="mt-2 text-sm text-slate-600">建立行銷活動後，該版本的推廣內容會被固定；後續修改 DM 素材不會自動改變已建立的行銷內容。</p>{campaignEnabled ? <><label className="mt-4 block text-sm font-medium">活動名稱<input value={campaignName} onChange={event => setCampaignName(event.target.value)} maxLength={120} className="mt-1 w-full rounded border px-3 py-2" /></label>{canManageTravelPromotions(userRole) && <button type="button" onClick={handoff} disabled={!valid || Boolean(state.busy)} className="mt-4 rounded bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{state.busy === 'campaign' ? '正在建立行銷活動草稿…' : '建立行銷活動草稿'}</button>}</> : <p className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-900">此工作區尚未啟用行銷活動模組。推廣預覽仍可使用。</p>}</section></section>;
}

export default function TravelPromotionWorkspace({ request, userRole = 'viewer', travelEnabled = true, campaignEnabled = false, aiEnabled = false, onCampaignCreated }) {
  const authority = travelPromotionUiAuthority({ travelEnabled, campaignEnabled }); const canManage = canManageTravelPromotions(userRole);
  const [view, setView] = useState('library'); const [state, setState] = useState({ loading: true, items: [], selected: null, error: '' }); const [filters, setFilters] = useState({ search: '', status: 'ALL', destination: 'ALL', expiry: 'ALL' });
  const load = useCallback(async () => { setState(value => ({ ...value, loading: true, error: '' })); try { const body = await requestJson(request, '/api/travel/promotions'); setState(value => ({ ...value, loading: false, items: body.promotions || [] })); } catch (cause) { setState(value => ({ ...value, loading: false, error: travelPromotionErrorMessage(cause.message) })); } }, [request]);
  useEffect(() => { if (authority.travelAvailable) load(); }, [authority.travelAvailable, load]);
  const open = async reference => { try { const body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(reference)}`); setState(value => ({ ...value, selected: body.promotion, error: '' })); } catch (cause) { setState(value => ({ ...value, error: travelPromotionErrorMessage(cause.message) })); } };
  const changed = async (promotion, refresh = false) => { if (refresh) return open(promotion.safePromotionReference); setState(value => ({ ...value, selected: promotion })); await load(); };
  const filtered = useMemo(() => state.items.filter(item => { const draft = item.activeVersion?.content || item.draft || {}; const search = filters.search.trim().toLowerCase(); return (!search || `${item.displayLabel} ${draft.title || ''} ${draft.destination || ''}`.toLowerCase().includes(search)) && (filters.status === 'ALL' || item.status === filters.status) && (filters.destination === 'ALL' || draft.destination === filters.destination) && (filters.expiry === 'ALL' || (filters.expiry === 'EXPIRED') === Boolean(item.isExpired)); }), [filters, state.items]);
  const destinations = [...new Set(state.items.map(item => (item.activeVersion?.content || item.draft)?.destination).filter(Boolean))].sort();
  if (!authority.travelAvailable) return <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">此工作區尚未啟用此功能模組。</p>;
  if (state.selected) return <Review request={request} promotion={state.selected} userRole={userRole} aiEnabled={aiEnabled} onChanged={changed} onClose={() => setState(value => ({ ...value, selected: null }))} />;
  return <section className="space-y-5" data-testid="travel-promotion-workspace"><nav aria-label="推廣素材功能" className="flex flex-wrap gap-2">{[['library','素材庫'],['create','新增 DM'],['compose','製作推廣內容']].map(([id,label]) => <button key={id} type="button" onClick={() => setView(id)} disabled={id === 'create' && !canManage} className={`rounded-lg px-4 py-2 text-sm font-bold ${view === id ? 'bg-slate-900 text-white' : 'border bg-white'} disabled:opacity-40`}>{label}</button>)}</nav>{view === 'create' && canManage && <CreateDm request={request} aiEnabled={aiEnabled} onCreated={promotion => { setState(value => ({ ...value, selected: promotion })); load(); }} />}{view === 'compose' && <Composer request={request} promotions={state.items} campaignEnabled={authority.campaignHandoffAvailable} userRole={userRole} onCampaignCreated={onCampaignCreated} />}{view === 'library' && <><section className="rounded-xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">素材庫</h2><p className="text-sm text-slate-500">審核後的 DM 快照與正式行程即時資訊分開顯示。</p></div><button type="button" onClick={load} className="rounded border p-2" aria-label="重新載入推廣素材"><RefreshCw size={17} /></button></div><div className="mt-4 grid gap-3 md:grid-cols-4"><input aria-label="搜尋推廣素材" value={filters.search} onChange={event => setFilters(value => ({ ...value, search: event.target.value }))} placeholder="搜尋標題或目的地" className="rounded border px-3 py-2 text-sm" /><select aria-label="狀態篩選" value={filters.status} onChange={event => setFilters(value => ({ ...value, status: event.target.value }))} className="rounded border px-3 py-2 text-sm"><option value="ALL">全部狀態</option><option value="DRAFT">草稿</option><option value="ACTIVE">使用中</option><option value="ARCHIVED">已封存</option></select><select aria-label="目的地篩選" value={filters.destination} onChange={event => setFilters(value => ({ ...value, destination: event.target.value }))} className="rounded border px-3 py-2 text-sm"><option value="ALL">全部目的地</option>{destinations.map(value => <option key={value} value={value}>{value}</option>)}</select><select aria-label="有效期篩選" value={filters.expiry} onChange={event => setFilters(value => ({ ...value, expiry: event.target.value }))} className="rounded border px-3 py-2 text-sm"><option value="ALL">全部有效期</option><option value="CURRENT">仍有效</option><option value="EXPIRED">已過期</option></select></div>{state.error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}{state.loading ? <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" />正在載入推廣素材…</p> : !filtered.length ? <p className="mt-5 rounded border border-dashed p-8 text-center text-sm text-slate-500">目前沒有推廣素材。</p> : <div className="mt-5 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['標題','狀態','目的地','日期資訊','價格資訊','有效期限','正式行程連結','更新時間'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{filtered.map(item => { const content = item.activeVersion?.content || item.draft || {}; return <tr key={item.safePromotionReference} className="border-t"><td className="p-3"><button type="button" onClick={() => open(item.safePromotionReference)} className="font-bold text-blue-700">{content.title || item.displayLabel}</button></td><td className="p-3">{travelPromotionStatusLabel(item)}</td><td className="p-3">{content.destination || '—'}</td><td className="p-3">{content.dateTexts?.join('、') || '—'}</td><td className="p-3">{content.pricingTexts?.join('、') || '—'}</td><td className="p-3">{formatPromotionDate(item.expiresAt)}</td><td className="p-3">查看素材確認</td><td className="p-3">{formatPromotionDate(item.updatedAt)}</td></tr>; })}</tbody></table></div>}</section><Retrieval request={request} /></>}</section>;
}
