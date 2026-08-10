import React, { useCallback, useEffect, useMemo, useState } from 'react';

const editableRoles = new Set(['owner', 'admin', 'editor']);
const tagCreatorRoles = new Set(['owner', 'admin']);
const zodiacLabels = {
  ARIES: '牡羊座', TAURUS: '金牛座', GEMINI: '雙子座', CANCER: '巨蟹座',
  LEO: '獅子座', VIRGO: '處女座', LIBRA: '天秤座', SCORPIO: '天蠍座',
  SAGITTARIUS: '射手座', CAPRICORN: '摩羯座', AQUARIUS: '水瓶座', PISCES: '雙魚座',
};
const dimensionLabels = {
  PERSONALITY: '人格特質', INTERESTS: '興趣偏好', WEALTH: '財務偏好', HEALTH: '健康關注', CAREER: '職涯發展',
};
const insightStatusLabels = {
  DRAFT: '草稿', GENERATED: '已產生', REVIEWED: '已審閱', SUPERSEDED: '已取代', REJECTED: '已拒絕',
};
const sourceLabels = { CRM_MANUAL: 'CRM 手動管理', SYSTEM_RULE: '系統規則', AI_SUGGESTED: 'AI 建議' };

const api = async (request, path, options) => {
  const response = await request(path, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error || 'REQUEST_FAILED');
  return payload;
};

const formatTime = (value) => value ? new Date(value).toLocaleString('zh-TW') : '—';
const safeDimension = (value) => dimensionLabels[String(value || '').toUpperCase()] || value || '未分類';

