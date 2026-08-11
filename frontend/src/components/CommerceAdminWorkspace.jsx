import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Loader2, PackagePlus, RefreshCw, Save, ShoppingBag } from 'lucide-react';

const money = (amount, currency = 'TWD') => currency === 'TWD'
  ? `NT$ ${Number(amount || 0).toLocaleString('zh-TW')}`
  : `${currency} ${Number(amount || 0).toLocaleString('zh-TW')}`;

const dateTime = value => value ? new Date(value).toLocaleString('zh-TW') : '—';
const statusLabel = value => ({
  DRAFT: '草稿', ACTIVE: '上架中', ARCHIVED: '已封存', PENDING_PAYMENT: '待付款',
  PAID: '已付款', CANCELLED: '已取消', PAYMENT_FAILED: '付款失敗', UNPAID: '未付款',
  PENDING: '確認中', FAILED: '失敗', SUCCEEDED: '成功', VERIFICATION_FAILED: '驗證失敗',
}[value] || value || '—');

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.success) throw new Error(body?.error || 'REQUEST_FAILED');
  return body;
}

function ProductEditor({ product, busy, onSave, onClose }) {
  const [form, setForm] = useState(() => product ? {
    name: product.name || '', description: product.description || '',
    priceAmountMinor: String(product.priceAmountMinor || ''), status: product.status || 'DRAFT',
  } : { sku: '', name: '', description: '', priceAmountMinor: '', status: 'DRAFT' });
  const update = event => setForm(value => ({ ...value, [event.target.name]: event.target.value }));
  const submit = event => {
    event.preventDefault();
    const body = {
      ...(product ? {} : { sku: form.sku.trim() }),
      name: form.name.trim(),
      description: form.description.trim(),
      priceAmountMinor: Number(form.priceAmountMinor),
      currencyCode: 'TWD',
      ...(product ? { status: form.status } : {}),
    };
    onSave(body);
  };
  return <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold">{product ? '編輯商品' : '建立商品'}</h3><button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-900">關閉</button></div>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {!product && <label className="text-sm font-medium">SKU<input required name="sku" value={form.sku} onChange={update} maxLength={64} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>}
      <label className="text-sm font-medium">商品名稱<input required name="name" value={form.name} onChange={update} maxLength={160} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium">售價（TWD）<input required name="priceAmountMinor" type="number" min="1" step="1" value={form.priceAmountMinor} onChange={update} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
      {product && <label className="text-sm font-medium">狀態<select name="status" value={form.status} onChange={update} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="DRAFT">草稿</option><option value="ACTIVE">上架中</option></select></label>}
      <label className="text-sm font-medium md:col-span-2">商品說明<textarea name="description" value={form.description} onChange={update} maxLength={2000} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
    </div>
    <button disabled={busy} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Save size={16} />{busy ? '儲存中…' : '儲存商品'}</button>
  </form>;
}

