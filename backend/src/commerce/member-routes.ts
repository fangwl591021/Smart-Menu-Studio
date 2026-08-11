import {
  cancelMemberOrder,
  createMemberOrder,
  initiateMemberPayment,
  listMemberOrderPayments,
  listMemberOrders,
  listMemberProducts,
  memberPaymentStatus,
  readMemberOrder,
  readMemberProduct,
} from './member-commerce';

const known = /^COMMERCE_[A-Z0-9_]+$/;

function fail(c: any, error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';
  const code = raw === 'MODULE_NOT_ENABLED' ? raw : known.test(raw) ? raw : fallback;
  const status = code === 'MODULE_NOT_ENABLED' ? 403 : code === 'MEMBER_CONTEXT_REQUIRED' ? 401 : code.endsWith('_NOT_FOUND') ? 404 : code.includes('PAID') || code.includes('CANCELLED') ? 409 : 400;
  return c.json({ success: false, error: code }, status);
}

async function memberContext(c: any, deps: any, bindCustomer = false) {
  const verified = await deps.verifiedReferralMember(c, {
    lineAccountId: deps.text(c.req.query('lineAccountId'), 100),
    liffAccessToken: deps.text(c.req.header('Authorization'), 4096).replace(/^Bearer\s+/i, ''),
  }, 'COMMERCE');
  const person = bindCustomer ? await deps.ensureCrmPersonForVerifiedMember(c.env.smart_menu_db, {
    workspaceId: verified.account.workspace_id,
    lineAccountId: verified.account.id,
    lineMemberId: verified.memberId,
  }) : null;
  return {
    workspaceId: String(verified.account.workspace_id),
    lineAccountId: String(verified.account.id),
    lineMemberId: String(verified.memberId),
    ...(person ? { crmPersonId: String(person.id) } : {}),
  };
}

export function registerMemberCommerceRoutes(app: any, deps: any) {
  app.get('/api/member/commerce/products', async (c: any) => {
    try { const context = await memberContext(c, deps); return c.json({ success: true, products: await listMemberProducts(c.env.smart_menu_db, context) }); }
    catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });

  app.get('/api/member/commerce/products/:safeProductReference', async (c: any) => {
    try { const context = await memberContext(c, deps); return c.json({ success: true, product: await readMemberProduct(c.env.smart_menu_db, context, deps.text(c.req.param('safeProductReference'), 100)) }); }
    catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });

  app.post('/api/member/commerce/orders', async (c: any) => {
    try { const context = await memberContext(c, deps, true); const body = await c.req.json().catch(() => ({})); return c.json({ success: true, order: await createMemberOrder(c.env.smart_menu_db, context, body) }, 201); }
    catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });

  app.get('/api/member/commerce/orders', async (c: any) => {
    try { const context = await memberContext(c, deps); return c.json({ success: true, orders: await listMemberOrders(c.env.smart_menu_db, context) }); }
    catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });

  app.get('/api/member/commerce/orders/:safeOrderReference', async (c: any) => {
    try { const context = await memberContext(c, deps); return c.json({ success: true, order: await readMemberOrder(c.env.smart_menu_db, context, deps.text(c.req.param('safeOrderReference'), 100)) }); }
    catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });

  app.post('/api/member/commerce/orders/:safeOrderReference/payment-intents', async (c: any) => {
    try {
      const context = await memberContext(c, deps), body = await c.req.json().catch(() => ({}));
      const notifyUrl = new URL('/api/commerce/payments/newebpay/notify', c.req.url).toString();
      const payment = await initiateMemberPayment(c.env.smart_menu_db, context, { safeOrderReference: deps.text(c.req.param('safeOrderReference'), 100), body, env: c.env, notifyUrl });
      return c.json({ success: true, payment }, 201);
    } catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });

  app.get('/api/member/commerce/orders/:safeOrderReference/payment-status', async (c: any) => {
    try { const context = await memberContext(c, deps); return c.json({ success: true, payment: await memberPaymentStatus(c.env.smart_menu_db, context, deps.text(c.req.param('safeOrderReference'), 100)) }); }
    catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });

  app.get('/api/member/commerce/orders/:safeOrderReference/payments', async (c: any) => {
    try { const context = await memberContext(c, deps); return c.json({ success: true, payments: await listMemberOrderPayments(c.env.smart_menu_db, context, deps.text(c.req.param('safeOrderReference'), 100)) }); }
    catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });

  app.post('/api/member/commerce/orders/:safeOrderReference/cancel', async (c: any) => {
    try { const context = await memberContext(c, deps); return c.json({ success: true, order: await cancelMemberOrder(c.env.smart_menu_db, context, deps.text(c.req.param('safeOrderReference'), 100)) }); }
    catch (error) { return fail(c, error, 'MEMBER_CONTEXT_REQUIRED'); }
  });
}
