export type TravelCommerceOfferStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

type TravelCommerceOfferRow = {
  public_ref: string;
  product_kind: 'TRAVEL_DEPARTURE';
  name: string;
  description: string;
  status: TravelCommerceOfferStatus;
  price_amount_minor: number;
  currency_code: 'TWD';
};

const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');

async function sourceDigest(workspaceId: string, sourceReference: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    `commerce-travel-departure-offer\u001f${workspaceId}\u001f${sourceReference}`,
  )));
}

function offerStatus(value: unknown): TravelCommerceOfferStatus {
  const status = String(value || '').trim().toUpperCase();
  if (status !== 'DRAFT' && status !== 'ACTIVE' && status !== 'ARCHIVED') throw new Error('COMMERCE_TRAVEL_OFFER_STATUS_INVALID');
  return status;
}

function price(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100000000) throw new Error('COMMERCE_PRODUCT_PRICE_INVALID');
  return Number(value);
}

function source(value: unknown) {
  const reference = clean(value, 160);
  if (reference.length < 16 || !/^[A-Za-z0-9_-]+$/.test(reference)) throw new Error('COMMERCE_TRAVEL_SOURCE_REFERENCE_INVALID');
  return reference;
}

function view(row: TravelCommerceOfferRow) {
  return {
    safeProductReference: String(row.public_ref),
    productKind: 'TRAVEL_DEPARTURE' as const,
    name: String(row.name),
    description: String(row.description || ''),
    status: row.status,
    priceAmountMinor: Number(row.price_amount_minor),
    currencyCode: 'TWD' as const,
  };
}

export async function resolveCommerceOfferForTravelDeparture(db: D1Database, input: {
  workspaceId: string;
  sourceReference: string;
}) {
  const reference = source(input.sourceReference);
  const row = await db.prepare(`
    SELECT p.public_ref,p.product_kind,p.name,p.description,p.status,p.price_amount_minor,p.currency_code
    FROM commerce_product_sources s
    JOIN commerce_products p ON p.workspace_id=s.workspace_id AND p.id=s.product_id
    WHERE s.workspace_id=? AND s.source_domain='TRAVEL_DEPARTURE' AND s.source_reference=?
      AND p.product_kind='TRAVEL_DEPARTURE'
    LIMIT 1
  `).bind(input.workspaceId, reference).first<TravelCommerceOfferRow>();
  return row ? view(row) : null;
}

export async function ensureCommerceOfferForTravelDeparture(db: D1Database, input: {
  workspaceId: string;
  sourceReference: string;
  title: string;
  description?: string;
  priceAmountMinor: number;
  currencyCode?: 'TWD';
  status: TravelCommerceOfferStatus;
  actorUserId?: string | null;
}) {
  const sourceReference = source(input.sourceReference);
  const title = clean(input.title, 160);
  if (!title) throw new Error('COMMERCE_PRODUCT_NAME_REQUIRED');
  if (input.currencyCode !== undefined && input.currencyCode !== 'TWD') throw new Error('COMMERCE_CURRENCY_UNSUPPORTED');
  const status = offerStatus(input.status);
  const existing = await resolveCommerceOfferForTravelDeparture(db, { workspaceId: input.workspaceId, sourceReference });
  if (existing?.status === 'ARCHIVED' && status !== 'ARCHIVED') throw new Error('COMMERCE_PRODUCT_ARCHIVED');

  const digest = await sourceDigest(input.workspaceId, sourceReference);
  const productId = `cp_travel_${digest.slice(0, 32)}`;
  const sku = `TRAVEL-${digest.slice(0, 24).toUpperCase()}`;
  const timestamp = new Date().toISOString();
  await db.batch([
    db.prepare(`
      INSERT INTO commerce_products(
        id,public_ref,workspace_id,sku,name,description,status,price_amount_minor,currency_code,
        created_by_user_id,updated_by_user_id,created_at,updated_at,archived_at,product_kind
      ) VALUES(?,?,?,?,?,?,?,?,'TWD',?,?,?,?,?,'TRAVEL_DEPARTURE')
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        description=excluded.description,
        status=excluded.status,
        price_amount_minor=excluded.price_amount_minor,
        updated_by_user_id=excluded.updated_by_user_id,
        updated_at=excluded.updated_at,
        archived_at=excluded.archived_at
      WHERE commerce_products.product_kind='TRAVEL_DEPARTURE' AND commerce_products.status<>'ARCHIVED'
    `).bind(
      productId,
      `prd_${crypto.randomUUID()}`,
      input.workspaceId,
      sku,
      title,
      clean(input.description, 2000),
      status,
      price(input.priceAmountMinor),
      input.actorUserId || null,
      input.actorUserId || null,
      timestamp,
      timestamp,
      status === 'ARCHIVED' ? timestamp : null,
    ),
    db.prepare(`
      INSERT INTO commerce_product_sources(id,workspace_id,product_id,source_domain,source_reference,created_at)
      VALUES(?,?,?,'TRAVEL_DEPARTURE',?,?)
      ON CONFLICT(workspace_id,source_domain,source_reference) DO NOTHING
    `).bind(`cps_${crypto.randomUUID().replace(/-/g, '')}`, input.workspaceId, productId, sourceReference, timestamp),
  ]);
  const offer = await resolveCommerceOfferForTravelDeparture(db, { workspaceId: input.workspaceId, sourceReference });
  if (!offer) throw new Error('COMMERCE_TRAVEL_OFFER_ENSURE_FAILED');
  return offer;
}
