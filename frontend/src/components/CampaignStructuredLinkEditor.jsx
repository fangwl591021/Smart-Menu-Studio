import React, { useState } from 'react';
import {
  CAMPAIGN_TRACKED_LINK_MAX_COUNT,
  humanizeTrackedLinkText,
  isValidTrackedLinkDestination,
  nextTrackedLinkToken,
  removeTrackedLinkPlaceholder,
  trackedLinkPlaceholder,
} from '../utils/campaignStructuredLinks';

const emptyDraft = { token: '', label: '', destinationUrl: '' };

export default function CampaignStructuredLinkEditor({ text, links, disabled, onLinksChange, onTextChange, onInsertLink }) {
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState('');

  const beginAdd = () => {
    setDraft({ ...emptyDraft, token: nextTrackedLinkToken(links) });
    setFormError('');
  };

  const beginEdit = link => {
    setDraft({ token: link.token, label: link.label, destinationUrl: link.destinationUrl });
    setFormError('');
  };

  const saveDraft = () => {
    const label = draft?.label?.trim() || '';
    const destinationUrl = draft?.destinationUrl?.trim() || '';
    if (!label || Array.from(label).length > 120) {
      setFormError('請輸入 1 至 120 個字的連結名稱。');
      return;
    }
    if (!isValidTrackedLinkDestination(destinationUrl)) {
      setFormError('連結網址必須使用安全的 HTTPS 網址。');
      return;
    }
    const definition = { token: draft.token, label, destinationUrl };
    const existingIndex = links.findIndex(link => link.token === draft.token);
    if (existingIndex >= 0) {
      onLinksChange(links.map((link, index) => index === existingIndex ? definition : link));
    } else {
      if (links.length >= CAMPAIGN_TRACKED_LINK_MAX_COUNT) return;
      onLinksChange([...links, definition]);
    }
    setDraft(null);
    setFormError('');
  };

  const removeLink = link => {
    const placeholder = trackedLinkPlaceholder(link.token);
    if (text.includes(placeholder)) {
      const confirmed = globalThis.confirm?.(`移除「${link.label}」也會從訊息內容移除對應的追蹤連結。其他文字與一般網址不會變更。確定要移除嗎？`);
      if (!confirmed) return;
      onTextChange(removeTrackedLinkPlaceholder(text, link.token));
    }
    onLinksChange(links.filter(item => item.token !== link.token));
  };

  return (
    <section data-testid="campaign-structured-link-editor" className="mt-5 rounded-lg border border-blue-100 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">追蹤連結</h3>
          <p className="mt-1 text-xs text-gray-600">追蹤連結只代表收件者曾點擊，不代表成交、名單取得、推薦、獎勵或佣金結果。</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-600">追蹤連結 {links.length} / {CAMPAIGN_TRACKED_LINK_MAX_COUNT}</div>
          {!disabled && (
            <button type="button" onClick={beginAdd} disabled={links.length >= CAMPAIGN_TRACKED_LINK_MAX_COUNT || !!draft} className="mt-2 rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              新增追蹤連結
            </button>
          )}
        </div>
      </div>

      {!links.length && !draft && (
        <div className="mt-4 rounded border border-dashed bg-white p-3 text-sm text-gray-600">
          <div>尚未新增追蹤連結。</div>
          <div className="mt-1 text-xs">新增後可插入訊息，並在活動發送後查看點擊互動；一般網址仍會保持原樣且不會自動追蹤。</div>
        </div>
      )}

      {draft && !disabled && (
        <div className="mt-4 grid gap-3 rounded border bg-white p-4 sm:grid-cols-2" data-testid="tracked-link-form">
          <label className="text-sm font-medium text-gray-700">
            連結名稱
            <input aria-label="連結名稱" value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} maxLength={120} className="mt-1 block w-full rounded border px-3 py-2" placeholder="例如：活動報名" />
          </label>
          <label className="text-sm font-medium text-gray-700">
            目的網址
            <input aria-label="目的網址" type="url" inputMode="url" value={draft.destinationUrl} onChange={event => setDraft({ ...draft, destinationUrl: event.target.value })} maxLength={2048} className="mt-1 block w-full rounded border px-3 py-2" placeholder="https://example.com/event" />
          </label>
          {formError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{formError}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" onClick={saveDraft} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">儲存連結</button>
            <button type="button" onClick={() => { setDraft(null); setFormError(''); }} className="rounded border px-4 py-2 text-sm">取消</button>
          </div>
        </div>
      )}

      {!!links.length && (
        <div className="mt-4 space-y-2" data-testid="tracked-link-list">
          {links.map(link => (
            <article key={link.token} className="flex flex-wrap items-center justify-between gap-3 rounded border bg-white p-3">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">{link.label}</div>
                <div className="truncate text-xs text-gray-500">{new URL(link.destinationUrl).hostname}</div>
              </div>
              {!disabled && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => onInsertLink(link)} disabled={text.includes(trackedLinkPlaceholder(link.token))} className="rounded border border-blue-200 px-3 py-1.5 text-sm text-blue-700 disabled:opacity-50">插入訊息</button>
                  <button type="button" onClick={() => beginEdit(link)} disabled={!!draft} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">編輯</button>
                  <button type="button" onClick={() => removeLink(link)} className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-700">移除</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {disabled && !!links.length && <p className="mt-3 text-xs text-gray-600">此活動內容已凍結或目前為唯讀，追蹤連結不可編輯。</p>}

      {!!text.trim() && (
        <div className="mt-4 rounded border bg-white p-3" data-testid="tracked-link-message-preview">
          <div className="text-xs font-semibold text-gray-600">訊息預覽</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{humanizeTrackedLinkText(text, links)}</p>
          <p className="mt-2 text-xs text-gray-500">預覽只顯示連結名稱，不會建立或呼叫收件者專屬追蹤網址。</p>
        </div>
      )}
    </section>
  );
}
