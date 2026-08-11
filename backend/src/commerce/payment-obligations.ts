export const COMMERCE_PAYMENT_LEGS = ['FULL', 'DEPOSIT', 'BALANCE'] as const;
export type CommercePaymentLeg = typeof COMMERCE_PAYMENT_LEGS[number];

export type CommercePaymentObligationInput = {
  paymentLeg: CommercePaymentLeg;
  amountMinor: number;
};

type ObligationRow = {
  id: string;
  workspace_id: string;
  order_id: string;
  payment_leg: CommercePaymentLeg;
  amount_minor: number;
  currency_code: 'TWD';
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  paid_amount_minor: number;
  paid_at: string | null;
};

type OrderPaymentRow = {
  id: string;
  total_amount_minor: number;
  status: string;
  payment_status: string;
};

const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

function positiveTwdAmount(value: unknown, code = 'COMMERCE_PAYMENT_OBLIGATION_AMOUNT_INVALID') {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100000000) throw new Error(code);
  return Number(value);
}

export function commercePaymentLeg(value: unknown): CommercePaymentLeg {
  const leg = String(value || '').trim().toUpperCase();
  if (!COMMERCE_PAYMENT_LEGS.includes(leg as CommercePaymentLeg)) throw new Error('COMMERCE_PAYMENT_LEG_INVALID');
  return leg as CommercePaymentLeg;
}

export function paymentObligationPlan(
  orderTotalAmountMinor: number,
  requested?: readonly CommercePaymentObligationInput[],
): CommercePaymentObligationInput[] {
  const total = positiveTwdAmount(orderTotalAmountMinor, 'COMMERCE_ORDER_TOTAL_INVALID');
  if (requested === undefined) return [{ paymentLeg: 'FULL', amountMinor: total }];
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 2) throw new Error('COMMERCE_PAYMENT_OBLIGATIONS_INVALID');

  const byLeg = new Map<CommercePaymentLeg, number>();
  for (const item of requested) {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['paymentLeg', 'amountMinor'].includes(key))) {
      throw new Error('COMMERCE_PAYMENT_OBLIGATIONS_INVALID');
    }
    const leg = commercePaymentLeg(item.paymentLeg);
    if (byLeg.has(leg)) throw new Error('COMMERCE_PAYMENT_OBLIGATIONS_INVALID');
    byLeg.set(leg, positiveTwdAmount(item.amountMinor));
  }

  if (byLeg.size === 1 && byLeg.get('FULL') === total) return [{ paymentLeg: 'FULL', amountMinor: total }];
  if (byLeg.size !== 2 || !byLeg.has('DEPOSIT') || !byLeg.has('BALANCE') || byLeg.has('FULL')) {
    throw new Error('COMMERCE_PAYMENT_OBLIGATIONS_INVALID');
  }
  const deposit = Number(byLeg.get('DEPOSIT'));
  const balance = Number(byLeg.get('BALANCE'));
  if (deposit + balance !== total) throw new Error('COMMERCE_PAYMENT_OBLIGATION_TOTAL_MISMATCH');
  return [
    { paymentLeg: 'DEPOSIT', amountMinor: deposit },
    { paymentLeg: 'BALANCE', amountMinor: balance },
  ];
}

export function paymentObligationInsertStatements(db: D1Database, input: {
  workspaceId: string;
  orderId: string;
  orderTotalAmountMinor: number;
  requested?: readonly CommercePaymentObligationInput[];
  createdAt: string;
}): D1PreparedStatement[] {
  return paymentObligationPlan(input.orderTotalAmountMinor, input.requested).map(obligation => db.prepare(`
    INSERT INTO commerce_order_payment_obligations(
      id,workspace_id,order_id,payment_leg,amount_minor,currency_code,status,paid_amount_minor,created_at
    ) VALUES(?,?,?,?,?,'TWD','PENDING',0,?)
  `).bind(makeId('cpo'), input.workspaceId, input.orderId, obligation.paymentLeg, obligation.amountMinor, input.createdAt));
}

