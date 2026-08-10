import React, { useCallback, useEffect, useState } from 'react';

const sourceLabel = { PROFILE: '個人檔案', ACQUISITION: '取得來源', REFERRAL: '推薦關係', IMPORT: '匯入', CARD: '名片', CRM: 'CRM', INSIGHT: '洞察', ECONOMY: '點數／貢獻／佣金' };
const eventLabel = {
  PROFILE_UPDATED: '個人檔案已更新', ACQUISITION_RECORDED: '已記錄取得來源', REFERRAL_ATTRIBUTED: '已記錄推薦關係', IMPORT_CREATED_PERSON: '匯入建立客戶', IMPORT_LINKED_PERSON: '匯入連結既有客戶',
  PERSONAL_CARD_CREATED: '已建立個人卡片', PERSONAL_CARD_VERSION_CREATED: '個人卡片已更新', BUSINESS_CARD_LINKED: '已連結商務名片', CARD_COLLECTED: '已收藏名片', CARD_SHARED: '已分享個人卡片',
  TAG_ASSIGNED: '已新增 CRM 標籤', TAG_REMOVED: '已移除 CRM 標籤', INSIGHT_RECORDED: '洞察已記錄', TRAIT_DERIVED: '特質已產生', STAGE_CHANGED: 'CRM 階段已變更', OWNER_ASSIGNED: 'CRM 負責人已指派',
  FOLLOW_UP_CREATED: '已建立跟進事項', FOLLOW_UP_COMPLETED: '跟進事項已完成', FOLLOW_UP_CANCELLED: '跟進事項已取消', POINTS_CREDITED: '點數已增加', POINTS_DEBITED: '點數已扣除',
  REWARD_REDEEMED: '已兌換獎勵', CONTRIBUTION_RECORDED: '貢獻已記錄', TIER_QUALIFIED: '已符合層級', COMMISSION_EARNED: '已賺取佣金', SETTLEMENT_FINALIZED: '結算已完成', PAYOUT_REQUESTED: '已提出請款', PAYMENT_SIMULATED_SUCCEEDED: '模擬付款已成功',
};
const safeDate = (value) => value ? new Date(value).toLocaleString('zh-TW') : '—';
const money = (value, currency) => currency === 'TWD' ? `NT$${Number(value || 0).toLocaleString('zh-TW')}` : `${Number(value || 0).toLocaleString('zh-TW')} ${currency || ''}`.trim();
const api = async (request, path) => { const response = await request(path); const payload = await response.json(); if (!response.ok || !payload.success) throw new Error(payload.error || 'REQUEST_FAILED'); return payload; };

function Metadata({ item }) {
  const metadata = item.metadata || {};
  if (item.eventType === 'STAGE_CHANGED') return metadata.fromStageLabel || metadata.toStageLabel ? <p className="mt-1 text-xs text-gray-500">{metadata.fromStageLabel || '—'} → {metadata.toStageLabel || '—'}</p> : null;
  if (item.eventType === 'COMMISSION_EARNED') return <p className="mt-1 text-xs text-gray-500">{money(metadata.amountMinor, metadata.currencyCode)}</p>;
  if (item.eventType === 'POINTS_CREDITED' || item.eventType === 'POINTS_DEBITED') return <p className="mt-1 text-xs text-gray-500">{Number(metadata.delta || 0) > 0 ? '+' : ''}{Number(metadata.delta || 0)} 點</p>;
  if (item.eventType === 'CONTRIBUTION_RECORDED') return <p className="mt-1 text-xs text-gray-500">+{Number(metadata.scoreDelta || 0)} 貢獻分</p>;
  if (item.eventType === 'REWARD_REDEEMED') return <p className="mt-1 text-xs text-gray-500">{Number(metadata.pointsCost || 0)} 點／{metadata.status || '—'}</p>;
  if (item.eventType.startsWith('FOLLOW_UP_')) return <p className="mt-1 text-xs text-gray-500">{metadata.status || '—'}{metadata.dueAt ? `／到期：${safeDate(metadata.dueAt)}` : ''}</p>;
  return null;
}

export default function CrmTimelinePanel({ request, personReference }) {
  const [items, setItems] = useState([]), [nextCursor, setNextCursor] = useState(null), [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false), [error, setError] = useState('');
  const load = useCallback(async (cursor = null) => {
    if (!personReference) return; if (cursor) setLoadingMore(true); else setLoading(true);
    try { const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''; const result = await api(request, `/api/crm/people/${encodeURIComponent(personReference)}/timeline?limit=25${suffix}`); setItems((current) => cursor ? [...current, ...(result.items || [])] : (result.items || [])); setNextCursor(result.nextCursor || null); setError(''); } catch (cause) { setError(cause.message); } finally { if (cursor) setLoadingMore(false); else setLoading(false); }
  }, [request, personReference]);
  useEffect(() => { setItems([]); setNextCursor(null); setError(''); void load(); }, [load]);
  return <section data-testid="crm-timeline" className="rounded border p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">客戶活動時間線</h3><p className="mt-1 text-xs text-gray-500">僅顯示安全的客戶活動紀錄；此處不能變更任何資料。</p></div></div>{loading && <p className="mt-3 text-sm text-gray-500">載入活動紀錄中…</p>}{error && <p role="alert" className="mt-3 text-sm text-red-700">活動紀錄載入失敗：{error}</p>}{!loading && !error && !items.length && <p className="mt-3 rounded border bg-gray-50 p-4 text-sm text-gray-500">目前尚無可顯示的客戶活動紀錄。</p>}{!loading && !error && items.length > 0 && <ol className="mt-4 space-y-3 border-l pl-4">{items.map((item, index) => <li key={`${item.eventType}-${item.occurredAt}-${index}`} className="relative"><span className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-slate-400" /><div className="rounded bg-gray-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{eventLabel[item.eventType] || item.title || '客戶活動'}</p><span className="rounded bg-white px-2 py-0.5 text-xs text-gray-600">{sourceLabel[item.sourceDomain] || '其他活動'}</span></div><p className="mt-1 text-xs text-gray-500">{safeDate(item.occurredAt)}</p>{item.summary && <p className="mt-2 text-sm text-gray-700">{item.eventType === 'PROFILE_UPDATED' ? '個人檔案欄位已安全更新。' : item.summary}</p>}<Metadata item={item} />{item.eventType === 'PAYMENT_SIMULATED_SUCCEEDED' && <p className="mt-2 text-xs text-amber-800">此為模擬付款結果，並非真實付款。</p>}</div></li>)}</ol>}{nextCursor && !error && <button type="button" disabled={loadingMore} onClick={() => load(nextCursor)} className="mt-4 rounded border px-3 py-2 text-sm disabled:opacity-50">{loadingMore ? '載入中…' : '載入更多活動'}</button>}</section>;
}
