import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, QrCode, Share2, UserPlus } from 'lucide-react';
import { loadLiffSdk, referralContextFromLocation, usableLiffConfig } from '../liff-referral';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_PRODUCTION_WORKER_BASE_URL || (import.meta.env.PROD ? 'https://smart-menu-backend.fangwl591021.workers.dev' : 'http://127.0.0.1:8788');
const api = (path, options) => fetch(`${API_BASE_URL}${path}`, options);
const unavailable = { NOT_CONFIGURED: '此工作區尚未完成 LIFF 設定，暫時無法使用推薦功能。', LINKAGE_NOT_CONFIRMED: 'LIFF 與官方帳號的連結尚未確認。', NOT_RUNTIME_VERIFIED: 'LIFF 設定尚待驗證，請稍後再試。', STALE: 'LIFF 設定已過期，請由工作區管理員更新。' };

export default function LiffReferralPage() {
  const [state, setState] = useState({ loading: true, status: '', error: '', referral: null, friendship: null });
  useEffect(() => { let active = true; (async () => {
    const initial = referralContextFromLocation();
    if (!initial.lineAccountId) { if (active) setState({ loading: false, status: 'NOT_CONFIGURED', error: '缺少安全的 LINE 帳號入口資訊。', referral: null, friendship: null }); return; }
    try {
      const response = await api(`/api/member/referral/bootstrap?lineAccountId=${encodeURIComponent(initial.lineAccountId)}`);
      const bootstrap = await response.json();
      if (!response.ok || !bootstrap.success || !usableLiffConfig(bootstrap.config)) { if (active) setState({ loading: false, status: bootstrap?.config?.status || 'NOT_CONFIGURED', error: '', referral: null, friendship: null }); return; }
      const liff = await loadLiffSdk(); await liff.init({ liffId: bootstrap.config.liffId });
      const context = referralContextFromLocation();
      if (!liff.isLoggedIn()) { liff.login(); return; }
      const token = liff.getAccessToken(); if (!token) throw new Error('無法取得 LINE 登入憑證。');
      const headers = { Authorization: `Bearer ${token}` };
      const establish = await api('/api/member/establish', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ lineAccountId: context.lineAccountId, liffAccessToken: token }) });
      if (!establish.ok) throw new Error('無法建立會員驗證。');
      const referralResponse = await api(`/api/member/referral?lineAccountId=${encodeURIComponent(context.lineAccountId)}`, { headers });
      const referral = await referralResponse.json(); if (!referralResponse.ok || !referral.success) throw new Error(referral.error || '無法建立推薦資訊。');
      const friend = await liff.getFriendship();
      if (context.referralCode) { const qualification = await (await api('/api/member/referral/qualify', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ lineAccountId: context.lineAccountId, liffAccessToken: token, referralCode: context.referralCode, src: context.source, returnTo: context.returnTo }) })).json(); if (qualification.status === 'NOT_FRIEND') throw new Error('請先加入官方帳號好友後再重新確認。'); }
      if (active) setState({ loading: false, status: 'READY', error: '', referral, friendship: Boolean(friend?.friendFlag) });
    } catch (error) { if (active) setState({ loading: false, status: 'ERROR', error: error?.message || '推薦功能暫時無法使用。', referral: null, friendship: null }); }
  })(); return () => { active = false; }; }, []);
  const requestFriendship = async () => { try { await window.liff.requestFriendship(); const result = await window.liff.getFriendship(); setState(s => ({ ...s, friendship: Boolean(result?.friendFlag) })); } catch { setState(s => ({ ...s, error: '請在 LINE 中完成加入好友後，再重新開啟此頁確認。' })); } };
  const copy = async () => { if (state.referral?.referralUrl) await navigator.clipboard?.writeText(state.referral.referralUrl); };
  const share = async () => { if (state.referral?.referralUrl && navigator.share) await navigator.share({ url: state.referral.referralUrl }); else await copy(); };
  if (state.loading) return <main className="min-h-screen bg-slate-50 flex items-center justify-center gap-2 text-slate-600"><Loader2 className="animate-spin" size={20}/>載入推薦功能…</main>;
  if (state.status !== 'READY') return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><section className="max-w-md rounded-2xl bg-white p-6 text-center shadow"><h1 className="text-xl font-bold text-slate-900">推薦功能尚未設定</h1><p className="mt-3 text-sm text-slate-600">{state.error || unavailable[state.status] || '目前無法使用此功能。'}</p></section></main>;
  return <main className="min-h-screen bg-slate-50 p-5 text-slate-900"><section className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow"><h1 className="text-2xl font-bold">邀請好友</h1><p className="mt-2 text-sm text-slate-600">分享你的推薦連結，好友完成資格確認後會計入推薦紀錄。</p>{state.friendship === false && <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><p>請先加入官方帳號好友，才能完成推薦資格確認。</p><button onClick={requestFriendship} className="mt-3 inline-flex items-center gap-2 rounded bg-amber-600 px-3 py-2 font-bold text-white"><UserPlus size={16}/>加入好友</button></div>}{state.friendship === true && <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={17}/>已確認官方帳號好友關係</div>}<div className="mt-5 rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2 text-sm font-bold"><QrCode size={18}/>推薦 QR Code</div><p className="mt-2 break-all text-xs text-slate-500">{state.referral.qrValue}</p></div><p className="mt-4 text-sm">已完成資格推薦：<b>{state.referral.qualifiedReferralCount}</b></p><div className="mt-5 grid grid-cols-2 gap-3"><button onClick={copy} className="inline-flex items-center justify-center gap-2 rounded bg-slate-900 px-4 py-3 text-sm font-bold text-white"><Copy size={16}/>複製連結</button><button onClick={share} className="inline-flex items-center justify-center gap-2 rounded border border-slate-300 px-4 py-3 text-sm font-bold"><Share2 size={16}/>分享 LINE</button></div></section></main>;
}