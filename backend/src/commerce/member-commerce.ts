import { cancelOrder, createOrder, initiatePayment } from './commerce';

export type MemberCommerceContext = {
  workspaceId: string;
  lineAccountId: string;
  lineMemberId: string;
  crmPersonId?: string;
};

const rows = async (statement: any) => ((await statement.all()).results || []);
const first = async (statement: any) => statement.first();

function publicProduct(row: any) {
  return {
    safeProductReference: String(row.public_ref),
    name: String(row.name),
    description: String(row.description || ''),
    priceAmountMinor: Number(row.price_amount_minor),
    currencyCode: String(row.currency_code),
  };
}

function publicOrderSummary(row: any) {
  return {
    safeOrderReference: String(row.public_ref),
    status: String(row.status),
    paymentStatus: String(row.payment_status),
    totalAmountMinor: Number(row.total_amount_minor),
    currencyCode: String(row.currency_code),
    createdAt: row.created_at,
    paidAt: row.paid_at || null,
  };
}

function publicOrder(row: any, items: any[] = [], latestPayment: any = null) {
  return {
    safeOrderReference: String(row.public_ref),
    status: String(row.status),
    paymentStatus: String(row.payment_status),
    subtotalAmountMinor: Number(row.subtotal_amount_minor),
    discountAmountMinor: Number(row.discount_amount_minor),
    totalAmountMinor: Number(row.total_amount_minor),
    currencyCode: String(row.currency_code),
    createdAt: row.created_at,
    paidAt: row.paid_at || null,
    cancelledAt: row.cancelled_at || null,
    items: items.map(item => ({
      sku: String(item.sku_snapshot),
      name: String(item.name_snapshot),
      unitAmountMinor: Number(item.unit_amount_minor),
      quantity: Number(item.quantity),
      lineAmountMinor: Number(item.line_amount_minor),
      currencyCode: String(item.currency_code),
    })),
    latestPayment: latestPayment ? publicPayment(latestPayment) : null,
  };
}

function publicPayment(row: any) {
  return {
    provider: String(row.provider),
    status: String(row.status),
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    currencyCode: row.currency_code || null,
    safeErrorCode: row.safe_failure_code || null,
    createdAt: row.created_at,
    paidAt: row.paid_at || null,
  };
}

const ownerJoin = `JOIN commerce_order_member_owners own
  ON own.order_id=o.id AND own.workspace_id=o.workspace_id
  WHERE own.workspace_id=? AND own.line_account_id=? AND own.line_member_id=?`;

async function ownOrderRow(db: any, context: MemberCommerceContext, safeOrderReference: string) {
  const order = await first(db.prepare(`SELECT o.* FROM commerce_orders o ${ownerJoin} AND o.public_ref=? LIMIT 1`)
    .bind(context.workspaceId, context.lineAccountId, context.lineMemberId, safeOrderReference));
  if (!order) throw new Error('COMMERCE_ORDER_NOT_FOUND');
  return order;
}

export async function listMemberProducts(db: any, context: MemberCommerceContext) {
  return (await rows(db.prepare(`SELECT public_ref,name,description,price_amount_minor,currency_code
    FROM commerce_products WHERE workspace_id=? AND status='ACTIVE' ORDER BY updated_at DESC,id DESC`)
    .bind(context.workspaceId))).map(publicProduct);
}

export async function readMemberProduct(db: any, context: MemberCommerceContext, safeProductReference: string) {
  const product = await first(db.prepare(`SELECT public_ref,name,description,price_amount_minor,currency_code
    FROM commerce_products WHERE workspace_id=? AND public_ref=? AND status='ACTIVE' LIMIT 1`)
    .bind(context.workspaceId, safeProductReference));
  if (!product) throw new Error('COMMERCE_PRODUCT_NOT_FOUND');
  return publicProduct(product);
}

export async function createMemberOrder(db: any, context: MemberCommerceContext, body: unknown) {
  if (!context.crmPersonId) throw new Error('COMMERCE_MEMBER_CUSTOMER_REQUIRED');
  return createOrder(db, {
    workspaceId: context.workspaceId,
    userId: null,
    body,
    memberOwner: {
      lineAccountId: context.lineAccountId,
      lineMemberId: context.lineMemberId,
      crmPersonId: context.crmPersonId,
    },
  });
}

export async function listMemberOrders(db: any, context: MemberCommerceContext) {
  const orders = await rows(db.prepare(`SELECT o.* FROM commerce_orders o ${ownerJoin} ORDER BY o.created_at DESC,o.id DESC`)
    .bind(context.workspaceId, context.lineAccountId, context.lineMemberId));
  return orders.map((order: any) => publicOrderSummary(order));
}

export async function readMemberOrder(db: any, context: MemberCommerceContext, safeOrderReference: string) {
  const order: any = await ownOrderRow(db, context, safeOrderReference);
  const [items, latestPayment] = await Promise.all([
    rows(db.prepare(`SELECT sku_snapshot,name_snapshot,unit_amount_minor,quantity,line_amount_minor,currency_code
      FROM commerce_order_items WHERE workspace_id=? AND order_id=? ORDER BY created_at,id`).bind(context.workspaceId, order.id)),
    first(db.prepare(`SELECT provider,status,amount_minor,currency_code,safe_failure_code,created_at,paid_at
      FROM commerce_payment_transactions WHERE workspace_id=? AND order_id=? ORDER BY created_at DESC,id DESC LIMIT 1`).bind(context.workspaceId, order.id)),
  ]);
  return publicOrder(order, items, latestPayment);
}

export async function listMemberOrderPayments(db: any, context: MemberCommerceContext, safeOrderReference: string) {
  const order: any = await ownOrderRow(db, context, safeOrderReference);
  return (await rows(db.prepare(`SELECT provider,status,amount_minor,currency_code,safe_failure_code,created_at,paid_at
    FROM commerce_payment_transactions WHERE workspace_id=? AND order_id=? ORDER BY created_at DESC,id DESC`)
    .bind(context.workspaceId, order.id))).map(publicPayment);
}

export async function memberPaymentStatus(db: any, context: MemberCommerceContext, safeOrderReference: string) {
  const order: any = await ownOrderRow(db, context, safeOrderReference);
  const latest = await first(db.prepare(`SELECT provider,status,amount_minor,currency_code,safe_failure_code,created_at,paid_at
    FROM commerce_payment_transactions WHERE workspace_id=? AND order_id=? ORDER BY created_at DESC,id DESC LIMIT 1`)
    .bind(context.workspaceId, order.id));
  return {
    safeOrderReference: String(order.public_ref),
    orderStatus: String(order.status),
    paymentStatus: String(order.payment_status),
    paidAt: order.paid_at || null,
    latestPayment: latest ? publicPayment(latest) : null,
  };
}

export async function initiateMemberPayment(db: any, context: MemberCommerceContext, input: any) {
  await ownOrderRow(db, context, input.safeOrderReference);
  return initiatePayment(db, {
    workspaceId: context.workspaceId,
    reference: input.safeOrderReference,
    body: input.body,
    env: input.env,
    notifyUrl: input.notifyUrl,
  });
}

export async function cancelMemberOrder(db: any, context: MemberCommerceContext, safeOrderReference: string) {
  await ownOrderRow(db, context, safeOrderReference);
  return cancelOrder(db, { workspaceId: context.workspaceId, reference: safeOrderReference });
}
