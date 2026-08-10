import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const exclusionLabels = {
  PERSON_ARCHIVED: '客戶已封存',
  DO_NOT_CONTACT: '已設定不聯絡',
  NOT_CONTACTABLE: '目前不可聯絡',
  MARKETING_CONSENT_MISSING: '尚未取得行銷同意',
  NO_VERIFIED_LINE_IDENTITY: '尚未連結已驗證 LINE 身分',
};

const requestJson = async (request, path, options) => {
  const response = await request(path, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error || 'REQUEST_FAILED');
  return payload;
};

const errorLabel = (code) => {
  const labels = {
    CAMPAIGN_SEGMENT_REQUIRED: '請先選擇客群分群。',
    CAMPAIGN_AUDIENCE_SEGMENT_NOT_FOUND: '找不到可用的客群分群。',
    CAMPAIGN_NOT_DRAFT: '此活動目前無法變更。',
    CAMPAIGN_REPREPARE_UNSUPPORTED: '已準備的活動不可再次準備，請建立新的活動。',
    FORBIDDEN: '目前角色沒有執行此操作的權限。',
  };
  return labels[code] || '操作失敗，請稍後再試。';
};

const formatTime = (value) => value
  ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

const CountCards = ({ summary }) => (
  <div className="grid gap-3 sm:grid-cols-3">
    {[
      ['候選人數', summary?.totalCandidates ?? 0],
      ['可發送人數', summary?.eligibleCount ?? 0],
      ['排除人數', summary?.excludedCount ?? 0],
    ].map(([label, value]) => (
      <div key={label} className="rounded-lg border bg-slate-50 p-3">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="mt-1 text-xl font-bold text-gray-900">{value}</div>
      </div>
    ))}
  </div>
);

const Breakdown = ({ items = [] }) => (
  <div className="mt-4">
    <h4 className="text-sm font-semibold text-gray-800">排除原因</h4>
    {items.length ? (
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.reason} className="flex justify-between rounded border px-3 py-2 text-sm">
            <span>{exclusionLabels[item.reason] || '其他排除原因'}</span>
            <strong>{item.count}</strong>
          </li>
        ))}
      </ul>
    ) : <p className="mt-2 text-sm text-gray-500">目前沒有排除原因。</p>}
  </div>
);