async function obligationRows(db: D1Database, workspaceId: string, orderId: string) {
  const result = await db.prepare(`
    SELECT id,workspace_id,order_id,payment_leg,amount_minor,currency_code,status,paid_amount_minor,paid_at
    FROM commerce_order_payment_obligations
    WHERE workspace_id=? AND order_id=?
    ORDER BY CASE payment_leg WHEN 'FULL' THEN 0 WHEN 'DEPOSIT' THEN 1 ELSE 2 END
  `).bind(workspaceId, orderId).all<ObligationRow>();
  return result.results || [];
}

export async function ensureLegacyFullPaymentObligation(db: D1Database, input: {
  workspaceId: string;
  orderId: string;
  orderTotalAmountMinor: number;
  createdAt: string;
}) {
  let existing = await obligationRows(db, input.workspaceId, input.orderId);
  if (existing.length === 0) {
    await db.prepare(`
      INSERT INTO commerce_order_payment_obligations(
        id,workspace_id,order_id,payment_leg,amount_minor,currency_code,status,paid_amount_minor,created_at
      ) VALUES(?,?,?,?,?,'TWD','PENDING',0,?)
      ON CONFLICT(workspace_id,order_id,payment_leg) DO NOTHING
    `).bind(makeId('cpo'), input.workspaceId, input.orderId, 'FULL', positiveTwdAmount(input.orderTotalAmountMinor), input.createdAt).run();
    existing = await obligationRows(db, input.workspaceId, input.orderId);
  }
  if (existing.length !== 1 || existing[0].payment_leg !== 'FULL' || Number(existing[0].amount_minor) !== Number(input.orderTotalAmountMinor)) {
    throw new Error('COMMERCE_PAYMENT_LEG_REQUIRED');
  }
  return existing[0];
}

export async function readPaymentObligation(db: D1Database, input: {
  workspaceId: string;
  orderId: string;
  paymentLeg: CommercePaymentLeg;
}) {
  return db.prepare(`
    SELECT id,workspace_id,order_id,payment_leg,amount_minor,currency_code,status,paid_amount_minor,paid_at
    FROM commerce_order_payment_obligations
    WHERE workspace_id=? AND order_id=? AND payment_leg=? LIMIT 1
  `).bind(input.workspaceId, input.orderId, input.paymentLeg).first<ObligationRow>();
}

export async function requirePayableObligation(db: D1Database, input: {
  workspaceId: string;
  orderId: string;
  paymentLeg: CommercePaymentLeg;
}) {
  const obligation = await readPaymentObligation(db, input);
  if (!obligation) throw new Error('COMMERCE_PAYMENT_OBLIGATION_NOT_FOUND');
  if (obligation.status === 'PAID') throw new Error('COMMERCE_PAYMENT_OBLIGATION_PAID');
  if (obligation.status === 'CANCELLED') throw new Error('COMMERCE_PAYMENT_OBLIGATION_CANCELLED');
  if (input.paymentLeg === 'BALANCE') {
    const deposit = await readPaymentObligation(db, { ...input, paymentLeg: 'DEPOSIT' });
    if (!deposit || deposit.status !== 'PAID') throw new Error('COMMERCE_PAYMENT_LEG_NOT_READY');
  }
  return obligation;
}

