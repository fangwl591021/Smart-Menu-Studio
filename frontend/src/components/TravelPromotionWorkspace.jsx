import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Clipboard, Loader2, Plus, RefreshCw, Search, Share2, Sparkles, UploadCloud } from 'lucide-react';
import TravelPromotionExtractionEditor from './TravelPromotionExtractionEditor';
import {
  TRAVEL_PROMOTION_FORMATS,
  canManageTravelPromotions,
  formatPromotionDate,
  isTravelPromotionFormatCountValid,
  parsePromotionListText,
  promotionListText,
  travelPromotionErrorMessage,
  travelPromotionFormatCountHint,
  travelPromotionStatusLabel,
  travelPromotionUiAuthority,
} from '../travel-promotion-presentation';

const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function requestJson(request, path, options) {
  const response = await request(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.success) {
    const error = new Error(body?.error || '操作失敗');
    error.errorCode = body?.errorCode || 'REQUEST_FAILED';
    error.backendError = body?.error || '操作失敗';
    throw error;
  }
  return body;
}
const requestErrorDetail = cause => {
  if (!(cause instanceof Error)) return 'REQUEST_FAILED：操作失敗';
  return (cause.errorCode || 'REQUEST_FAILED') + '：' + (cause.backendError || cause.message || '操作失敗');
};
const localDateTime = value => value ? String(value).slice(0, 16) : '';
const toForm = promotion => { const draft = promotion?.draft || {}; return { title: draft.title || '', summary: draft.summary || '', destination: draft.destination || '', region: draft.region || '', days: draft.days ?? '', departureLocation: draft.departureLocation || '', dateTexts: promotionListText(draft.dateTexts), pricingTexts: promotionListText(draft.pricingTexts), promotionTerms: promotionListText(draft.promotionTerms), highlights: promotionListText(draft.highlights), keywords: promotionListText(draft.keywords), faq: (draft.faq || []).map(item => `${item.question}｜${item.answer}`).join('\n'), replyTemplate: draft.replyTemplate || '', socialCopy: draft.socialCopy || '', expiresAt: localDateTime(promotion?.expiresAt) }; };
const fromForm = form => ({ title: form.title.trim(), summary: form.summary.trim(), destination: form.destination.trim(), region: form.region.trim(), days: form.days === '' ? null : Number(form.days), departureLocation: form.departureLocation.trim(), dateTexts: parsePromotionListText(form.dateTexts, 20), pricingTexts: parsePromotionListText(form.pricingTexts, 20), promotionTerms: parsePromotionListText(form.promotionTerms, 20), highlights: parsePromotionListText(form.highlights, 20), keywords: parsePromotionListText(form.keywords, 30), faq: parsePromotionListText(form.faq, 12).map(row => { const [question, ...answer] = row.split('｜'); return { question: question?.trim() || '', answer: answer.join('｜').trim() }; }).filter(item => item.question && item.answer), replyTemplate: form.replyTemplate.trim(), socialCopy: form.socialCopy.trim(), expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null });

