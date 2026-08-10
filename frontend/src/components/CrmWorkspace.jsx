import React, { useCallback, useEffect, useMemo, useState } from 'react';
import CrmInsightsTraitsPanel from './CrmInsightsTraitsPanel';
import CrmPipelinePanel, { CrmBusinessProcessPanel } from './CrmPipelinePanel';
import CrmTimelinePanel from './CrmTimelinePanel';

const sourceLabels = {
  CSV_IMPORT: 'CSV 匯入',
  PERSONAL_CARD_SHARE: '個人卡片分享',
  LINE_ORGANIC: 'LINE 自然來源',
  API_IMPORT: 'API 匯入',
};

const editableRoles = new Set(['owner', 'admin', 'editor']);
const assignableRoles = new Set(['owner', 'admin']);

const emptyProfile = {
  contactName: '', companyName: '', department: '', jobTitle: '',
  mobile: '', email: '', internalNote: '',
};

const api = async (request, path, options) => {
  const response = await request(path, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error || 'REQUEST_FAILED');
  return payload;
};

const displayName = (person) =>
  person?.profile?.contactName || person?.profile?.displayName || '未命名客戶';

export default function CrmWorkspace({ request, userRole = 'viewer' }) {
  const role = String(userRole).toLowerCase();
  const canEdit = editableRoles.has(role);
  const canAssign = assignableRoles.has(role);

  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReference, setSelectedReference] = useState('');
  const [detail, setDetail] = useState(null);
  const [cards, setCards] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [assignees, setAssignees] = useState([]);
  const [selectedAssigneeReference, setSelectedAssigneeReference] = useState('');
  const [assignmentMessage, setAssignmentMessage] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [imports, setImports] = useState([]);

  const selectedPerson = useMemo(
    () => people.find((person) => person.personRef === selectedReference) || null,
    [people, selectedReference],
  );

  const loadPeople = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api(
        request,
        '/api/crm/people?search=' + encodeURIComponent(search) + '&status=' + encodeURIComponent(status),
      );
      setPeople(result.people || []);
      setError('');
    } catch (cause) {
      setError(cause.message);
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [request, search, status]);

  const refreshDetail = async (personReference) => {
    const [personResult, cardsResult] = await Promise.all([
      api(request, '/api/crm/people/' + encodeURIComponent(personReference)),
      api(request, '/api/crm/people/' + encodeURIComponent(personReference) + '/cards'),
    ]);
    setDetail(personResult.person);
    setCards(cardsResult);
    setProfile({
      ...emptyProfile,
      ...personResult.person?.profile,
    });
  };

  const openPerson = async (person) => {
    setSelectedReference(person.personRef);
    setAssignmentMessage('');
    try {
      await refreshDetail(person.personRef);
      if (canAssign) {
        const result = await api(request, '/api/crm/assignees');
        setAssignees(result.assignees || []);
      }
      setError('');
    } catch (cause) {
      setError(cause.message);
    }
  };

  const saveProfile = async () => {
    if (!detail || !canEdit) return;
    setSavingProfile(true);
    try {
      const result = await api(
        request,
        '/api/crm/people/' + encodeURIComponent(detail.personRef) + '/profile',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile }),
        },
      );
      setDetail((current) => current ? { ...current, profile: result.profile || result.person?.profile || current.profile } : current);
      setAssignmentMessage('CRM Profile 已更新。');
      setError('');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const assignOwner = async () => {
    if (!detail || !canAssign || !selectedAssigneeReference) return;
    setAssigning(true);
    try {
      await api(
        request,
        '/api/crm/people/' + encodeURIComponent(detail.personRef) + '/assignment',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignedUserReference: selectedAssigneeReference }),
        },
      );
      await refreshDetail(detail.personRef);
      setAssignmentMessage('CRM 負責人已更新。');
      setSelectedAssigneeReference('');
      setError('');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setAssigning(false);
    }
  };

  useEffect(() => { void loadPeople(); }, [loadPeople]);
  useEffect(() => {
    if (role !== 'admin' && role !== 'owner') return;
    api(request, '/api/crm/imports').then((result) => setImports(result.imports || [])).catch(() => setImports([]));
  }, [request, role]);

  return (
    <section data-testid="crm-workspace" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">CRM 客戶管理</h1>
        <p className="mt-1 text-sm text-gray-500">以 CRM Person 為客戶視圖；推薦人與 CRM 負責人為兩個獨立欄位。</p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border bg-white p-4">
        <input
          aria-label="搜尋客戶"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋客戶"
          className="rounded border px-3 py-2 text-sm"
        />
        <select aria-label="客戶狀態" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded border px-3 py-2 text-sm">
          <option value="">全部狀態</option>
          <option value="ACTIVE">啟用</option>
          <option value="ARCHIVED">封存</option>
        </select>
        <button type="button" onClick={loadPeople} className="rounded bg-slate-800 px-4 py-2 text-sm text-white">搜尋</button>
      </div>

      {loading && <p>載入 CRM 客戶中…</p>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">無法完成 CRM 操作：{error}</p>}
      {!loading && !error && people.length === 0 && <p className="rounded border bg-white p-6 text-sm text-gray-500">目前尚無 CRM 客戶資料。</p>}

      {!loading && people.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-white">
          {people.map((person) => (
            <button
              key={person.personRef}
              type="button"
              onClick={() => openPerson(person)}
              className="block w-full border-b p-4 text-left hover:bg-gray-50"
            >
              <div className="font-medium text-gray-900">{displayName(person)}</div>
              <div className="mt-1 text-sm text-gray-600">
                {person.profile?.companyName || '—'}　來源：{sourceLabels[person.firstAcquisitionSource] || person.firstAcquisitionSource || '—'}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                推薦人（系統歸屬）：{person.referrerLabel || '—'}　／　CRM 負責人：{person.assignedOwnerLabel || '—'}
              </div>
            </button>
          ))}
        </div>
      )}

      {detail && (
        <article data-testid="crm-360" className="space-y-5 rounded-xl border bg-white p-5">
          <div>
            <h2 className="text-xl font-bold">CRM 360</h2>
            <p className="mt-1 text-sm text-gray-600">{displayName(detail)}／{detail.profile?.companyName || '—'}／{detail.status || '—'}</p>
          </div>

          <section className="rounded border p-4">
            <h3 className="font-semibold">CRM Profile</h3>
            {canEdit ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {[
                  ['contactName', '姓名'], ['companyName', '公司'], ['department', '部門'],
                  ['jobTitle', '職稱'], ['mobile', '手機'], ['email', 'Email'],
                ].map(([field, label]) => (
                  <label key={field} className="text-sm">
                    {label}
                    <input
                      value={profile[field] || ''}
                      onChange={(event) => setProfile((current) => ({ ...current, [field]: event.target.value }))}
                      className="mt-1 block w-full rounded border px-3 py-2"
                    />
                  </label>
                ))}
                <label className="text-sm md:col-span-2">內部備註
                  <textarea value={profile.internalNote || ''} onChange={(event) => setProfile((current) => ({ ...current, internalNote: event.target.value }))} className="mt-1 block min-h-20 w-full rounded border px-3 py-2" />
                </label>
                <div className="md:col-span-2"><button type="button" disabled={savingProfile} onClick={saveProfile} className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">{savingProfile ? '儲存中…' : '儲存 Profile'}</button></div>
              </div>
            ) : <p className="mt-2 text-sm text-gray-500">您有 CRM 安全閱讀權限；Profile 編輯需 Editor 以上角色。</p>}
          </section>

          <section className="rounded border p-4">
            <h3 className="font-semibold">CRM 負責人</h3>
            <p className="mt-1 text-sm text-gray-600">目前：{detail.relationships?.assignedOwner?.label || '尚未指派'}</p>
            <p className="mt-1 text-xs text-gray-500">推薦人（系統歸屬）：{detail.relationships?.referredBy?.referrerLabel || '—'}；不會因 CRM 指派而改變。</p>
            {canAssign ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <select aria-label="CRM 負責人" value={selectedAssigneeReference} onChange={(event) => setSelectedAssigneeReference(event.target.value)} className="rounded border px-3 py-2 text-sm">
                  <option value="">選擇同工作區使用者</option>
                  {assignees.map((assignee) => <option key={assignee.assignedUserReference} value={assignee.assignedUserReference}>{assignee.displayLabel}{assignee.roleLabel ? '（' + assignee.roleLabel + '）' : ''}</option>)}
                </select>
                <button type="button" disabled={!selectedAssigneeReference || assigning} onClick={assignOwner} className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">{assigning ? '指派中…' : '更新負責人'}</button>
              </div>
            ) : <p className="mt-2 text-sm text-gray-500">負責人指派需 Admin 或 Owner 角色。</p>}
          </section>

          {assignmentMessage && <p role="status" className="text-sm text-green-700">{assignmentMessage}</p>}

          <section className="rounded border p-4">
            <h3 className="font-semibold">取得來源</h3>
            {(detail.acquisition?.recent || []).length ? detail.acquisition.recent.map((entry, index) => <p key={index} className="mt-2 text-sm">{sourceLabels[entry.sourceType] || entry.sourceType}　{entry.occurredAt || '—'}</p>) : <p className="mt-2 text-sm text-gray-500">尚無取得來源紀錄。</p>}
          </section>

          <section className="rounded border p-4">
            <h3 className="font-semibold">推薦關係（唯讀）</h3>
            <p className="mt-2 text-sm">推薦人（系統歸屬）：{detail.relationships?.referredBy?.referrerLabel || '—'}</p>
          </section>

          <CrmBusinessProcessPanel request={request} personReference={detail.personRef} userRole={role} />

          <section className="rounded border p-4">
            <h3 className="font-semibold">卡片</h3>
            <h4 className="mt-3 text-sm font-medium">個人卡片</h4>
            {(cards?.personalCards || []).length ? cards.personalCards.map((card, index) => <p key={index} className="mt-1 text-sm">{card.displayName || '—'}／{card.companyName || '—'}／{card.jobTitle || '—'}／版本 {card.versionNo || '—'}</p>) : <p className="mt-1 text-sm text-gray-500">尚無個人卡片。</p>}
            <h4 className="mt-3 text-sm font-medium">歷史商務名片</h4>
            {(cards?.businessCards || []).length ? cards.businessCards.map((card, index) => <p key={index} className="mt-1 text-sm">{card.displayName || '—'}／{card.companyName || '—'}／{card.department || '—'}／{card.jobTitle || '—'}／{sourceLabels[card.sourceType] || card.sourceType || '—'}／{card.capturedAt || '—'}{card.archived ? '／已封存' : ''}</p>) : <p className="mt-1 text-sm text-gray-500">尚無歷史商務名片。</p>}
          </section>
          <CrmInsightsTraitsPanel request={request} personReference={detail.personRef} userRole={role} />
          <CrmTimelinePanel request={request} personReference={detail.personRef} />
        </article>
      )}

      {(role === 'admin' || role === 'owner') && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-bold">匯入紀錄</h2>
          <p className="mt-1 text-sm text-gray-600">CSV：可使用　／　XLSX：待提供　／　OCR：待提供</p>
          {imports.length ? imports.map((item) => <p key={item.importReference} className="mt-2 text-sm">{item.sourceFilename || '—'}／{item.status || '—'}／{item.totalRows || 0}</p>) : <p className="mt-3 text-sm text-gray-500">目前沒有匯入紀錄。</p>}
        </section>
      )}

      <CrmPipelinePanel request={request} userRole={role} />


      {selectedPerson && <span className="sr-only">{selectedPerson.personRef}</span>}
    </section>
  );
}