function ProductManagement({ request, canManage }) {
  const [state, setState] = useState({ loading: true, products: [], error: '', editor: null, busy: '' });
  const load = useCallback(async () => {
    setState(value => ({ ...value, loading: true, error: '' }));
    try {
      const body = await readJson(await request('/api/commerce/products'));
      setState(value => ({ ...value, loading: false, products: body.products || [] }));
    } catch { setState(value => ({ ...value, loading: false, error: '目前無法讀取商品資料。' })); }
  }, [request]);
  useEffect(() => { load(); }, [load]);
  const save = async body => {
    const current = state.editor;
    setState(value => ({ ...value, busy: 'save', error: '' }));
    try {
      const path = current ? `/api/commerce/products/${encodeURIComponent(current.safeProductReference)}` : '/api/commerce/products';
      await readJson(await request(path, { method: current ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      setState(value => ({ ...value, editor: null, busy: '' }));
      await load();
    } catch { setState(value => ({ ...value, busy: '', error: '商品未儲存，請確認欄位後再試。' })); }
  };
  const archive = async product => {
    if (!window.confirm(`確定封存「${product.name}」？既有訂單不會被改寫。`)) return;
    setState(value => ({ ...value, busy: product.safeProductReference, error: '' }));
    try {
      await readJson(await request(`/api/commerce/products/${encodeURIComponent(product.safeProductReference)}/archive`, { method: 'POST' }));
      await load();
    } catch { setState(value => ({ ...value, busy: '', error: '商品封存未完成。' })); }
  };
  return <section aria-label="商品管理">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">商品管理</h2><p className="mt-1 text-sm text-slate-500">建立、上架與封存商城商品。</p></div><div className="flex gap-2"><button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"><RefreshCw size={16} />重新整理</button>{canManage && <button onClick={() => setState(value => ({ ...value, editor: false }))} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white"><PackagePlus size={16} />建立商品</button>}</div></div>
    {state.error && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state.error}</p>}
    {state.editor !== null && canManage && <div className="mt-5"><ProductEditor product={state.editor || null} busy={state.busy === 'save'} onSave={save} onClose={() => setState(value => ({ ...value, editor: null }))} /></div>}
    {state.loading ? <p className="mt-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" />正在讀取商品…</p> : <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">SKU / 商品</th><th className="px-4 py-3">售價</th><th className="px-4 py-3">狀態</th><th className="px-4 py-3">更新時間</th><th className="px-4 py-3">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{state.products.map(product => <tr key={product.safeProductReference}><td className="px-4 py-3"><b>{product.name}</b><small className="block text-slate-500">{product.sku}</small></td><td className="px-4 py-3">{money(product.priceAmountMinor, product.currencyCode)}</td><td className="px-4 py-3">{statusLabel(product.status)}</td><td className="px-4 py-3">{dateTime(product.updatedAt)}</td><td className="px-4 py-3"><div className="flex gap-3">{canManage && product.status !== 'ARCHIVED' && <><button onClick={() => setState(value => ({ ...value, editor: product }))} className="font-medium text-blue-700">編輯</button><button disabled={Boolean(state.busy)} onClick={() => archive(product)} className="inline-flex items-center gap-1 font-medium text-red-700 disabled:opacity-50"><Archive size={14} />封存</button></>}</div></td></tr>)}</tbody></table>{state.products.length === 0 && <p className="p-6 text-center text-sm text-slate-500">尚未建立商品。</p>}</div>}
  </section>;
}

function OrderManagement({ request }) {
  const [state, setState] = useState({ loading: true, orders: [], selected: null, payments: [], error: '' });
  const load = useCallback(async () => {
    setState(value => ({ ...value, loading: true, error: '' }));
    try { const body = await readJson(await request('/api/commerce/orders')); setState(value => ({ ...value, loading: false, orders: body.orders || [] })); }
    catch { setState(value => ({ ...value, loading: false, error: '目前無法讀取訂單資料。' })); }
  }, [request]);
  useEffect(() => { load(); }, [load]);
  const open = async order => {
    setState(value => ({ ...value, selected: null, payments: [], error: '' }));
    try {
      const ref = encodeURIComponent(order.safeOrderReference);
      const [detail, history] = await Promise.all([readJson(await request(`/api/commerce/orders/${ref}`)), readJson(await request(`/api/commerce/orders/${ref}/payments`))]);
      setState(value => ({ ...value, selected: detail.order, payments: history.payments || [] }));
    } catch { setState(value => ({ ...value, error: '目前無法讀取訂單明細。' })); }
  };
  return <section aria-label="訂單管理">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">訂單管理</h2><p className="mt-1 text-sm text-slate-500">查看訂單商品快照與安全付款紀錄。</p></div><button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"><RefreshCw size={16} />重新整理</button></div>
    {state.error && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state.error}</p>}
    {state.loading ? <p className="mt-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" />正在讀取訂單…</p> : <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]"><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">訂單編號</th><th className="px-4 py-3">金額</th><th className="px-4 py-3">訂單 / 付款</th><th className="px-4 py-3">建立時間</th></tr></thead><tbody className="divide-y divide-slate-100">{state.orders.map(order => <tr key={order.safeOrderReference} onClick={() => open(order)} className="cursor-pointer hover:bg-slate-50"><td className="px-4 py-3 font-medium">{order.safeOrderReference}</td><td className="px-4 py-3">{money(order.totalAmountMinor, order.currencyCode)}</td><td className="px-4 py-3">{statusLabel(order.status)} / {statusLabel(order.paymentStatus)}</td><td className="px-4 py-3">{dateTime(order.createdAt)}</td></tr>)}</tbody></table>{state.orders.length === 0 && <p className="p-6 text-center text-sm text-slate-500">尚無訂單。</p>}</div><aside className="rounded-xl border border-slate-200 bg-white p-5">{!state.selected ? <p className="text-sm text-slate-500">選擇訂單以查看明細。</p> : <><h3 className="font-bold">訂單明細</h3><p className="mt-1 break-all text-xs text-slate-500">{state.selected.safeOrderReference}</p><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">訂單狀態</dt><dd className="font-medium">{statusLabel(state.selected.status)}</dd></div><div><dt className="text-slate-500">付款狀態</dt><dd className="font-medium">{statusLabel(state.selected.paymentStatus)}</dd></div><div><dt className="text-slate-500">總金額</dt><dd className="font-medium">{money(state.selected.totalAmountMinor, state.selected.currencyCode)}</dd></div><div><dt className="text-slate-500">付款時間</dt><dd className="font-medium">{dateTime(state.selected.paidAt)}</dd></div></dl><h4 className="mt-5 font-bold">商品快照</h4><div className="mt-2 space-y-2">{(state.selected.items || []).map((item, index) => <div key={`${item.sku}-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between gap-3"><b>{item.name}</b><span>{money(item.lineAmountMinor, item.currencyCode)}</span></div><p className="mt-1 text-xs text-slate-500">{item.sku} · {money(item.unitAmountMinor, item.currencyCode)} × {item.quantity}</p></div>)}</div><h4 className="mt-5 font-bold">付款紀錄</h4>{state.payments.length === 0 ? <p className="mt-2 text-sm text-slate-500">尚無付款紀錄。</p> : <div className="mt-2 space-y-2">{state.payments.map((payment, index) => <div key={`${payment.createdAt}-${index}`} className="rounded-lg border border-slate-100 p-3 text-sm"><div className="flex justify-between gap-3"><b>{statusLabel(payment.status)}</b><span>{payment.amountMinor == null ? '—' : money(payment.amountMinor, payment.currencyCode)}</span></div><p className="mt-1 text-xs text-slate-500">{dateTime(payment.createdAt)}{payment.safeFailureCode ? ` · ${payment.safeFailureCode}` : ''}</p></div>)}</div>}</>}</aside></div>}
  </section>;
}

export default function CommerceAdminWorkspace({ request, userRole }) {
  const [tab, setTab] = useState('products');
  const canManage = ['owner', 'admin'].includes(String(userRole || '').toLowerCase());
  return <div className="space-y-6"><header><div className="flex items-center gap-3"><span className="rounded-xl bg-slate-900 p-2 text-white"><ShoppingBag size={22} /></span><div><h1 className="text-2xl font-bold text-slate-900">商城</h1><p className="text-sm text-slate-500">管理商品與訂單；付款狀態以已驗證的伺服器結果為準。</p></div></div><div className="mt-5 flex gap-2 border-b border-slate-200"><button onClick={() => setTab('products')} className={tab === 'products' ? 'border-b-2 border-slate-900 px-4 py-2 text-sm font-bold' : 'px-4 py-2 text-sm text-slate-500'}>商品管理</button><button onClick={() => setTab('orders')} className={tab === 'orders' ? 'border-b-2 border-slate-900 px-4 py-2 text-sm font-bold' : 'px-4 py-2 text-sm text-slate-500'}>訂單管理</button></div></header>{tab === 'products' ? <ProductManagement request={request} canManage={canManage} /> : <OrderManagement request={request} />}</div>;
}
