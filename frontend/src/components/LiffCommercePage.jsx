import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Minus, Plus, RefreshCw, ShoppingBag, ShoppingCart, XCircle } from 'lucide-react';
import { loadLiffSdk, referralContextFromLocation, usableLiffConfig } from '../liff-referral';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_PRODUCTION_WORKER_BASE_URL || (import.meta.env.PROD ? 'https://smart-menu-backend.fangwl591021.workers.dev' : 'http://127.0.0.1:8788');
const PENDING_ORDER_KEY = 'smart_menu_commerce_pending_order';
const POLL_INTERVAL_MS = 4000;
const POLL_LIMIT_MS = 60000;
const api = (path, options) => fetch(`${API_BASE_URL}${path}`, options);
const money = (amount, currency = 'TWD') => currency === 'TWD' ? `NT$ ${Number(amount || 0).toLocaleString('zh-TW')}` : `${currency} ${Number(amount || 0).toLocaleString('zh-TW')}`;
const dateTime = value => value ? new Date(value).toLocaleString('zh-TW') : '—';
const statusLabel = value => ({ DRAFT: '待付款', PENDING_PAYMENT: '待付款', PAID: '已付款', CANCELLED: '已取消', PAYMENT_FAILED: '付款失敗', UNPAID: '未付款', PENDING: '確認中', FAILED: '失敗' }[value] || value || '—');
const isVerifiedPaid = payment => payment?.paymentStatus === 'PAID';
const isPaymentTerminal = payment => ['PAID', 'FAILED', 'CANCELLED'].includes(payment?.paymentStatus);

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.success) throw new Error(body?.error || 'REQUEST_FAILED');
  return body;
}

