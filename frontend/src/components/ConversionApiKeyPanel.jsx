import React, { useCallback, useEffect, useState } from 'react';

const formatTime = value => value ? new Date(value).toLocaleString('zh-TW') : '—';

export default function ConversionApiKeyPanel({ request, userRole }) {
  const allowed = ['owner', 'admin'].includes(String(userRole || '').toLowerCase());
  const [state, setState] = useState({ loading: true, keys: [], error: '' });
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [oneTimeKey, setOneTimeKey] = useState('');
  const [actionError, setActionError] = useState('');
  const load = useCallback(async () => {
    if (!allowed) return;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const response = await request('/api/workspaces/conversion-api-keys');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load Conversion API keys.');
      setState({ loading: false, keys: Array.isArray(data.keys) ? data.keys : [], error: '' });
    } catch (error) { setState({ loading: false, keys: [], error: error.message || 'Unable to load Conversion API keys.' }); }
  }, [allowed, request]);
  useEffect(() => { load(); }, [load]);
  if (!allowed) return null;
  const createKey = async event => {
    event.preventDefault(); setActionError(''); setCreating(true);
    try {
      const response = await request('/api/workspaces/conversion-api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() || 'Conversion integration' }) });
      const data = await response.json();
      if (!response.ok || !data.success || !data.key?.secret) throw new Error(data.error || 'Unable to create Conversion API key.');
      setOneTimeKey(data.key.secret); setName(''); await load();
    } catch (error) { setActionError(error.message || 'Unable to create Conversion API key.'); } finally { setCreating(false); }
  };
  const revoke = async keyId => {
    if (!window.confirm('撤銷後，這組 Conversion API 金鑰將無法再使用。')) return;
    setActionError('');
    try { const response = await request(`/api/workspaces/conversion-api-keys/${encodeURIComponent(keyId)}/revoke`, { method: 'POST' }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to revoke Conversion API key.'); await load(); } catch (error) { setActionError(error.message || 'Unable to revoke Conversion API key.'); }
  };
  return <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm" aria-label="Conversion API">
    <div><h2 className="text-xl font-bold text-gray-900">Conversion API</h2><p className="mt-1 text-sm text-gray-500">Server-to-server conversion ingestion credentials. They are separate from LINE and user-session credentials.</p></div>
    {oneTimeKey && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="dialog" aria-label="新 Conversion API 金鑰"><div className="font-bold">請立即複製，此金鑰之後不會再次顯示。</div><code className="mt-2 block break-all rounded bg-white p-3 text-xs">{oneTimeKey}</code><button type="button" onClick={() => setOneTimeKey('')} className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold">我已複製並關閉</button></div>}
    <form className="mt-5 flex flex-wrap gap-2" onSubmit={createKey}><label className="sr-only" htmlFor="conversion-key-name">Key name</label><input id="conversion-key-name" value={name} onChange={event => setName(event.target.value)} maxLength="80" placeholder="例如：官網轉換服務" className="min-w-56 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" /><button disabled={creating} className="rounded-md bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{creating ? '建立中…' : '建立金鑰'}</button></form>
    {actionError && <div className="mt-3 text-sm text-red-700">{actionError}</div>}{state.error && <div className="mt-3 text-sm text-red-700">{state.error}</div>}
    <div className="mt-5 overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-left text-gray-500"><tr><th className="p-2">Name</th><th className="p-2">Prefix</th><th className="p-2">Status</th><th className="p-2">Created At</th><th className="p-2">Last Used At</th><th className="p-2">Action</th></tr></thead><tbody>{state.keys.map(key => <tr key={key.id} className="border-b border-gray-100"><td className="p-2 font-medium">{key.name}</td><td className="p-2 font-mono text-xs">{key.prefix}</td><td className="p-2">{key.status}</td><td className="p-2 text-xs">{formatTime(key.createdAt)}</td><td className="p-2 text-xs">{formatTime(key.lastUsedAt)}</td><td className="p-2">{key.status === 'active' ? <button type="button" onClick={() => revoke(key.id)} className="text-xs font-bold text-red-700 underline">Revoke</button> : '—'}</td></tr>)}{!state.loading && state.keys.length === 0 && <tr><td colSpan="6" className="p-5 text-center text-gray-500">尚未建立 Conversion API 金鑰。</td></tr>}</tbody></table></div>
  </section>;
}