export default function CrmInsightsTraitsPanel({ request, personReference, userRole = 'viewer' }) {
  const role = String(userRole).toLowerCase();
  const canManageTags = editableRoles.has(role);
  const canCreateTags = tagCreatorRoles.has(role);
  const [tags, setTags] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [insights, setInsights] = useState([]);
  const [traits, setTraits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tagReference, setTagReference] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagDescription, setTagDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    if (!personReference) return;
    setLoading(true);
    try {
      const encoded = encodeURIComponent(personReference);
      const [personTags, tagCatalog, personInsights, personTraits] = await Promise.all([
        api(request, '/api/crm/people/' + encoded + '/tags'),
        api(request, '/api/crm/tags'),
        api(request, '/api/crm/people/' + encoded + '/insights'),
        api(request, '/api/crm/people/' + encoded + '/traits'),
      ]);
      setTags(personTags.tags || []);
      setCatalog((tagCatalog.tags || []).filter((tag) => tag.status === 'ACTIVE'));
      setInsights(personInsights.insights || []);
      setTraits(personTraits.traits || []);
      setError('');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }, [personReference, request]);

  useEffect(() => { void load(); }, [load]);

  const assignTag = async () => {
    if (!tagReference || !canManageTags) return;
    setBusy(true);
    try {
      await api(request, '/api/crm/people/' + encodeURIComponent(personReference) + '/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ safeTagReference: tagReference }),
      });
      setTagReference('');
      await load();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };

  const removeTag = async (reference) => {
    if (!canManageTags) return;
    setBusy(true);
    try {
      await api(request, '/api/crm/people/' + encodeURIComponent(personReference) + '/tags/' + encodeURIComponent(reference) + '/remove', { method: 'POST' });
      await load();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };

  const createTag = async () => {
    if (!canCreateTags || !tagName.trim()) return;
    setBusy(true);
    try {
      const result = await api(request, '/api/crm/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tagName, description: tagDescription }),
      });
      setTagName(''); setTagDescription('');
      if (result.tag?.tagReference) setTagReference(result.tag.tagReference);
      await load();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };

  const currentInsights = useMemo(() => showHistory ? insights : insights.filter((item, index, all) => item.status !== 'SUPERSEDED' && all.findIndex((other) => other.dimension === item.dimension && other.status !== 'SUPERSEDED') === index), [insights, showHistory]);
  const zodiac = traits.find((trait) => trait.traitType === 'ZODIAC' && !trait.supersededAt);

  return (
    <section data-testid="crm-insights-traits" className="space-y-5 rounded border p-4">
      <div>
        <h3 className="font-semibold">洞察與特質</h3>
        <p className="mt-1 text-xs text-gray-500">此區塊僅供 CRM 互動理解，不作為資格、金融、佣金、點數或付款決策依據。</p>
      </div>
      {loading && <p className="text-sm text-gray-500">載入 CRM 標籤、洞察與特質中…</p>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">無法載入洞察資訊：{error}</p>}
      {!loading && <>
        <section>
          <h4 className="font-medium">CRM 標籤</h4>
          {tags.length ? <div className="mt-2 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag.tagReference} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">{tag.name}{tag.sourceType ? <small className="ml-1 text-slate-500">{sourceLabels[tag.sourceType] || tag.sourceType}</small> : null}{canManageTags && <button type="button" aria-label={'移除標籤 ' + tag.name} disabled={busy} onClick={() => removeTag(tag.tagReference)} className="ml-2 text-slate-500 hover:text-red-700">×</button>}</span>)}</div> : <p className="mt-2 text-sm text-gray-500">目前尚未為此客戶加入 CRM 標籤。</p>}
          {canManageTags ? <div className="mt-3 flex flex-wrap gap-2"><select aria-label="指派 CRM 標籤" value={tagReference} onChange={(event) => setTagReference(event.target.value)} className="rounded border px-3 py-2 text-sm"><option value="">選擇既有標籤</option>{catalog.map((tag) => <option key={tag.tagReference} value={tag.tagReference}>{tag.name}</option>)}</select><button type="button" disabled={!tagReference || busy} onClick={assignTag} className="rounded border px-3 py-2 text-sm">加入標籤</button></div> : <p className="mt-2 text-xs text-gray-500">您目前只有閱讀權限。</p>}
          {canCreateTags && <div className="mt-3 grid gap-2 md:grid-cols-3"><input aria-label="新 CRM 標籤名稱" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="新增 CRM 標籤" className="rounded border px-3 py-2 text-sm" /><input aria-label="CRM 標籤說明" value={tagDescription} onChange={(event) => setTagDescription(event.target.value)} placeholder="說明（選填）" className="rounded border px-3 py-2 text-sm" /><button type="button" disabled={!tagName.trim() || busy} onClick={createTag} className="rounded bg-slate-800 px-3 py-2 text-sm text-white">建立標籤</button></div>}
        </section>
        <section>
          <div className="flex items-center justify-between gap-3"><h4 className="font-medium">五項洞察</h4>{insights.length > 1 && <button type="button" onClick={() => setShowHistory((current) => !current)} className="text-sm text-slate-700 underline">{showHistory ? '顯示目前版本' : '顯示版本歷程'}</button>}</div>
          {currentInsights.length ? <div className="mt-2 grid gap-3 md:grid-cols-2">{currentInsights.map((insight, index) => <article key={insight.dimension + ':' + insight.version + ':' + index} className="rounded border p-3"><div className="flex justify-between gap-2"><strong>{safeDimension(insight.dimension)}</strong><span className="text-xs text-gray-500">{insightStatusLabels[insight.status] || insight.status || '—'}</span></div><p className="mt-1 text-sm">{insight.label || '—'}</p>{insight.summary && <p className="mt-1 text-sm text-gray-600">{insight.summary}</p>}<p className="mt-2 text-xs text-gray-500">版本：{insight.version || '—'}　來源：{sourceLabels[insight.sourceType] || insight.sourceType || '—'}　時間：{formatTime(insight.generatedAt)}</p>{insight.score !== null && insight.score !== undefined && <p className="mt-1 text-xs text-gray-500">分數：{insight.score}</p>}{insight.reviewedAt && <p className="mt-1 text-xs text-gray-500">審閱：{formatTime(insight.reviewedAt)}</p>}</article>)}</div> : <p className="mt-2 text-sm text-gray-500">目前尚無已記錄的洞察資料。</p>}
          <p className="mt-2 text-xs text-gray-500">目前未提供 AI 產生或重新產生功能。</p>
        </section>
        <section>
          <h4 className="font-medium">個人特質</h4>
          {zodiac ? <article className="mt-2 rounded border p-3"><strong>星座：{zodiacLabels[zodiac.traitValue] || zodiac.traitValue}</strong><p className="mt-1 text-xs text-gray-500">版本：{zodiac.derivationVersion || '—'}　推導時間：{formatTime(zodiac.generatedAt)}</p></article> : <p className="mt-2 text-sm text-gray-500">尚無星座特質資料；生日資料不足或尚未由後端完成推導。</p>}
          <div className="mt-2 grid gap-2 md:grid-cols-2"><p className="rounded bg-gray-50 p-3 text-sm text-gray-500">生肖：尚未提供</p><p className="rounded bg-gray-50 p-3 text-sm text-gray-500">生命靈數：尚未提供</p></div>
          <p className="mt-2 text-xs text-gray-500">個人特質僅供互動理解，不作為資格或任何商業決策依據。</p>
        </section>
      </>}
    </section>
  );
}
