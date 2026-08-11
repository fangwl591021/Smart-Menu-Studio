import React, { useEffect, useMemo, useState } from 'react';
import CampaignAudiencePanel from './CampaignAudiencePanel';
import CampaignExecutionPanel from './CampaignExecutionPanel';
import CampaignClickEngagementPanel from './CampaignClickEngagementPanel';
import { labelStatus } from '../utils/presentationLabels';

const requestJson = async (request, path, options) => {
  const response = await request(path, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error || 'REQUEST_FAILED');
  return payload;
};

const errorLabel = (code) => {
  const labels = {
    CAMPAIGN_NAME_REQUIRED: '請輸入活動名稱。',
    CAMPAIGN_NAME_CONFLICT: '已有相同名稱的活動。',
    CAMPAIGN_CONTENT_INVALID: '文字訊息格式不正確。',
    CAMPAIGN_CONTENT_TEXT_INVALID: '訊息內容必須為 1 至 5000 字。',
    CAMPAIGN_NOT_DRAFT: '只有草稿活動可以編輯。',
    FORBIDDEN: '目前角色沒有執行此操作的權限。',
  };
  return labels[code] || '操作失敗，請稍後再試。';
};

const formatTime = (value) => value
  ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

export default function CampaignEditor({
  campaign,
  creating = false,
  request,
  userRole = 'viewer',
  segments = [],
  onCampaignChange,
  onCreated,
  onCancel,
}) {
  const role = String(userRole).toLowerCase();
  const canManage = role === 'owner' || role === 'admin';
  const isDraft = creating || campaign?.status === 'DRAFT';
  const canEdit = canManage && isDraft;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState('');
  const [selectedSegmentReference, setSelectedSegmentReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');
  const textLength = useMemo(() => Array.from(text).length, [text]);

  useEffect(() => {
    setName(campaign?.name || '');
    setDescription(campaign?.description || '');
    setText(campaign?.currentContent?.text || '');
    setSelectedSegmentReference('');
    setError('');
  }, [
    campaign?.safeCampaignReference,
    campaign?.currentContentVersion,
    campaign?.name,
    campaign?.description,
    campaign?.currentContent?.text,
    creating,
  ]);

  const refreshCampaign = async () => {
    if (!campaign?.safeCampaignReference) return null;
    const payload = await requestJson(
      request,
      `/api/campaigns/${encodeURIComponent(campaign.safeCampaignReference)}`,
    );
    onCampaignChange?.(payload.campaign);
    return payload.campaign;
  };

  const saveCampaign = async () => {
    if (!canEdit || saving) return;
    if (!name.trim()) {
      setError('請輸入活動名稱。');
      return;
    }
    if (!text.trim() || textLength > 5000) {
      setError('訊息內容必須為 1 至 5000 字。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const content = { contentType: 'TEXT', text };
      if (creating) {
        const payload = await requestJson(request, '/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), description: description.trim(), content }),
        });
        onCreated?.(payload.campaign);
      } else {
        const payload = await requestJson(
          request,
          `/api/campaigns/${encodeURIComponent(campaign.safeCampaignReference)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), description: description.trim(), content }),
          },
        );
        onCampaignChange?.(payload.campaign);
      }
    } catch (cause) {
      setError(errorLabel(cause.message));
    } finally {
      setSaving(false);
    }
  };

  const archiveCampaign = async () => {
    if (!canManage || creating || archiving || !campaign?.safeCampaignReference) return;
    if (!globalThis.confirm?.('確定要封存此活動嗎？封存後仍可查看歷史內容與已準備受眾。')) return;
    setArchiving(true);
    setError('');
    try {
      const payload = await requestJson(
        request,
        `/api/campaigns/${encodeURIComponent(campaign.safeCampaignReference)}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ARCHIVED' }),
        },
      );
      onCampaignChange?.(payload.campaign);
    } catch (cause) {
      setError(errorLabel(cause.message));
    } finally {
      setArchiving(false);
    }
  };

  const status = creating ? 'DRAFT' : campaign?.status;

  return (
    <section data-testid="campaign-editor" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onCancel} className="text-sm text-blue-700 hover:underline">← 返回行銷活動</button>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{creating ? '建立行銷活動' : campaign?.name || '行銷活動'}</h1>
          <p className="mt-1 text-sm text-gray-500">狀態：{labelStatus(status)}</p>
        </div>
        {!creating && canManage && campaign?.status !== 'ARCHIVED' && (
          <button type="button" onClick={archiveCampaign} disabled={archiving} className="rounded border border-amber-300 px-4 py-2 text-sm text-amber-800 disabled:opacity-50">
            {archiving ? '封存中…' : '封存活動'}
          </button>
        )}
      </div>

      {campaign?.status === 'PREPARED' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          此版本已凍結；內容與受眾皆為活動準備當下的固定版本。
        </div>
      )}
      {campaign?.status === 'ARCHIVED' && (
        <div className="rounded-lg border bg-gray-100 p-4 text-sm text-gray-700">此活動已封存，目前僅供查看。</div>
      )}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">活動基本資料</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">
            活動名稱
            <input aria-label="活動名稱" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} disabled={!canEdit} className="mt-1 block w-full rounded border px-3 py-2 disabled:bg-gray-100" />
          </label>
          <label className="text-sm font-medium text-gray-700">
            說明
            <input aria-label="活動說明" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={!canEdit} className="mt-1 block w-full rounded border px-3 py-2 disabled:bg-gray-100" />
          </label>
        </div>
        {!creating && (
          <div className="mt-4 grid gap-2 text-xs text-gray-500 sm:grid-cols-3">
            <span>建立時間：{formatTime(campaign?.createdAt)}</span>
            <span>更新時間：{formatTime(campaign?.updatedAt)}</span>
            <span>準備時間：{formatTime(campaign?.preparedAt)}</span>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-gray-900">訊息內容</h2>
            <p className="mt-1 text-sm text-gray-500">內容類型：文字訊息（TEXT）</p>
          </div>
          <span className="rounded bg-slate-100 px-3 py-1 text-sm font-medium">內容版本 v{campaign?.currentContentVersion || 1}</span>
        </div>
        <label className="mt-4 block text-sm font-medium text-gray-700">
          訊息內容
          <textarea
            aria-label="訊息內容"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={5000}
            disabled={!canEdit}
            className="mt-1 block min-h-40 w-full rounded border px-3 py-2 disabled:bg-gray-100"
          />
        </label>
        <div className={`mt-1 text-right text-xs ${textLength > 5000 ? 'text-red-600' : 'text-gray-500'}`}>{textLength} / 5000</div>
        {canEdit && <p className="mt-2 text-xs text-gray-500">內容有變更時，儲存會建立新的不可變版本，舊版本不會被覆寫。</p>}

        {!creating && campaign?.contentVersions?.length > 0 && (
          <details className="mt-5 rounded border p-3">
            <summary className="cursor-pointer text-sm font-semibold">內容版本歷程（唯讀）</summary>
            <div className="mt-3 space-y-3">
              {campaign.contentVersions.map((version) => (
                <article key={version.versionNo} className="rounded bg-slate-50 p-3 text-sm">
                  <div className="font-medium">v{version.versionNo} · 文字訊息{version.prepared ? ' · 已準備版本' : ''}</div>
                  <div className="mt-1 text-xs text-gray-500">{formatTime(version.createdAt)}</div>
                  <p className="mt-2 whitespace-pre-wrap text-gray-700">{version.text}</p>
                </article>
              ))}
            </div>
          </details>
        )}

        {canEdit && (
          <button type="button" onClick={saveCampaign} disabled={saving || textLength > 5000 || !name.trim() || !text.trim()} className="mt-5 rounded bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            {saving ? '儲存中…' : creating ? '建立活動並儲存文字內容' : '儲存草稿新版本'}
          </button>
        )}
        {!canEdit && <p className="mt-4 text-sm text-gray-500">此活動目前為唯讀，已保存的內容版本不會被改寫。</p>}
      </section>

      {!creating && campaign && (
        <CampaignAudiencePanel
          campaign={campaign}
          request={request}
          segments={segments}
          selectedSegmentReference={selectedSegmentReference}
          onSegmentChange={setSelectedSegmentReference}
          canManage={canManage}
          onPrepared={refreshCampaign}
        />
      )}

      {!creating && campaign && (
        <CampaignExecutionPanel
          campaign={campaign}
          request={request}
          userRole={userRole}
        />
      )}

      {!creating && campaign && (
        <CampaignClickEngagementPanel
          campaign={campaign}
          request={request}
        />
      )}

      {creating && <p className="rounded border bg-white p-4 text-sm text-gray-600">先建立草稿與文字內容，接著即可選擇客群並進行即時預覽。</p>}
    </section>
  );
}