export default function CampaignAudiencePanel({
  campaign,
  request,
  segments = [],
  selectedSegmentReference,
  onSegmentChange,
  canManage,
  onPrepared,
}) {
  const isDraft = campaign?.status === 'DRAFT';
  const campaignReference = campaign?.safeCampaignReference || '';
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [audience, setAudience] = useState(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const prepareReference = useRef('');

  const activeSegments = useMemo(
    () => segments.filter((segment) => segment.status === 'ACTIVE'),
    [segments],
  );
  const preparedSegment = useMemo(
    () => segments.find((segment) => segment.safeSegmentReference === campaign?.prepared?.safeSegmentReference),
    [campaign?.prepared?.safeSegmentReference, segments],
  );

  const loadAudience = useCallback(async () => {
    if (!campaignReference) return;
    setAudienceLoading(true);
    setAudienceError('');
    try {
      const payload = await requestJson(
        request,
        `/api/campaigns/${encodeURIComponent(campaignReference)}/audience`,
      );
      setAudience(payload.audience || null);
    } catch (cause) {
      setAudience(null);
      setAudienceError(errorLabel(cause.message));
    } finally {
      setAudienceLoading(false);
    }
  }, [campaignReference, request]);

  useEffect(() => {
    setPreview(null);
    setPreviewError('');
    prepareReference.current = '';
    void loadAudience();
  }, [loadAudience]);

  const runPreview = async () => {
    if (!selectedSegmentReference) {
      setPreview(null);
      setPreviewError('請先選擇客群分群。');
      return;
    }
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const payload = await requestJson(
        request,
        `/api/campaigns/${encodeURIComponent(campaignReference)}/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ safeSegmentReference: selectedSegmentReference }),
        },
      );
      setPreview(payload.preview || null);
    } catch (cause) {
      setPreview(null);
      setPreviewError(errorLabel(cause.message));
    } finally {
      setPreviewLoading(false);
    }
  };

  const prepareAudience = async () => {
    if (!canManage || !isDraft || !selectedSegmentReference || preparing) return;
    const confirmed = globalThis.confirm?.('準備後會凍結此次內容版本與受眾快照。後續 CRM 或分群資料變更不會改寫此次準備結果。');
    if (!confirmed) return;
    if (!prepareReference.current) prepareReference.current = `campaign-ui:${crypto.randomUUID()}`;
    setPreparing(true);
    setPreviewError('');
    try {
      const payload = await requestJson(
        request,
        `/api/campaigns/${encodeURIComponent(campaignReference)}/prepare`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            safeSegmentReference: selectedSegmentReference,
            actionReference: prepareReference.current,
          }),
        },
      );
      setAudience(payload.prepared || null);
      await onPrepared?.(payload.prepared);
    } catch (cause) {
      setPreviewError(errorLabel(cause.message));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5" data-testid="campaign-segment-source">
        <h3 className="text-lg font-bold text-gray-900">客群來源</h3>
        {isDraft ? (
          <>
            <label className="mt-3 block text-sm font-medium text-gray-700">
              客群分群
              <select
                aria-label="客群分群"
                value={selectedSegmentReference}
                onChange={(event) => {
                  onSegmentChange(event.target.value);
                  setPreview(null);
                  setPreviewError('');
                }}
                disabled={!canManage}
                className="mt-1 block w-full rounded border px-3 py-2 disabled:bg-gray-100"
              >
                <option value="">尚未選擇客群</option>
                {activeSegments.map((segment) => (
                  <option key={segment.safeSegmentReference} value={segment.safeSegmentReference}>
                    {segment.name}（版本 v{segment.currentVersion}）
                  </option>
                ))}
              </select>
            </label>
            {selectedSegmentReference && (
              <p className="mt-2 text-sm text-gray-500">
                {activeSegments.find((segment) => segment.safeSegmentReference === selectedSegmentReference)?.description || '此客群分群未提供說明。'}
              </p>
            )}
          </>
        ) : (
          <div className="mt-3 rounded border bg-slate-50 p-3 text-sm">
            <div className="font-medium">{preparedSegment?.name || '已準備的客群分群'}</div>
            <div className="mt-1 text-gray-500">分群版本 v{campaign?.prepared?.segmentVersion || audience?.segmentVersion || '—'}</div>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5" data-testid="campaign-live-preview">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">即時預覽</h3>
            <p className="mt-1 text-sm text-gray-600">預覽依目前 CRM 資料即時計算。</p>
            <p className="mt-1 text-xs text-gray-500">預覽不會建立受眾快照。</p>
          </div>
          {isDraft && canManage && (
            <button type="button" onClick={runPreview} disabled={!selectedSegmentReference || previewLoading} className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">
              {previewLoading ? '預覽載入中…' : '預覽目前受眾'}
            </button>
          )}
        </div>

        {!isDraft && <p className="mt-4 rounded border bg-gray-50 p-3 text-sm text-gray-600">此活動已離開草稿狀態，即時預覽不再提供變更操作。</p>}
        {isDraft && !selectedSegmentReference && <p className="mt-4 text-sm text-gray-500">尚未選擇客群。</p>}
        {previewLoading && <p className="mt-4 text-sm text-gray-500">正在計算目前客群…</p>}
        {previewError && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{previewError}</p>}
        {!previewLoading && preview && (
          <div className="mt-4 space-y-4">
            <CountCards summary={preview} />
            <Breakdown items={preview.exclusionBreakdown} />
            <div>
              <h4 className="text-sm font-semibold text-gray-800">預覽名單（最多 {preview.maxPreview || 25} 人）</h4>
              {preview.previewPeople?.length ? (
                <div className="mt-2 divide-y rounded border">
                  {preview.previewPeople.map((person, index) => (
                    <div key={`${person.displayName || '客戶'}-${index}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <div>
                        <div className="font-medium">{person.displayName || '未命名客戶'}</div>
                        <div className="text-xs text-gray-500">{person.companyName || '未提供公司'}</div>
                      </div>
                      <div className="text-right">
                        <div className={person.eligibilityStatus === 'ELIGIBLE' ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>
                          {person.eligibilityStatus === 'ELIGIBLE' ? '可發送' : '已排除'}
                        </div>
                        {person.exclusionReason && <div className="text-xs text-gray-500">{exclusionLabels[person.exclusionReason] || '其他排除原因'}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-2 text-sm text-gray-500">目前尚無符合客戶。</p>}
              {preview.truncated && <p className="mt-2 text-xs text-gray-500">名單僅顯示前 25 人，統計數字仍以完整即時計算為準。</p>}
            </div>
            <p className="rounded bg-blue-50 p-3 text-xs text-blue-800">可發送僅代表目前具備系統所需的 LINE 身分條件，尚未發送任何訊息。</p>
            {canManage && (
              <button type="button" onClick={prepareAudience} disabled={preparing || !selectedSegmentReference} className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {preparing ? '準備中…' : '準備活動受眾'}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5" data-testid="campaign-prepared-audience">
        <h3 className="text-lg font-bold text-gray-900">已準備受眾</h3>
        {audienceLoading && <p className="mt-3 text-sm text-gray-500">載入已準備受眾中…</p>}
        {audienceError && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{audienceError}</p>}
        {!audienceLoading && !audienceError && !audience && <p className="mt-3 text-sm text-gray-500">尚未準備受眾。</p>}
        {!audienceLoading && audience && (
          <div className="mt-4 space-y-4">
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="font-semibold text-emerald-800">已準備</div>
              <p className="mt-1 text-sm text-emerald-800">此版本已凍結，後續 CRM 資料變更不會改寫目前受眾。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded border p-3 text-sm"><span className="text-gray-500">內容版本</span><strong className="mt-1 block">v{audience.contentVersion}</strong></div>
              <div className="rounded border p-3 text-sm"><span className="text-gray-500">受眾版本</span><strong className="mt-1 block">v{audience.audienceVersion}</strong></div>
              <div className="rounded border p-3 text-sm"><span className="text-gray-500">準備時間</span><strong className="mt-1 block">{formatTime(audience.preparedAt)}</strong></div>
            </div>
            <CountCards summary={audience} />
            <Breakdown items={audience.exclusionBreakdown} />
          </div>
        )}
      </section>
    </div>
  );
}
