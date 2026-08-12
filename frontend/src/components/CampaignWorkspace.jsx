import React, { useCallback, useEffect, useState } from 'react';
import CampaignEditor from './CampaignEditor';
import { labelStatus } from '../utils/presentationLabels';

const requestJson = async (request, path, options) => {
  const response = await request(path, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error || 'REQUEST_FAILED');
  return payload;
};

const formatTime = (value) => value
  ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

export default function CampaignWorkspace({ request, userRole = 'viewer', initialCampaign = null, onInitialCampaignConsumed }) {
  const role = String(userRole).toLowerCase();
  const canManage = role === 'owner' || role === 'admin';
  const [campaigns, setCampaigns] = useState([]);
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [segmentError, setSegmentError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [creating, setCreating] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const payload = await requestJson(request, '/api/campaigns');
      setCampaigns(payload.campaigns || []);
    } catch {
      setCampaigns([]);
      setListError('無法載入行銷活動，請稍後再試。');
    } finally {
      setLoading(false);
    }
  }, [request]);

  const loadSegments = useCallback(async () => {
    setSegmentError('');
    try {
      const payload = await requestJson(request, '/api/crm/segments');
      setSegments(payload.segments || []);
    } catch {
      setSegments([]);
      setSegmentError('目前無法載入客群分群；活動清單仍可繼續使用。');
    }
  }, [request]);

  useEffect(() => {
    void loadCampaigns();
    void loadSegments();
  }, [loadCampaigns, loadSegments]);

  useEffect(() => {
    if (!initialCampaign?.safeCampaignReference) return;
    setSelectedCampaign(initialCampaign);
    setCreating(false);
    onInitialCampaignConsumed?.();
  }, [initialCampaign, onInitialCampaignConsumed]);

  const openCampaign = async (campaign) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const payload = await requestJson(
        request,
        `/api/campaigns/${encodeURIComponent(campaign.safeCampaignReference)}`,
      );
      setSelectedCampaign(payload.campaign);
      setCreating(false);
    } catch {
      setDetailError('無法載入活動內容，請稍後再試。');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCampaignChange = async (campaign) => {
    setSelectedCampaign(campaign);
    await loadCampaigns();
  };

  const handleCreated = async (campaign) => {
    setCreating(false);
    setSelectedCampaign(campaign);
    await loadCampaigns();
  };

  const closeEditor = () => {
    setSelectedCampaign(null);
    setCreating(false);
    setDetailError('');
  };

  if (creating || selectedCampaign) {
    return (
      <CampaignEditor
        campaign={selectedCampaign}
        creating={creating}
        request={request}
        userRole={role}
        segments={segments}
        onCampaignChange={handleCampaignChange}
        onCreated={handleCreated}
        onCancel={closeEditor}
      />
    );
  }

  return (
    <section data-testid="campaign-workspace" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">行銷活動</h1>
          <p className="mt-1 text-sm text-gray-500">建立文字活動、即時預覽 CRM 客群，並準備不可變的受眾快照。</p>
        </div>
        {canManage && (
          <button type="button" onClick={() => setCreating(true)} className="rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white">
            建立行銷活動
          </button>
        )}
      </div>

      {segmentError && <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{segmentError}</p>}
      {detailLoading && <p className="rounded border bg-white p-4 text-sm text-gray-500">載入活動內容中…</p>}
      {detailError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{detailError}</p>}

      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-5 py-4">
          <h2 className="text-lg font-bold text-gray-900">活動清單</h2>
        </div>
        {loading && <p className="p-6 text-sm text-gray-500">載入行銷活動中…</p>}
        {listError && <p role="alert" className="m-5 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{listError}</p>}
        {!loading && !listError && campaigns.length === 0 && <p className="p-8 text-center text-sm text-gray-500">尚無行銷活動。</p>}
        {!loading && !listError && campaigns.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-gray-500">
                <tr>
                  {['活動名稱', '狀態', '內容版本', '受眾版本', '建立時間', '更新時間', '準備時間', '操作'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {campaigns.map((campaign) => (
                  <tr key={campaign.safeCampaignReference}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{campaign.name}</div>
                      {campaign.description && <div className="mt-1 max-w-xs truncate text-xs text-gray-500">{campaign.description}</div>}
                    </td>
                    <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">{labelStatus(campaign.status)}</span></td>
                    <td className="px-4 py-3">v{campaign.currentContentVersion}</td>
                    <td className="px-4 py-3">{campaign.currentAudienceVersion ? `v${campaign.currentAudienceVersion}` : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{formatTime(campaign.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{formatTime(campaign.updatedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{formatTime(campaign.preparedAt)}</td>
                    <td className="px-4 py-3"><button type="button" onClick={() => openCampaign(campaign)} className="text-sm font-medium text-blue-700 hover:underline">查看活動</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!canManage && <p className="text-sm text-gray-500">目前為唯讀權限；建立、編輯、預覽、準備與封存需管理員或擁有者角色。</p>}
    </section>
  );
}