function SafeAssetImage({ request, source, alt, className = 'max-h-[70vh] w-full rounded-lg object-contain' }) { const [url, setUrl] = useState(''); useEffect(() => { let active = true; let objectUrl = ''; if (!source) return undefined; request(source).then(response => { if (!response.ok) throw new Error(); return response.blob(); }).then(blob => { objectUrl = URL.createObjectURL(blob); if (active) setUrl(objectUrl); }).catch(() => {}); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [request, source]); return url ? <img src={url} alt={alt} className={className} /> : <div className="flex min-h-32 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">DM 圖片載入中…</div>; }

function Snapshot({ snapshot }) { if (!snapshot) return null; return <section className="rounded-lg border border-blue-100 bg-blue-50 p-4"><h4 className="font-bold text-blue-950">DM 快照</h4><div className="mt-2 space-y-1 text-sm text-blue-900"><p>DM 日期：{snapshot.dateTexts?.join('、') || '—'}</p><p>DM 價格：{snapshot.pricingTexts?.join('、') || '—'}</p><p>DM 宣傳資訊：{snapshot.promotionTerms?.join('、') || snapshot.summary || '—'}</p></div></section>; }
function LiveFacts({ liveTravel, liveLines }) { if (Array.isArray(liveLines)) return <section className="rounded-lg border border-emerald-100 bg-emerald-50 p-4"><h4 className="font-bold text-emerald-950">即時資訊</h4>{liveLines.length ? <ul className="mt-2 space-y-1 text-sm text-emerald-900">{liveLines.map(line => <li key={line}>{line}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-900">此素材尚未連結正式行程，目前名額與最新價格需人工確認。</p>}</section>;
  if (!liveTravel) return <section className="rounded-lg border border-amber-100 bg-amber-50 p-4"><h4 className="font-bold text-amber-950">即時資訊</h4><p className="mt-2 text-sm text-amber-900">此素材尚未連結正式行程，目前名額與最新價格需人工確認。</p></section>;
  const departure = liveTravel.departure; return <section className="rounded-lg border border-emerald-100 bg-emerald-50 p-4"><h4 className="font-bold text-emerald-950">即時資訊</h4><div className="mt-2 space-y-1 text-sm text-emerald-900"><p>出發狀態：{departure?.status || liveTravel.itinerary?.status || '—'}</p>{departure?.status === 'CANCELLED' && <p className="font-bold text-red-700">此出發日已取消</p>}{liveTravel.soldOut === true && <p className="font-bold">目前已額滿</p>}<p>目前價格：{liveTravel.authoritativePrice ? `${liveTravel.authoritativePrice.currencyCode} ${Number(liveTravel.authoritativePrice.amountMinor).toLocaleString('zh-TW')}` : '—'}</p><p>剩餘名額：{liveTravel.remainingSeats ?? '—'}</p><p>是否可報名：{liveTravel.currentBookability === true ? '是' : '否'}</p></div></section>; }

function CreateDm({ request, onCreated, aiEnabled }) {
  const [form, setForm] = useState({ sourceText: '', expiresAt: '', safeAssetReferences: [] });
  const [previews, setPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('僅支援 JPG 與 PNG 圖片。');
      return;
    }
    if (file.size < 1 || file.size > 1024 * 1024) {
      setError('TRAVEL_PROMOTION_DM_IMAGE_SIZE_INVALID：DM 圖片大小必須介於 1 byte 與 1MB。');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const data = new FormData();
      data.append('image', file);
      data.append('purpose', 'travel-promotion-dm');
      const response = await request('/api/templates/upload-image', { method: 'POST', body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.success) {
        const detail = [body?.errorCode, body?.error].filter(Boolean).join('：');
        throw new Error(detail || `HTTP_${response.status}：DM 圖片上傳失敗。`);
      }
      if (!body.asset?.id) throw new Error('TRAVEL_PROMOTION_DM_ASSET_INVALID：上傳完成但未取得圖片資產。');
      setForm(value => ({ ...value, safeAssetReferences: [...value.safeAssetReferences, body.asset.id].slice(0, 8) }));
      setPreviews(value => [...value, { reference: body.asset.id, imageUrl: body.asset.imageUrl, name: file.name }].slice(0, 8));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'TRAVEL_PROMOTION_DM_IMAGE_UPLOAD_FAILED：DM 圖片上傳失敗。');
    } finally {
      setUploading(false);
    }
  };
  const removePreview = reference => {
    setForm(value => ({ ...value, safeAssetReferences: value.safeAssetReferences.filter(item => item !== reference) }));
    setPreviews(value => value.filter(item => item.reference !== reference));
  };
  const clear = () => {
    setForm({ sourceText: '', expiresAt: '', safeAssetReferences: [] });
    setPreviews([]);
    setError('');
  };
  const submit = async event => {
    event.preventDefault();
    if (!form.safeAssetReferences.length) {
      setError('請先上傳 DM 圖片。');
      return;
    }
    if (!aiEnabled) {
      setError('此工作區尚未啟用 AI 功能。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const createdBody = await requestJson(request, '/api/travel/promotions', {
        method: 'POST',
        ...json({
          sourceText: form.sourceText,
          safeAssetReferences: form.safeAssetReferences,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        }),
      });
      const created = createdBody.promotion;
      const extractedBody = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(created.safePromotionReference)}/extract`, {
        method: 'POST',
        ...json({ expectedVersionNo: created.draftVersionNo, expectedSourceRevision: created.sourceRevision }),
      });
      onCreated(extractedBody.promotion);
    } catch (cause) {
      setError(requestErrorDetail(cause));
    } finally {
      setBusy(false);
    }
  };
  return <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6" data-testid="travel-promotion-create">
    <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 md:flex-row md:items-start md:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-600">Promotion DM</p><h2 className="mt-1 text-2xl font-black">新增宣傳 DM</h2><p className="mt-2 text-sm leading-6 text-slate-500">先上傳 DM 圖片，系統會判斷素材類型並完成 AI 解析，再由您人工校正。DM 是推廣素材，不是正式行程。</p></div>
      <span className={`w-fit rounded-full px-4 py-2 text-sm font-black ${aiEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{aiEnabled ? 'AI 已啟用' : 'AI 尚未啟用'}</span>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/70 p-5">
        <div className="flex items-center gap-3 text-emerald-900"><span className="rounded-2xl bg-white p-3 shadow-sm"><UploadCloud size={22} /></span><div><h3 className="font-black">上傳 DM 圖片</h3><p className="mt-1 text-xs text-emerald-700">支援 JPG、PNG，單張不超過 1MB。</p></div></div>
        <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700"><UploadCloud size={17} />{uploading ? '上傳中…' : `選擇圖片（已選 ${form.safeAssetReferences.length} 張）`}<input type="file" accept="image/jpeg,image/png" onChange={upload} className="sr-only" /></label>
        {previews.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{previews.map(item => <div key={item.reference} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"><SafeAssetImage request={request} source={item.imageUrl} alt={item.name || '已選 DM'} className="h-32 w-full object-contain bg-slate-50" /><div className="flex items-center justify-between gap-2 p-2"><span className="truncate text-xs font-bold text-slate-500">{item.name}</span><button type="button" onClick={() => removePreview(item.reference)} className="shrink-0 text-xs font-black text-rose-600">移除</button></div></div>)}</div>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <label className="block text-sm font-black text-slate-800">貼上 DM 文字（選填）<span className="mt-1 block text-xs font-medium text-slate-500">若圖片中有模糊文字，可補充價格、日期或活動說明。</span><textarea maxLength={20000} rows={7} value={form.sourceText} onChange={event => setForm(value => ({ ...value, sourceText: event.target.value }))} className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-emerald-500" placeholder="補充宣傳文案、價格、天數、出發地或注意事項…" /><span className="mt-1 block text-right text-xs text-slate-500">{form.sourceText.length} / 20,000</span></label>
        <label className="mt-4 block text-sm font-black text-slate-800">有效期限（選填）<input type="datetime-local" value={form.expiresAt} onChange={event => setForm(value => ({ ...value, expiresAt: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium outline-none focus:border-emerald-500" /></label>
      </section>
    </div>
    {(uploading || busy) && <section aria-label="AI 處理進度" className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3"><div className="flex items-center justify-between text-xs font-black text-blue-700"><span>{uploading ? '正在安全上傳圖片' : '正在判斷素材類型並進行 AI 解析'}</span><span>{uploading ? '1 / 3' : '2 / 3'}</span></div><div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: uploading ? '34%' : '72%' }} /></div></section>}
    <p className="mt-5 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">請勿上傳含身分證、護照、健康或金融個資的文件。AI 結果必須經人工核對後才能啟用。</p>
    {!aiEnabled && <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">此工作區尚未啟用 AI 功能。</p>}
    {error && <p role="alert" className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}
    <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy || uploading || !form.safeAssetReferences.length || !aiEnabled} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"><Sparkles size={17} />{busy ? '正在建立並分析…' : '抽取並進入人工校正'}</button><button type="button" onClick={clear} disabled={busy || uploading} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">清空</button></div>
  </form>;
}

function FormalLink({ request, promotion, onChanged }) { const [state, setState] = useState({ itineraries: [], departures: [], mode: promotion.formalTravelLink?.safeDepartureReference ? 'departure' : promotion.formalTravelLink ? 'itinerary' : 'none', itinerary: promotion.formalTravelLink?.safeItineraryReference || '', departure: promotion.formalTravelLink?.safeDepartureReference || '', busy: false, error: '' }); useEffect(() => { requestJson(request, '/api/travel/itineraries').then(body => setState(value => ({ ...value, itineraries: body.itineraries || [] }))).catch(() => {}); }, [request]); const chooseItinerary = async reference => { setState(value => ({ ...value, itinerary: reference, departure: '', departures: [] })); if (!reference) return; try { const body = await requestJson(request, `/api/travel/itineraries/${encodeURIComponent(reference)}/departures`); setState(value => ({ ...value, departures: body.departures || [] })); } catch { setState(value => ({ ...value, error: '無法連結指定的正式行程。' })); } }; const save = async () => { const body = state.mode === 'none' ? { safeItineraryReference: null, safeDepartureReference: null } : state.mode === 'itinerary' ? { safeItineraryReference: state.itinerary, safeDepartureReference: null } : { safeItineraryReference: state.itinerary || null, safeDepartureReference: state.departure }; setState(value => ({ ...value, busy: true, error: '' })); try { const result = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/formal-link`, { method: 'PUT', ...json(body) }); onChanged(result.formalTravelLink); } catch (cause) { setState(value => ({ ...value, error: travelPromotionErrorMessage(cause.message) })); } finally { setState(value => ({ ...value, busy: false })); } }; return <section className="rounded-xl border bg-white p-5"><h3 className="font-bold">正式行程連結</h3><p className="mt-1 text-sm text-slate-500">{promotion.formalTravelLink ? `${promotion.formalTravelLink.itineraryTitle}${promotion.formalTravelLink.departureDate ? ` · ${promotion.formalTravelLink.departureDate}` : ''}` : '尚未連結正式行程'}</p><div className="mt-4 grid gap-3 md:grid-cols-3"><label className="text-sm font-medium">連結方式<select value={state.mode} onChange={event => setState(value => ({ ...value, mode: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2"><option value="none">不連結正式行程</option><option value="itinerary">選擇行程</option><option value="departure">選擇出發日</option></select></label>{state.mode !== 'none' && <label className="text-sm font-medium">正式行程<select value={state.itinerary} onChange={event => chooseItinerary(event.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">請選擇</option>{state.itineraries.map(item => <option key={item.safeItineraryReference} value={item.safeItineraryReference}>{item.title}</option>)}</select></label>}{state.mode === 'departure' && <label className="text-sm font-medium">出發日<select value={state.departure} onChange={event => setState(value => ({ ...value, departure: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2"><option value="">請選擇</option>{state.departures.map(item => <option key={item.safeDepartureReference} value={item.safeDepartureReference}>{item.departureDate}</option>)}</select></label>}</div>{state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}<button type="button" onClick={save} disabled={state.busy || (state.mode === 'itinerary' && !state.itinerary) || (state.mode === 'departure' && !state.departure)} className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{state.busy ? '儲存中…' : '儲存正式行程連結'}</button></section>; }

function Review({ request, promotion, userRole, aiEnabled, onChanged, onClose }) { const canManage = canManageTravelPromotions(userRole); const [form, setForm] = useState(() => toForm(promotion)); const [extraction, setExtraction] = useState(promotion.extraction || null); const [busy, setBusy] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); useEffect(() => { setForm(toForm(promotion)); setExtraction(promotion.extraction || null); }, [promotion]); const update = event => setForm(value => ({ ...value, [event.target.name]: event.target.value })); const updateExtraction = (path, value) => setExtraction(current => { const next = structuredClone(current); let target = next; for (const key of path.slice(0, -1)) target = target[key]; target[path.at(-1)] = value; return next; }); const act = async (kind) => { if (!canManage) return; if (kind === 'activate' && !globalThis.confirm?.('確定要啟用這份推廣素材嗎？\n啟用後將可被旅遊推廣搜尋與客服建議使用。')) return; if (kind === 'archive' && !globalThis.confirm?.('封存後將不再提供新的推廣搜尋使用，歷史版本仍會保留。')) return; setBusy(kind); setError(''); setMessage(''); try { let body; if (kind === 'save') body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/draft`, { method: 'PATCH', ...json({ ...fromForm(form), extraction, expectedVersionNo: promotion.draftVersionNo, expectedSourceRevision: promotion.sourceRevision }) }); if (kind === 'ai') body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/extract`, { method: 'POST', ...json({ expectedVersionNo: promotion.draftVersionNo, expectedSourceRevision: promotion.sourceRevision }) }); if (kind === 'activate') body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/activate`, { method: 'POST', ...json({ expectedVersionNo: promotion.draftVersionNo }) }); if (kind === 'archive') body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(promotion.safePromotionReference)}/archive`, { method: 'POST', ...json({}) }); onChanged(body.promotion); setMessage(kind === 'ai' ? 'AI 草稿已產生，請確認內容。' : kind === 'activate' ? '推廣素材已啟用' : kind === 'archive' ? '推廣素材已封存' : '草稿已儲存'); } catch (cause) { setError(travelPromotionErrorMessage(cause.message)); } finally { setBusy(''); } }; const fields = [['title','標題',120],['summary','摘要',1500],['destination','目的地',120],['region','地區',120],['days','天數',365],['departureLocation','出發地',240],['dateTexts','日期資訊（每行一筆）',3200],['pricingTexts','價格資訊（每行一筆）',4800],['promotionTerms','優惠／注意事項（每行一筆）',10000],['highlights','行程亮點（每行一筆）',6000],['keywords','關鍵字（每行一筆）',2400],['faq','FAQ（每行：問題｜答案）',12000],['replyTemplate','客服回覆模板',3000],['socialCopy','社群宣傳文案',1000],['expiresAt','有效期限',100]]; return <section className="space-y-5"><div className="flex justify-between"><div><button type="button" onClick={onClose} className="text-sm text-blue-700">← 返回素材庫</button><h2 className="mt-2 text-xl font-bold">{promotion.displayLabel}</h2><p className="text-sm text-slate-500">狀態：{travelPromotionStatusLabel(promotion)}</p></div></div><section className="rounded-xl border bg-white p-5"><h3 className="font-bold">來源</h3><div className="mt-3 grid gap-4 md:grid-cols-2">{promotion.sourceAssets?.map(asset => <SafeAssetImage key={asset.safeAssetReference} request={request} source={asset.assetUrl} alt="原始 DM" />)}<TravelPromotionExtractionEditor extraction={extraction} onChange={updateExtraction} /><div className="md:col-span-2"><h4 className="text-sm font-bold">原始文字</h4><p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{promotion.sourceText || '—'}</p></div></div></section><section className="rounded-xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">人工核對</h3><p className="text-xs text-slate-500">目前版本 v{promotion.draftVersionNo} · 目前啟用版本 {promotion.activeVersion ? `v${promotion.activeVersion.versionNo}` : '—'} · 草稿版本 v{promotion.draftVersionNo}</p></div>{canManage && <button type="button" onClick={() => act('ai')} disabled={!aiEnabled || Boolean(busy)} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm font-bold disabled:opacity-50"><Sparkles size={16} />{busy === 'ai' ? '正在重新解析 DM…' : '重新 AI 解析'}</button>}</div>{!aiEnabled && <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">此工作區尚未啟用 AI 功能。仍可手動編輯、啟用與封存。</p>}<p className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-900">AI 解析內容僅供草稿使用，啟用前請人工確認日期、價格、行程與優惠資訊。</p><div className="mt-4 grid gap-4 md:grid-cols-2">{fields.map(([name,label,max]) => <label key={name} className={`text-sm font-medium ${['summary','dateTexts','pricingTexts','promotionTerms','highlights','keywords','faq','replyTemplate','socialCopy'].includes(name) ? 'md:col-span-2' : ''}`}>{label}{['summary','dateTexts','pricingTexts','promotionTerms','highlights','keywords','faq','replyTemplate','socialCopy'].includes(name) ? <textarea name={name} maxLength={max} rows={name === 'summary' ? 3 : 4} disabled={!canManage || promotion.status === 'ARCHIVED'} value={form[name]} onChange={update} className="mt-1 w-full rounded border px-3 py-2 disabled:bg-slate-100" /> : <input name={name} type={name === 'days' ? 'number' : name === 'expiresAt' ? 'datetime-local' : 'text'} min={name === 'days' ? 1 : undefined} max={name === 'days' ? 365 : undefined} maxLength={name === 'days' ? undefined : max} disabled={!canManage || promotion.status === 'ARCHIVED'} value={form[name]} onChange={update} className="mt-1 w-full rounded border px-3 py-2 disabled:bg-slate-100" />}</label>)}</div>{message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{canManage && promotion.status !== 'ARCHIVED' && <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => act('save')} disabled={Boolean(busy)} className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white">儲存草稿</button><button type="button" onClick={() => act('activate')} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-bold text-white"><CheckCircle2 size={16} />核准並啟用</button><button type="button" onClick={() => act('archive')} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded border border-amber-300 px-4 py-2 text-sm font-bold text-amber-800"><Archive size={16} />封存素材</button></div>}</section>{canManage && promotion.status === 'ACTIVE' && <FormalLink request={request} promotion={promotion} onChanged={() => onChanged(promotion, true)} />}</section>; }

function Retrieval({ request }) { const [query, setQuery] = useState(''); const [state, setState] = useState({ busy: false, matches: [], reply: '', searched: false, error: '' }); const search = async event => { event.preventDefault(); if (!query.trim()) return; setState(value => ({ ...value, busy: true, error: '' })); try { const body = await requestJson(request, '/api/travel/promotions/search', { method: 'POST', ...json({ query: query.trim(), limit: 5 }) }); setState({ busy: false, matches: body.matches || [], reply: body.replySuggestion || '', searched: true, error: '' }); } catch (cause) { setState({ busy: false, matches: [], reply: '', searched: true, error: travelPromotionErrorMessage(cause.message) }); } }; const copy = async () => { if (state.reply) await navigator.clipboard.writeText(state.reply); }; return <section className="rounded-xl border bg-white p-5"><h3 className="text-lg font-bold">測試旅客詢問</h3><p className="mt-1 text-sm text-slate-500">使用確定性搜尋，不需要 AI。</p><form onSubmit={search} className="mt-4 flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} maxLength={300} placeholder="10 月有日本行程嗎？" className="min-w-0 flex-1 rounded border px-3 py-2" /><button className="inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white"><Search size={16} />{state.busy ? '搜尋中…' : '測試查詢'}</button></form>{state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}{state.searched && !state.matches.length && <p className="mt-4 rounded bg-slate-50 p-4 text-sm">目前沒有符合條件且仍有效的推廣素材。</p>}{state.matches.length > 0 && <div className="mt-5 space-y-4"><h4 className="font-bold">符合條件的推廣素材</h4>{state.matches.map(match => <article key={match.safePromotionReference} className="rounded-lg border p-4"><h5 className="font-bold">{match.promotionSnapshot.title}</h5><p className="mt-1 text-xs text-slate-500">符合欄位：{match.matchedFields?.join('、') || '—'} · 關鍵字：{match.matchedKeywords?.join('、') || '—'}</p><div className="mt-3 grid gap-3 md:grid-cols-2"><Snapshot snapshot={match.promotionSnapshot} /><LiveFacts liveTravel={match.liveTravel} /></div></article>)}</div>}{state.reply && <section className="mt-5 rounded-lg border border-violet-100 bg-violet-50 p-4"><h4 className="font-bold text-violet-950">建議回覆</h4><p className="mt-2 whitespace-pre-wrap text-sm text-violet-900">{state.reply}</p><button type="button" onClick={copy} className="mt-3 inline-flex items-center gap-2 rounded border border-violet-300 px-3 py-2 text-sm font-bold"><Clipboard size={16} />複製回覆</button></section>}</section>; }

function Composer({ request, promotions, campaignEnabled, userRole, onCampaignCreated }) {
  const active = promotions.filter(item => item.status === 'ACTIVE' && item.isExpired !== true);
  const [selected, setSelected] = useState([]);
  const [format, setFormat] = useState('CAROUSEL');
  const [advanced, setAdvanced] = useState(false);
  const [headline, setHeadline] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [state, setState] = useState({ busy: '', composition: null, error: '', notice: '' });
  const automaticFormat = selected.length === 1 ? 'SINGLE' : 'CAROUSEL';
  const effectiveFormat = advanced ? format : automaticFormat;
  const valid = isTravelPromotionFormatCountValid(effectiveFormat, selected.length);
  const compositionBody = { format: effectiveFormat, safePromotionReferences: selected, options: { ...(headline.trim() ? { headline: headline.trim() } : {}), ctaLabel: '查看旅遊內容' } };
  const toggle = reference => {
    setSelected(value => value.includes(reference) ? value.filter(item => item !== reference) : [...value, reference]);
    setState(value => ({ ...value, composition: null, error: '', notice: '' }));
  };
  const preview = async () => {
    if (!valid) return;
    setState({ busy: 'preview', composition: null, error: '', notice: '' });
    try {
      const body = await requestJson(request, '/api/travel/promotions/compose', { method: 'POST', ...json(compositionBody) });
      setState({ busy: '', composition: body.composition, error: '', notice: '' });
    } catch (cause) {
      setState({ busy: '', composition: null, error: travelPromotionErrorMessage(cause.message), notice: '' });
    }
  };
  const copyPromotion = async () => {
    const text = state.composition?.fallbackText || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setState(value => ({ ...value, notice: '推廣文字已複製。', error: '' }));
    } catch {
      setState(value => ({ ...value, notice: '', error: '瀏覽器無法複製，請手動選取下方文字。' }));
    }
  };
  const sharePromotion = async () => {
    const text = state.composition?.fallbackText || '';
    if (!text) return;
    if (typeof navigator.share !== 'function') {
      await copyPromotion();
      return;
    }
    try {
      await navigator.share({ title: headline.trim() || '旅遊推廣內容', text });
      setState(value => ({ ...value, notice: '已開啟分享選單。', error: '' }));
    } catch (cause) {
      if (cause?.name !== 'AbortError') await copyPromotion();
    }
  };
  const handoff = async () => {
    if (!campaignName.trim()) {
      setState(value => ({ ...value, error: '請輸入活動名稱。' }));
      return;
    }
    if (!valid || !campaignEnabled) return;
    setState(value => ({ ...value, busy: 'campaign', error: '', notice: '' }));
    try {
      const body = await requestJson(request, '/api/campaigns', { method: 'POST', ...json({ name: campaignName.trim(), description: '由旅遊推廣素材建立', content: { contentType: 'TRAVEL_PROMOTION', composition: compositionBody } }) });
      onCampaignCreated?.(body.campaign);
    } catch (cause) {
      setState(value => ({ ...value, busy: '', error: travelPromotionErrorMessage(cause.message) }));
    }
  };
  return <section className="space-y-5" data-testid="travel-promotion-composer">
    <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-600">快速製作</p><h2 className="mt-1 text-2xl font-black">選素材，立即預覽與分享</h2><p className="mt-2 text-sm leading-6 text-slate-500">不用先理解版型規則。選 1 張自動使用單張，選 2–10 張自動使用輪播。</p><div className="mt-4 grid gap-2 sm:grid-cols-3">{['1 選擇素材','2 產生預覽','3 分享內容'].map((label, index) => <div key={label} className={`rounded-2xl px-4 py-3 text-sm font-black ${index === 0 && !state.composition ? 'bg-emerald-600 text-white' : index === 1 && selected.length > 0 && !state.composition ? 'bg-blue-50 text-blue-700' : index === 2 && state.composition ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{label}</div>)}</div></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-lg font-black">1. 點選要分享的 DM</h3><p className="mt-1 text-sm text-slate-500">目前已選 {selected.length} 張，最多 10 張。</p></div><button type="button" onClick={() => { setSelected([]); setState(value => ({ ...value, composition: null, notice: '' })); }} className="w-fit rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">清除勾選</button></div>
        {!active.length ? <p className="mt-5 rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">目前沒有可分享的使用中素材。</p> : <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">{active.map(item => { const checked = selected.includes(item.safePromotionReference); const content = item.activeVersion?.content || item.draft || {}; const asset = item.sourceAssets?.[0]; return <label key={item.safePromotionReference} className={`group relative cursor-pointer overflow-hidden rounded-2xl border bg-white transition ${checked ? 'border-emerald-500 ring-2 ring-emerald-100 shadow-sm' : 'border-slate-200 hover:border-emerald-300'} ${!checked && selected.length >= 10 ? 'pointer-events-none opacity-40' : ''}`}><input type="checkbox" checked={checked} onChange={() => toggle(item.safePromotionReference)} className="absolute right-3 top-3 z-10 h-6 w-6 rounded border-slate-300 accent-emerald-600" />{asset?.assetUrl ? <SafeAssetImage request={request} source={asset.assetUrl} alt={content.title || item.displayLabel} className="h-40 w-full bg-slate-100 object-cover" /> : <div className="flex h-40 items-center justify-center bg-slate-100 text-xs font-black text-slate-400">DM 圖片</div>}<div className="p-3">{checked && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700"><CheckCircle2 size={14} />已選取</span>}<h4 className="mt-2 line-clamp-2 min-h-10 text-sm font-black leading-5 text-slate-900">{content.title || item.displayLabel}</h4><p className="mt-2 line-clamp-2 min-h-10 text-xs font-bold leading-5 text-slate-500">{[content.destination, content.days ? `${content.days} 天` : '', content.pricingTexts?.[0]].filter(Boolean).join(' · ') || '推廣素材'}</p></div></label>; })}</div>}
      </section>
      <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start"><section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-black">2. 產生分享預覽</h3><div className="mt-4 rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-black text-emerald-600">系統建議</p><p className="mt-1 text-lg font-black text-emerald-900">{selected.length === 1 ? '單張推廣' : selected.length > 1 ? `輪播推廣 · ${selected.length} 張` : '請先選擇素材'}</p></div><label className="mt-4 block text-sm font-black text-slate-800">分享標題（選填）<input value={headline} onChange={event => setHeadline(event.target.value)} maxLength={80} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-medium outline-none focus:border-emerald-500" placeholder="例如：本月精選旅遊" /></label><button type="button" onClick={() => setAdvanced(value => !value)} className="mt-3 text-sm font-black text-slate-500 underline">{advanced ? '使用系統建議版型' : '更多版型選項'}</button>{advanced && <div className="mt-3 grid grid-cols-2 gap-2">{TRAVEL_PROMOTION_FORMATS.map(item => <button key={item.value} type="button" onClick={() => setFormat(item.value)} className={`rounded-xl border px-3 py-2 text-sm font-black ${format === item.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{item.label}</button>)}</div>}<p className={`mt-4 rounded-2xl p-3 text-sm font-bold leading-6 ${valid ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'}`}>{advanced ? travelPromotionFormatCountHint(effectiveFormat) : selected.length ? '版型已自動設定，可以直接預覽。' : '請先選擇至少 1 張素材。'}</p><button type="button" onClick={preview} disabled={!valid || Boolean(state.busy)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-base font-black text-white hover:bg-emerald-700 disabled:opacity-50"><Sparkles size={18} />{state.busy === 'preview' ? '正在建立推廣預覽…' : '預覽推廣內容'}</button></section></aside>
    </div>
    {state.error && <p role="alert" className="rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">{state.error}</p>}{state.notice && <p role="status" className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{state.notice}</p>}
    {state.composition && <section className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-600">準備完成</p><h3 className="mt-1 text-xl font-black">3. 預覽並分享</h3></div><div className="flex flex-wrap gap-2"><button type="button" onClick={sharePromotion} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white"><Share2 size={17} />分享推廣內容</button><button type="button" onClick={copyPromotion} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700"><Clipboard size={17} />複製文字</button></div></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{state.composition.preview?.items?.map(item => <article key={item.safePromotionReference} className="rounded-2xl border border-slate-200 p-4"><h4 className="font-black">{item.title}</h4><p className="mt-2 text-sm leading-6 text-slate-600">{item.summary}</p><div className="mt-4 grid gap-3"><section className="rounded-2xl bg-blue-50 p-3"><b>DM 快照</b>{item.snapshotLines?.map(line => <p key={line} className="mt-1 text-sm">{line}</p>)}</section><LiveFacts liveLines={item.liveLines} /></div></article>)}</div><h4 className="mt-5 font-black">分享文字</h4><p className="mt-2 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-7">{state.composition.fallbackText}</p></section>}
    <details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer font-black text-slate-700">需要建立行銷活動草稿？</summary><div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><div><h3 className="text-xl font-black">建立行銷活動草稿</h3><p className="mt-2 text-sm leading-7 text-slate-600">該版本的推廣內容會被固定；後續修改 DM 素材不會自動改變已建立的行銷內容。</p></div>{campaignEnabled ? <div><label className="block text-sm font-black text-slate-800">活動名稱<input value={campaignName} onChange={event => setCampaignName(event.target.value)} maxLength={120} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-medium" /></label>{canManageTravelPromotions(userRole) && <button type="button" onClick={handoff} disabled={!valid || Boolean(state.busy)} className="mt-3 w-full rounded-2xl bg-blue-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{state.busy === 'campaign' ? '正在建立行銷活動草稿…' : '建立行銷活動草稿'}</button>}</div> : <p className="rounded-2xl bg-amber-50 p-4 text-sm leading-7 text-amber-900">此工作區尚未啟用行銷活動模組。推廣預覽仍可使用。</p>}</div></details>
  </section>;
}

export default function TravelPromotionWorkspace({ request, userRole = 'viewer', travelEnabled = true, campaignEnabled = false, aiEnabled = false, onCampaignCreated }) {
  const authority = travelPromotionUiAuthority({ travelEnabled, campaignEnabled });
  const canManage = canManageTravelPromotions(userRole);
  const [view, setView] = useState('library');
  const [state, setState] = useState({ loading: true, items: [], selected: null, error: '' });
  const [filters, setFilters] = useState({ search: '', status: 'ALL', destination: 'ALL', expiry: 'ALL' });
  const load = useCallback(async () => {
    setState(value => ({ ...value, loading: true, error: '' }));
    try {
      const body = await requestJson(request, '/api/travel/promotions');
      setState(value => ({ ...value, loading: false, items: body.promotions || [] }));
    } catch (cause) {
      setState(value => ({ ...value, loading: false, error: travelPromotionErrorMessage(cause.message) }));
    }
  }, [request]);
  useEffect(() => { if (authority.travelAvailable) load(); }, [authority.travelAvailable, load]);
  const open = async reference => {
    try {
      const body = await requestJson(request, `/api/travel/promotions/${encodeURIComponent(reference)}`);
      setState(value => ({ ...value, selected: body.promotion, error: '' }));
    } catch (cause) {
      setState(value => ({ ...value, error: travelPromotionErrorMessage(cause.message) }));
    }
  };
  const changed = async (promotion, refresh = false) => {
    if (refresh) return open(promotion.safePromotionReference);
    setState(value => ({ ...value, selected: promotion }));
    await load();
  };
  const filtered = useMemo(() => state.items.filter(item => {
    const draft = item.activeVersion?.content || item.draft || {};
    const search = filters.search.trim().toLowerCase();
    return (!search || `${item.displayLabel} ${draft.title || ''} ${draft.destination || ''}`.toLowerCase().includes(search))
      && (filters.status === 'ALL' || item.status === filters.status)
      && (filters.destination === 'ALL' || draft.destination === filters.destination)
      && (filters.expiry === 'ALL' || (filters.expiry === 'EXPIRED') === Boolean(item.isExpired));
  }), [filters, state.items]);
  const destinations = [...new Set(state.items.map(item => (item.activeVersion?.content || item.draft)?.destination).filter(Boolean))].sort();
  if (!authority.travelAvailable) return <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">此工作區尚未啟用此功能模組。</p>;
  if (state.selected) return <Review request={request} promotion={state.selected} userRole={userRole} aiEnabled={aiEnabled} onChanged={changed} onClose={() => setState(value => ({ ...value, selected: null }))} />;
  return <section className="space-y-5" data-testid="travel-promotion-workspace">
    <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-sm md:flex-row md:items-start md:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">Promotion Workspace</p><h1 className="mt-2 text-3xl font-black">推廣素材工作台</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">集中處理 DM 圖片、AI 結構化、人工核對與推廣內容。推廣素材與正式行程維持不同資料權限。</p></div>
      {canManage && <button type="button" onClick={() => setView('create')} className="inline-flex w-fit items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-slate-950 shadow-sm hover:bg-emerald-400"><Plus size={17} />新增 DM</button>}
    </header>
    <nav aria-label="推廣素材功能" className="flex flex-wrap gap-2">{[['library','素材庫'],['create','新增 DM'],['compose','製作推廣內容']].map(([id,label]) => <button key={id} type="button" onClick={() => setView(id)} disabled={id === 'create' && !canManage} className={`rounded-2xl px-4 py-2.5 text-sm font-black ${view === id ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-700'} disabled:opacity-40`}>{label}</button>)}</nav>
    {view === 'create' && canManage && <CreateDm request={request} aiEnabled={aiEnabled} onCreated={promotion => { setState(value => ({ ...value, selected: promotion })); load(); }} />}
    {view === 'compose' && <Composer request={request} promotions={state.items} campaignEnabled={authority.campaignHandoffAvailable} userRole={userRole} onCampaignCreated={onCampaignCreated} />}
    {view === 'library' && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">DM Library</p><h2 className="mt-1 text-2xl font-black">推廣素材池</h2><p className="mt-2 text-sm leading-6 text-slate-500">用圖片卡片快速辨識素材，點入後可人工校正、重新解析、核准或封存。</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-600">{filtered.length} 筆</span><button type="button" onClick={load} className="rounded-2xl border border-slate-200 bg-white p-3" aria-label="重新載入推廣素材"><RefreshCw size={17} /></button></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-4"><input aria-label="搜尋推廣素材" value={filters.search} onChange={event => setFilters(value => ({ ...value, search: event.target.value }))} placeholder="搜尋標題或目的地" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" /><select aria-label="狀態篩選" value={filters.status} onChange={event => setFilters(value => ({ ...value, status: event.target.value }))} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"><option value="ALL">全部狀態</option><option value="DRAFT">草稿</option><option value="ACTIVE">使用中</option><option value="ARCHIVED">已封存</option></select><select aria-label="目的地篩選" value={filters.destination} onChange={event => setFilters(value => ({ ...value, destination: event.target.value }))} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"><option value="ALL">全部目的地</option>{destinations.map(value => <option key={value} value={value}>{value}</option>)}</select><select aria-label="有效期篩選" value={filters.expiry} onChange={event => setFilters(value => ({ ...value, expiry: event.target.value }))} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"><option value="ALL">全部有效期</option><option value="CURRENT">仍有效</option><option value="EXPIRED">已過期</option></select></div>
          {state.error && <p role="alert" className="mt-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
          {state.loading ? <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" />正在載入推廣素材…</p> : !filtered.length ? <p className="mt-5 rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">目前沒有推廣素材。</p> : <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{filtered.map(item => {
            const content = item.activeVersion?.content || item.draft || {};
            const asset = item.sourceAssets?.[0];
            return <article key={item.safePromotionReference} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
              <button type="button" onClick={() => open(item.safePromotionReference)} className="block w-full text-left">{asset?.assetUrl ? <SafeAssetImage request={request} source={asset.assetUrl} alt={content.title || item.displayLabel} className="h-44 w-full bg-slate-100 object-cover" /> : <div className="flex h-44 items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-sm font-black text-slate-400">DM 圖片</div>}<div className="p-4"><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${item.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : item.status === 'ARCHIVED' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'}`}>{travelPromotionStatusLabel(item)}</span><span className="text-xs font-bold text-slate-400">{formatPromotionDate(item.updatedAt)}</span></div><h3 className="mt-3 line-clamp-2 min-h-12 text-base font-black text-slate-900">{content.title || item.displayLabel}</h3><p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-slate-500">{[content.destination, content.days ? `${content.days} 天` : '', content.pricingTexts?.[0]].filter(Boolean).join(' · ') || '尚待人工補充素材資訊'}</p><p className="mt-3 text-xs font-bold text-slate-400">有效期限：{formatPromotionDate(item.expiresAt)} · 正式行程連結</p></div></button>
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><button type="button" onClick={() => open(item.safePromotionReference)} className="text-sm font-black text-blue-700">查看素材確認</button>{canManage && item.status !== 'ARCHIVED' ? <button type="button" onClick={() => open(item.safePromotionReference)} className="text-sm font-black text-emerald-700">重算／封存</button> : '—'}</div>
            </article>;
          })}</div>}
        </section>
        <Retrieval request={request} />
      </div>
      <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start"><section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black">兩種資料不要混用</h2><div className="mt-4 space-y-3 text-sm leading-7 text-slate-600"><p><b>推廣素材：</b>保存 DM 圖片、OCR 與已審核的客服內容。</p><p><b>正式行程：</b>管理出發日、名額、價格與可報名狀態，仍由 Travel 後端提供即時權威資料。</p></div></section><section className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><h2 className="text-lg font-black text-amber-900">使用原則</h2><ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-amber-800"><li>AI 會先判斷名片或旅遊海報，再選擇解析模型。</li><li>圖片文字不清楚時，解析後仍需人工核對。</li><li>DM 不會自動承諾價格、名額或建立正式行程。</li><li>不提供直接 LINE 發送或技術格式編輯。</li></ul></section></aside>
    </div>}
  </section>;
}