function memberRequest(auth, path, options = {}) {
  const query = path.includes('?') ? '&' : '?';
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${auth.accessToken}`);
  return api(`${path}${query}lineAccountId=${encodeURIComponent(auth.lineAccountId)}`, { ...options, headers });
}

async function pollMemberPayment({ request, auth, safeOrderReference, onUpdate, signal, intervalMs = POLL_INTERVAL_MS, limitMs = POLL_LIMIT_MS }) {
  const startedAt = Date.now();
  while (!signal?.aborted) {
    const response = await request(auth, `/api/member/commerce/orders/${encodeURIComponent(safeOrderReference)}/payment-status`);
    const body = await readJson(response);
    onUpdate(body.payment);
    if (isPaymentTerminal(body.payment)) return body.payment;
    if (Date.now() - startedAt >= limitMs) return null;
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, intervalMs);
      signal?.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
  }
  return null;
}

function submitCheckout(checkout) {
  if (!checkout?.gatewayUrl) throw new Error('CHECKOUT_UNAVAILABLE');
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = checkout.gatewayUrl;
  for (const name of ['MerchantID', 'TradeInfo', 'TradeSha', 'Version']) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = String(checkout[name] || '');
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function Storefront({ auth }) {
  const [state, setState] = useState({ loading: true, products: [], orders: [], cart: {}, selectedProduct: null, selectedOrder: null, payments: [], error: '', busy: '', confirming: false, paymentMessage: '' });
  const pollAbortRef = useRef(null);
  const load = useCallback(async () => {
    setState(value => ({ ...value, loading: true, error: '' }));
    try {
      const [productsBody, ordersBody] = await Promise.all([
        readJson(await memberRequest(auth, '/api/member/commerce/products')),
        readJson(await memberRequest(auth, '/api/member/commerce/orders')),
      ]);
      setState(value => ({ ...value, loading: false, products: productsBody.products || [], orders: ordersBody.orders || [] }));
    } catch { setState(value => ({ ...value, loading: false, error: '目前無法讀取商城資料，請稍後再試。' })); }
  }, [auth]);
  const openOrder = useCallback(async safeOrderReference => {
    setState(value => ({ ...value, busy: 'detail', error: '' }));
    try {
      const ref = encodeURIComponent(safeOrderReference);
      const [detail, history] = await Promise.all([
        readJson(await memberRequest(auth, `/api/member/commerce/orders/${ref}`)),
        readJson(await memberRequest(auth, `/api/member/commerce/orders/${ref}/payments`)),
      ]);
      setState(value => ({ ...value, busy: '', selectedOrder: detail.order, payments: history.payments || [] }));
    } catch { setState(value => ({ ...value, busy: '', error: '目前無法讀取訂單明細。' })); }
  }, [auth]);
  const confirmPayment = useCallback(async safeOrderReference => {
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setState(value => ({ ...value, confirming: true, paymentMessage: '正在確認付款結果…', error: '' }));
    try {
      const result = await pollMemberPayment({ request: memberRequest, auth, safeOrderReference, signal: controller.signal, onUpdate: payment => setState(value => ({ ...value, paymentMessage: isVerifiedPaid(payment) ? '付款已完成' : payment.paymentStatus === 'FAILED' ? '付款未完成，您可以重新發起付款。' : payment.paymentStatus === 'CANCELLED' ? '訂單已取消。' : '正在確認付款結果…' })) });
      if (!controller.signal.aborted) {
        if (!result) setState(value => ({ ...value, confirming: false, paymentMessage: '付款結果仍在確認中，您可以稍後重新整理查看。' }));
        else {
          sessionStorage.removeItem(PENDING_ORDER_KEY);
          setState(value => ({ ...value, confirming: false }));
          await load(); await openOrder(safeOrderReference);
        }
      }
    } catch { if (!controller.signal.aborted) setState(value => ({ ...value, confirming: false, paymentMessage: '付款結果仍在確認中，您可以稍後重新整理查看。' })); }
  }, [auth, load, openOrder]);
  useEffect(() => { load(); return () => pollAbortRef.current?.abort(); }, [load]);
  useEffect(() => { const pending = sessionStorage.getItem(PENDING_ORDER_KEY); if (pending) confirmPayment(pending); }, [confirmPayment]);
  const setQuantity = (reference, quantity) => setState(value => ({ ...value, cart: { ...value.cart, [reference]: Math.max(0, Math.min(100, quantity)) } }));
  const openProduct = async product => {
    if (state.selectedProduct?.safeProductReference === product.safeProductReference) { setState(value => ({ ...value, selectedProduct: null })); return; }
    setState(value => ({ ...value, busy: 'product-detail', error: '' }));
    try {
      const body = await readJson(await memberRequest(auth, `/api/member/commerce/products/${encodeURIComponent(product.safeProductReference)}`));
      setState(value => ({ ...value, busy: '', selectedProduct: body.product }));
    } catch { setState(value => ({ ...value, busy: '', error: '目前無法讀取商品詳情。' })); }
  };
  const cartItems = state.products.filter(product => Number(state.cart[product.safeProductReference] || 0) > 0).map(product => ({ ...product, quantity: Number(state.cart[product.safeProductReference]) }));
  const cartTotal = cartItems.reduce((sum, item) => sum + item.priceAmountMinor * item.quantity, 0);
  const createOrder = async () => {
    if (!cartItems.length) return;
    setState(value => ({ ...value, busy: 'order', error: '' }));
    try {
      const body = await readJson(await memberRequest(auth, '/api/member/commerce/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cartItems.map(item => ({ safeProductReference: item.safeProductReference, quantity: item.quantity })) }) }));
      setState(value => ({ ...value, busy: '', cart: {}, selectedOrder: body.order }));
      await load(); await openOrder(body.order.safeOrderReference);
    } catch { setState(value => ({ ...value, busy: '', error: '訂單未建立，商品價格或供應狀態可能已更新，請重新整理後再試。' })); }
  };
  const cancelOrder = async order => {
    if (!window.confirm('確定取消這筆未付款訂單？')) return;
    setState(value => ({ ...value, busy: 'cancel', error: '' }));
    try { await readJson(await memberRequest(auth, `/api/member/commerce/orders/${encodeURIComponent(order.safeOrderReference)}/cancel`, { method: 'POST' })); sessionStorage.removeItem(PENDING_ORDER_KEY); await load(); await openOrder(order.safeOrderReference); }
    catch { setState(value => ({ ...value, busy: '', error: '訂單取消未完成，請重新整理確認最新狀態。' })); }
  };
  const pay = async order => {
    setState(value => ({ ...value, busy: 'payment', error: '' }));
    try {
      const body = await readJson(await memberRequest(auth, `/api/member/commerce/orders/${encodeURIComponent(order.safeOrderReference)}/payment-intents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
      sessionStorage.setItem(PENDING_ORDER_KEY, order.safeOrderReference);
      submitCheckout(body.payment?.checkout);
    } catch { setState(value => ({ ...value, busy: '', error: '目前無法前往付款，請稍後再試。' })); }
  };
  if (state.loading) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" />正在讀取商城…</div>;
  return <div className="space-y-6">
    {(state.paymentMessage || state.confirming) && <div className={`rounded-xl p-4 text-sm ${state.paymentMessage === '付款已完成' ? 'bg-emerald-50 text-emerald-900' : 'bg-blue-50 text-blue-900'}`} aria-live="polite"><div className="flex items-center gap-2">{state.confirming ? <Loader2 size={18} className="animate-spin" /> : state.paymentMessage === '付款已完成' ? <CheckCircle2 size={18} /> : <RefreshCw size={18} />}{state.paymentMessage || '正在確認付款結果…'}</div></div>}
    {state.error && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{state.error}</p>}
    <section aria-label="商品"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">商品</h2><p className="mt-1 text-sm text-slate-500">目前可購買的上架商品。</p></div><button onClick={load} className="rounded-lg border border-slate-300 p-2" aria-label="重新整理商城"><RefreshCw size={17} /></button></div>{state.products.length === 0 ? <p className="mt-4 rounded-xl bg-white p-5 text-sm text-slate-500">目前沒有可購買商品。</p> : <div className="mt-4 grid gap-4 sm:grid-cols-2">{state.products.map(product => <article key={product.safeProductReference} className="rounded-xl bg-white p-5 shadow-sm"><button type="button" onClick={() => openProduct(product)} className="w-full text-left"><h3 className="font-bold">{product.name}</h3><p className="mt-2 text-lg font-bold">{money(product.priceAmountMinor, product.currencyCode)}</p>{state.selectedProduct?.safeProductReference === product.safeProductReference && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{state.selectedProduct.description || '此商品尚無說明。'}</p>}</button><button type="button" onClick={() => setQuantity(product.safeProductReference, Number(state.cart[product.safeProductReference] || 0) + 1)} className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">加入購物車</button></article>)}</div>}</section>
    <section className="rounded-xl bg-white p-5 shadow-sm" aria-label="購物車"><div className="flex items-center gap-2"><ShoppingCart size={20} /><h2 className="text-xl font-bold">購物車</h2></div>{cartItems.length === 0 ? <p className="mt-4 text-sm text-slate-500">購物車目前是空的。</p> : <><div className="mt-4 space-y-3">{cartItems.map(item => <div key={item.safeProductReference} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><div><b>{item.name}</b><p className="text-xs text-slate-500">{money(item.priceAmountMinor, item.currencyCode)} / 件</p></div><div className="flex items-center gap-2"><button onClick={() => setQuantity(item.safeProductReference, item.quantity - 1)} className="rounded border border-slate-300 p-1" aria-label={`減少 ${item.name} 數量`}><Minus size={15} /></button><span className="min-w-6 text-center text-sm font-bold">{item.quantity}</span><button onClick={() => setQuantity(item.safeProductReference, item.quantity + 1)} className="rounded border border-slate-300 p-1" aria-label={`增加 ${item.name} 數量`}><Plus size={15} /></button></div></div>)}</div><div className="mt-4 flex items-center justify-between"><div><span className="text-sm text-slate-500">畫面估算</span><p className="font-bold">{money(cartTotal, 'TWD')}</p><small className="text-slate-500">訂單金額以伺服器建立結果為準。</small></div><button disabled={state.busy === 'order'} onClick={createOrder} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{state.busy === 'order' ? '建立中…' : '建立訂單'}</button></div></>}</section>
    <section aria-label="我的訂單"><h2 className="text-xl font-bold">我的訂單</h2>{state.orders.length === 0 ? <p className="mt-4 rounded-xl bg-white p-5 text-sm text-slate-500">目前尚無訂單。</p> : <div className="mt-4 space-y-3">{state.orders.map(order => <button type="button" key={order.safeOrderReference} onClick={() => openOrder(order.safeOrderReference)} className="w-full rounded-xl bg-white p-4 text-left shadow-sm"><div className="flex justify-between gap-3"><b className="break-all text-sm">{order.safeOrderReference}</b><span className="whitespace-nowrap font-bold">{money(order.totalAmountMinor, order.currencyCode)}</span></div><p className="mt-2 text-xs text-slate-500">{statusLabel(order.status)} · {statusLabel(order.paymentStatus)} · {dateTime(order.createdAt)}</p></button>)}</div>}</section>
    {state.selectedOrder && <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="訂單明細"><h2 className="text-xl font-bold">訂單明細</h2><p className="mt-1 break-all text-xs text-slate-500">{state.selectedOrder.safeOrderReference}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><span className="text-slate-500">訂單狀態</span><p className="font-bold">{statusLabel(state.selectedOrder.status)}</p></div><div><span className="text-slate-500">付款狀態</span><p className="font-bold">{statusLabel(state.selectedOrder.paymentStatus)}</p></div><div><span className="text-slate-500">建立時間</span><p>{dateTime(state.selectedOrder.createdAt)}</p></div><div><span className="text-slate-500">付款時間</span><p>{dateTime(state.selectedOrder.paidAt)}</p></div></div><div className="mt-5 space-y-2">{(state.selectedOrder.items || []).map((item, index) => <div key={`${item.sku}-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between gap-3"><b>{item.name}</b><span>{money(item.lineAmountMinor, item.currencyCode)}</span></div><p className="mt-1 text-xs text-slate-500">{money(item.unitAmountMinor, item.currencyCode)} × {item.quantity}</p></div>)}</div><div className="mt-5 flex flex-wrap gap-2">{!['PAID', 'CANCELLED'].includes(state.selectedOrder.paymentStatus) && <button disabled={Boolean(state.busy)} onClick={() => pay(state.selectedOrder)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{state.busy === 'payment' ? '準備付款中…' : state.selectedOrder.paymentStatus === 'FAILED' ? '重新付款' : '前往付款'}</button>}{!['PAID', 'CANCELLED'].includes(state.selectedOrder.paymentStatus) && <button disabled={Boolean(state.busy)} onClick={() => cancelOrder(state.selectedOrder)} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50">取消訂單</button>}{state.selectedOrder.paymentStatus === 'PAID' && <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800"><CheckCircle2 size={17} />付款已完成</span>}{state.selectedOrder.paymentStatus === 'CANCELLED' && <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600"><XCircle size={17} />訂單已取消</span>}<button onClick={() => confirmPayment(state.selectedOrder.safeOrderReference)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">重新確認付款狀態</button></div><h3 className="mt-6 font-bold">付款紀錄</h3>{state.payments.length === 0 ? <p className="mt-2 text-sm text-slate-500">尚無付款紀錄。</p> : <div className="mt-2 space-y-2">{state.payments.map((payment, index) => <div key={`${payment.createdAt}-${index}`} className="rounded-lg border border-slate-100 p-3 text-sm"><div className="flex justify-between"><b>{statusLabel(payment.status)}</b><span>{payment.amountMinor == null ? '—' : money(payment.amountMinor, payment.currencyCode)}</span></div><p className="mt-1 text-xs text-slate-500">{dateTime(payment.createdAt)}{payment.safeErrorCode ? ` · ${payment.safeErrorCode}` : ''}</p></div>)}</div>}</section>}
  </div>;
}

export default function LiffCommercePage() {
  const [state, setState] = useState({ loading: true, auth: null, error: '' });
  useEffect(() => { let active = true; (async () => {
    const initial = referralContextFromLocation();
    if (!initial.lineAccountId) { if (active) setState({ loading: false, auth: null, error: '找不到 LINE 官方帳號設定。' }); return; }
    try {
      const bootstrapResponse = await api(`/api/member/referral/bootstrap?lineAccountId=${encodeURIComponent(initial.lineAccountId)}`);
      const bootstrap = await bootstrapResponse.json();
      if (!bootstrapResponse.ok || !bootstrap?.success || !usableLiffConfig(bootstrap.config)) throw new Error('商城尚未完成 LIFF 設定。');
      const liff = await loadLiffSdk(); await liff.init({ liffId: bootstrap.config.liffId });
      if (!liff.isLoggedIn()) { liff.login(); return; }
      const accessToken = liff.getAccessToken(); if (!accessToken) throw new Error('無法取得 LINE 登入權杖。');
      const context = referralContextFromLocation();
      const establishResponse = await api('/api/member/establish', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lineAccountId: context.lineAccountId, liffAccessToken: accessToken }) });
      const establish = await establishResponse.json(); if (!establishResponse.ok || !establish?.success) throw new Error('會員身分確認失敗。');
      if (active) setState({ loading: false, auth: { lineAccountId: context.lineAccountId, accessToken }, error: '' });
    } catch (error) { if (active) setState({ loading: false, auth: null, error: error?.message || '商城暫時無法使用。' }); }
  })(); return () => { active = false; }; }, []);
  if (state.loading) return <main className="flex min-h-screen items-center justify-center gap-2 bg-slate-50 text-slate-600"><Loader2 size={20} className="animate-spin" />正在驗證會員身分…</main>;
  if (!state.auth) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><section className="max-w-md rounded-2xl bg-white p-6 text-center shadow"><h1 className="text-xl font-bold">商城暫時無法使用</h1><p className="mt-3 text-sm text-slate-600">{state.error}</p></section></main>;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900"><div className="mx-auto max-w-3xl"><header className="mb-6 flex items-center gap-3"><span className="rounded-xl bg-slate-900 p-3 text-white"><ShoppingBag size={24} /></span><div><h1 className="text-2xl font-bold">商城</h1><p className="text-sm text-slate-500">選購商品並查看自己的訂單。</p></div></header><Storefront auth={state.auth} /></div></main>;
}