export async function applyVerifiedPaymentLeg(db: D1Database, input: {
  workspaceId: string;
  orderId: string;
  paymentIntentId: string;
  paymentLeg: CommercePaymentLeg;
  verifiedAmountMinor: number;
  paidAt: string;
  transactionStatement: D1PreparedStatement;
}) {
  const order = await db.prepare(`
    SELECT id,total_amount_minor,status,payment_status
    FROM commerce_orders WHERE workspace_id=? AND id=? LIMIT 1
  `).bind(input.workspaceId, input.orderId).first<OrderPaymentRow>();
  if (!order) throw new Error('COMMERCE_ORDER_NOT_FOUND');

  let obligation = await readPaymentObligation(db, input);
  const legacyFullObligationId = !obligation && input.paymentLeg === 'FULL' ? makeId('cpo') : null;
  if (!obligation && legacyFullObligationId) {
    obligation = {
      id: legacyFullObligationId,
      workspace_id: input.workspaceId,
      order_id: input.orderId,
      payment_leg: 'FULL',
      amount_minor: Number(order.total_amount_minor),
      currency_code: 'TWD',
      status: 'PENDING',
      paid_amount_minor: 0,
      paid_at: null,
    };
  }
  if (!obligation) throw new Error('COMMERCE_PAYMENT_OBLIGATION_NOT_FOUND');
  if (Number(obligation.amount_minor) !== positiveTwdAmount(input.verifiedAmountMinor)) {
    throw new Error('COMMERCE_PAYMENT_CALLBACK_MISMATCH');
  }
  if (input.paymentLeg === 'BALANCE') {
    const deposit = await readPaymentObligation(db, { ...input, paymentLeg: 'DEPOSIT' });
    if (!deposit || deposit.status !== 'PAID') throw new Error('COMMERCE_PAYMENT_LEG_NOT_READY');
  }

  const statements: D1PreparedStatement[] = [input.transactionStatement];
  if (legacyFullObligationId) {
    statements.push(db.prepare(`
      INSERT INTO commerce_order_payment_obligations(
        id,workspace_id,order_id,payment_leg,amount_minor,currency_code,status,paid_amount_minor,created_at
      ) VALUES(?,?,?,?,?,'TWD','PENDING',0,?)
      ON CONFLICT(workspace_id,order_id,payment_leg) DO NOTHING
    `).bind(legacyFullObligationId, input.workspaceId, input.orderId, 'FULL', Number(order.total_amount_minor), input.paidAt));
  }
  if (obligation.status !== 'PAID') {
    if (obligation.status === 'CANCELLED') throw new Error('COMMERCE_PAYMENT_OBLIGATION_CANCELLED');
    statements.push(db.prepare(`
      UPDATE commerce_order_payment_obligations
      SET status='PAID',paid_amount_minor=amount_minor,paid_at=?
      WHERE id=? AND workspace_id=? AND order_id=? AND payment_leg=? AND status='PENDING'
    `).bind(input.paidAt, obligation.id, input.workspaceId, input.orderId, input.paymentLeg));
  }
  statements.push(
    db.prepare(`UPDATE commerce_payment_intents SET status='PAID',updated_at=? WHERE id=? AND workspace_id=? AND status<>'PAID'`)
      .bind(input.paidAt, input.paymentIntentId, input.workspaceId),
    db.prepare(`
      UPDATE commerce_orders SET status='PAID',payment_status='PAID',paid_at=COALESCE(paid_at,?),updated_at=?
      WHERE id=? AND workspace_id=? AND payment_status<>'PAID'
        AND EXISTS(
          SELECT 1 FROM commerce_order_payment_obligations o
          WHERE o.workspace_id=? AND o.order_id=?
        )
        AND NOT EXISTS(
          SELECT 1 FROM commerce_order_payment_obligations o
          WHERE o.workspace_id=? AND o.order_id=? AND o.status<>'PAID'
        )
    `).bind(input.paidAt, input.paidAt, input.orderId, input.workspaceId,
      input.workspaceId, input.orderId, input.workspaceId, input.orderId),
  );
  await db.batch(statements);
  const settled = await db.prepare(`SELECT status,payment_status FROM commerce_orders WHERE workspace_id=? AND id=? LIMIT 1`)
    .bind(input.workspaceId, input.orderId).first<{ status: string; payment_status: string }>();
  return { paymentLeg: input.paymentLeg, fullyPaid: settled?.status === 'PAID' && settled?.payment_status === 'PAID' };
}
