const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const publicRef = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const rows = async (statement: any) => ((await statement.all()).results || []);

function safeReference(value: unknown) {
  const reference = String(value || '').trim().slice(0, 100);
  if (!reference) throw new Error('COMMERCE_CONVERSION_REFERENCE_REQUIRED');
  return reference;
}

function conversionView(row: any) {
  return {
    safeConversionReference: String(row.public_ref),
    conversionType: 'ORDER_PAID',
    occurredAt: String(row.occurred_at),
    amountMinor: Number(row.amount_minor),
    currencyCode: 'TWD',
    safeOrderReference: String(row.order_public_ref),
    customerLabel: String(row.customer_label_snapshot),
    attributionSummaries: [],
  };
}

export function createPaidOrderConversionStatement(db: any, input: { workspaceId: string; orderId: string; occurredAt: string }) {
  return db.prepare(`INSERT INTO commerce_conversion_events(
      id,public_ref,workspace_id,order_id,crm_person_id,conversion_type,amount_minor,currency_code,source_kind,customer_label_snapshot,occurred_at,created_at
    )
    SELECT ?,?,o.workspace_id,o.id,own.crm_person_id,'ORDER_PAID',o.total_amount_minor,o.currency_code,'DIRECT_COMMERCE',
      CASE WHEN own.crm_person_id IS NULL THEN '未連結會員' ELSE '會員顧客' END,?,?
    FROM commerce_orders o
    LEFT JOIN commerce_order_member_owners own ON own.workspace_id=o.workspace_id AND own.order_id=o.id
    WHERE o.workspace_id=? AND o.id=? AND o.status='PAID' AND o.payment_status='PAID'
    ON CONFLICT(workspace_id,order_id) DO NOTHING`)
    .bind(makeId('cv'),publicRef('cnv'),input.occurredAt,input.occurredAt,input.workspaceId,input.orderId);
}

export async function listConversions(db: any, workspaceId: string, options: { limit?: unknown; cursor?: unknown } = {}) {
  const requestedLimit = Number(options.limit);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 25;
  const cursor = options.cursor ? safeReference(options.cursor) : null;
  const base = `SELECT e.public_ref,e.conversion_type,e.amount_minor,e.currency_code,e.customer_label_snapshot,e.occurred_at,o.public_ref order_public_ref
    FROM commerce_conversion_events e
    JOIN commerce_orders o ON o.workspace_id=e.workspace_id AND o.id=e.order_id
    WHERE e.workspace_id=?`;
  const statement = cursor
    ? db.prepare(`${base} AND EXISTS (
        SELECT 1 FROM commerce_conversion_events c
        WHERE c.workspace_id=? AND c.public_ref=?
          AND (e.occurred_at<c.occurred_at OR (e.occurred_at=c.occurred_at AND e.id<c.id))
      ) ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`).bind(workspaceId,workspaceId,cursor,limit+1)
    : db.prepare(`${base} ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`).bind(workspaceId,limit+1);
  const found = await rows(statement);
  const page = found.slice(0,limit);
  return {
    conversions: page.map(conversionView),
    nextCursor: found.length > limit ? String(page[page.length-1].public_ref) : null,
  };
}

export async function readConversion(db: any, workspaceId: string, reference: string) {
  const row: any = await db.prepare(`SELECT e.public_ref,e.conversion_type,e.amount_minor,e.currency_code,e.customer_label_snapshot,e.occurred_at,o.public_ref order_public_ref
    FROM commerce_conversion_events e
    JOIN commerce_orders o ON o.workspace_id=e.workspace_id AND o.id=e.order_id
    WHERE e.workspace_id=? AND e.public_ref=?`).bind(workspaceId,safeReference(reference)).first();
  if (!row) throw new Error('COMMERCE_CONVERSION_NOT_FOUND');
  return conversionView(row);
}
