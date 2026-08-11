import React, { useCallback, useEffect, useState } from 'react';

const requestJson = async (request, path) => {
  const response = await request(path);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error('CAMPAIGN_CLICK_READ_FAILED');
  return payload;
};

const number = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW') : '0';
const formatTime = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};

const visitorLabel = (kind) => {
  if (kind === 'ANONYMOUS') return '匿名訪客';
  if (kind === 'KNOWN_CRM_PERSON') return '已識別 CRM 聯絡人';
  if (kind === 'KNOWN_MEMBER') return '已識別會員';
  return '未知訪客';
};

export default function CampaignClickEngagementPanel({ campaign, request }) {
  const campaignReference = campaign?.safeCampaignReference || '';
  const [summary, setSummary] = useState(null);
  const [clicks, setClicks] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadAnalytics = useCallback(async () => {
    if (!campaignReference) return;
    setLoading(true);
    setError('');
    try {
      const base = `/api/campaigns/${encodeURIComponent(campaignReference)}/clicks`;
      const [summaryPayload, listPayload] = await Promise.all([
        requestJson(request, `${base}/summary`),
        requestJson(request, `${base}?limit=25`),
      ]);
      setSummary(summaryPayload.summary || null);
      setClicks(Array.isArray(listPayload.clicks) ? listPayload.clicks : []);
      setNextCursor(typeof listPayload.nextCursor === 'string' ? listPayload.nextCursor : null);
    } catch {
      setSummary(null);
      setClicks([]);
      setNextCursor(null);
      setError('目前無法載入點擊互動資料，請稍後再試。');
    } finally {
      setLoading(false);
    }
  }, [campaignReference, request]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const loadMore = async () => {
    if (!campaignReference || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const payload = await requestJson(
        request,
        `/api/campaigns/${encodeURIComponent(campaignReference)}/clicks?limit=25&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setClicks((current) => [...current, ...(Array.isArray(payload.clicks) ? payload.clicks : [])]);
      setNextCursor(typeof payload.nextCursor === 'string' ? payload.nextCursor : null);
    } catch {
      setError('目前無法載入點擊互動資料，請稍後再試。');
    } finally {
      setLoadingMore(false);
    }
  };

  const noClicks = !loading && !error && Number(summary?.totalClicks || 0) === 0 && clicks.length === 0;

  return (
    <section className="rounded-xl border bg-white p-5" data-testid="campaign-click-engagement-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">點擊互動</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            點擊互動代表收件者曾點選活動連結；這是互動證據，不代表名單取得、成交、推薦、獎勵或佣金結果。
          </p>
        </div>
        <button type="button" onClick={loadAnalytics} disabled={loading || loadingMore} className="rounded border px-4 py-2 text-sm font-medium text-blue-700 disabled:opacity-50">
          重新整理
        </button>
      </div>

      {loading && <p className="mt-4 text-sm text-gray-500">載入點擊互動資料中…</p>}
      {error && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {noClicks && (
        <div className="mt-4 rounded border bg-slate-50 p-4 text-sm text-gray-600">
          <p className="font-medium text-gray-800">目前尚無點擊互動紀錄。</p>
          <p className="mt-1">活動連結被點選後，安全的互動統計會顯示於此。</p>
        </div>
      )}

      {!loading && !error && summary && Number(summary.totalClicks || 0) > 0 && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="campaign-click-summary">
            <div className="rounded border p-3"><span className="text-xs text-gray-500">總點擊次數</span><strong className="mt-1 block text-xl">{number(summary.totalClicks)}</strong></div>
            <div className="rounded border p-3"><span className="text-xs text-gray-500">已識別聯絡人數</span><strong className="mt-1 block text-xl">{number(summary.uniqueKnownPeople)}</strong></div>
            <div className="rounded border p-3"><span className="text-xs text-gray-500">匿名點擊次數</span><strong className="mt-1 block text-xl">{number(summary.anonymousClicks)}</strong></div>
            <div className="rounded border p-3"><span className="text-xs text-gray-500">首次點擊時間</span><strong className="mt-1 block text-sm">{formatTime(summary.firstClickedAt)}</strong></div>
            <div className="rounded border p-3"><span className="text-xs text-gray-500">最近點擊時間</span><strong className="mt-1 block text-sm">{formatTime(summary.latestClickedAt)}</strong></div>
          </div>

          <div className="mt-6" data-testid="campaign-click-link-summary">
            <h3 className="font-semibold text-gray-900">各連結互動</h3>
            <div className="mt-3 overflow-x-auto rounded border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-gray-500"><tr><th className="px-3 py-2">連結名稱</th><th className="px-3 py-2">目的網域</th><th className="px-3 py-2">點擊次數</th></tr></thead>
                <tbody className="divide-y">
                  {(summary.clicksByTrackedLink || []).map((link, index) => (
                    <tr key={`${link.trackedLinkLabel}-${link.destinationHost}-${index}`}>
                      <td className="px-3 py-2 font-medium text-gray-800">{link.trackedLinkLabel || '未命名連結'}</td>
                      <td className="px-3 py-2 text-gray-600">{link.destinationHost || '—'}</td>
                      <td className="px-3 py-2">{number(link.totalClicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6" data-testid="campaign-click-event-list">
            <h3 className="font-semibold text-gray-900">點擊紀錄</h3>
            {clicks.length === 0 ? <p className="mt-3 text-sm text-gray-500">目前尚無點擊互動紀錄。</p> : (
              <div className="mt-3 overflow-x-auto rounded border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-gray-500"><tr><th className="px-3 py-2">點擊時間</th><th className="px-3 py-2">連結名稱</th><th className="px-3 py-2">訪客類型</th><th className="px-3 py-2">聯絡人</th><th className="px-3 py-2">目的網域</th></tr></thead>
                  <tbody className="divide-y">
                    {clicks.map((click, index) => (
                      <tr key={`${click.occurredAt}-${click.trackedLinkLabel}-${index}`}>
                        <td className="whitespace-nowrap px-3 py-2">{formatTime(click.occurredAt)}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">{click.trackedLinkLabel || '未命名連結'}</td>
                        <td className="px-3 py-2">{visitorLabel(click.visitorKind)}</td>
                        <td className="px-3 py-2">{click.visitorKind === 'ANONYMOUS' ? '無法識別' : click.safePersonLabel || '已識別聯絡人'}</td>
                        <td className="px-3 py-2 text-gray-600">{click.destinationHost || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {nextCursor && <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-4 rounded border px-4 py-2 text-sm font-medium text-blue-700 disabled:opacity-50">{loadingMore ? '載入更多中…' : '載入更多'}</button>}
          </div>
        </>
      )}
    </section>
  );
}
