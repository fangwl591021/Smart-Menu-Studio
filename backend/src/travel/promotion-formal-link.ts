type Row = Record<string, any>;

const UUID_REFERENCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const SAFE_PROMOTION_REFERENCE = new RegExp(`^promotion_${UUID_REFERENCE}$`);
const SAFE_ITINERARY_REFERENCE = new RegExp(`^iti_${UUID_REFERENCE}$`);
const SAFE_DEPARTURE_REFERENCE = new RegExp(`^dep_${UUID_REFERENCE}$`);
const makeId = () => `tpfl_${crypto.randomUUID().replace(/-/g, '')}`;

export type PromotionFormalTravelLink = {
  safeItineraryReference: string;
  itineraryTitle: string;
  itineraryStatus: string;
  safeDepartureReference: string | null;
  departureDate: string | null;
  departureStatus: string | null;
};

export type PromotionLiveTravel = {
  linked: true;
  itinerary: {
    safeItineraryReference: string;
    title: string;
    status: string;
    current: boolean;
  };
  departure: {
    safeDepartureReference: string;
    status: string;
    departureDate: string;
    returnDate: string;
  } | null;
  currentBookability: boolean | null;
  soldOut: boolean | null;
  remainingSeats: number | null;
  authoritativePrice: { amountMinor: number; currencyCode: string } | null;
};

function exactLinkBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TRAVEL_PROMOTION_FORMAL_LINK_INPUT_INVALID');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['safeItineraryReference', 'safeDepartureReference'].includes(key))) {
    throw new Error('TRAVEL_PROMOTION_FORMAL_LINK_INPUT_INVALID');
  }
  if (!('safeItineraryReference' in body) && !('safeDepartureReference' in body)) {
    throw new Error('TRAVEL_PROMOTION_FORMAL_LINK_INPUT_INVALID');
  }
  const itinerary = body.safeItineraryReference === undefined || body.safeItineraryReference === null
    ? null : String(body.safeItineraryReference).trim();
  const departure = body.safeDepartureReference === undefined || body.safeDepartureReference === null
    ? null : String(body.safeDepartureReference).trim();
  if ((itinerary && !SAFE_ITINERARY_REFERENCE.test(itinerary)) || (departure && !SAFE_DEPARTURE_REFERENCE.test(departure))) {
    throw new Error('TRAVEL_PROMOTION_FORMAL_LINK_INPUT_INVALID');
  }
  return { itinerary: itinerary || null, departure: departure || null };
}

async function currentLinkRow(db: D1Database, workspaceId: string, documentId: string) {
  return db.prepare(`SELECT l.*,i.public_ref itinerary_ref,i.title itinerary_title,i.status itinerary_status,
      dep.public_ref departure_ref,dep.departure_date,dep.status departure_status
    FROM travel_promotion_formal_links l
    JOIN travel_itineraries i ON i.workspace_id=l.workspace_id AND i.id=l.itinerary_id
    LEFT JOIN travel_departures dep ON dep.workspace_id=l.workspace_id AND dep.id=l.departure_id
    WHERE l.workspace_id=? AND l.promotion_document_id=? AND l.status='ACTIVE' LIMIT 1`)
    .bind(workspaceId, documentId).first<Row>();
}

const safeLink = (row: Row | null): PromotionFormalTravelLink | null => row ? ({
  safeItineraryReference: String(row.itinerary_ref),
  itineraryTitle: String(row.itinerary_title || ''),
  itineraryStatus: String(row.itinerary_status),
  safeDepartureReference: row.departure_ref ? String(row.departure_ref) : null,
  departureDate: row.departure_date ? String(row.departure_date) : null,
  departureStatus: row.departure_status ? String(row.departure_status) : null,
}) : null;

export async function readPromotionFormalLink(
  db: D1Database,
  input: { workspaceId: string; documentId: string; activeVersionNo: number | null },
) {
  if (!input.activeVersionNo) return null;
  const row = await currentLinkRow(db, input.workspaceId, input.documentId);
  if (!row || Number(row.promotion_version_no) !== input.activeVersionNo) return null;
  return safeLink(row);
}

export async function setPromotionFormalLink(db: D1Database, input: {
  workspaceId: string;
  promotionReference: string;
  userId: string | null;
  body: unknown;
}) {
  if (!SAFE_PROMOTION_REFERENCE.test(input.promotionReference)) throw new Error('TRAVEL_PROMOTION_NOT_FOUND');
  const target = exactLinkBody(input.body);
  const promotion = await db.prepare(`SELECT d.id,d.active_version_no
    FROM travel_promotion_documents d
    JOIN travel_promotion_versions v ON v.workspace_id=d.workspace_id
      AND v.promotion_document_id=d.id AND v.version_no=d.active_version_no AND v.version_status='APPROVED'
    WHERE d.workspace_id=? AND d.public_ref=? AND d.status='ACTIVE' LIMIT 1`)
    .bind(input.workspaceId, input.promotionReference).first<Row>();
  if (!promotion) throw new Error('TRAVEL_PROMOTION_NOT_ACTIVE');

  let itinerary: Row | null = null;
  let departure: Row | null = null;
  if (target.departure) {
    departure = await db.prepare(`SELECT d.id,d.itinerary_id,i.public_ref itinerary_ref
      FROM travel_departures d JOIN travel_itineraries i
        ON i.workspace_id=d.workspace_id AND i.id=d.itinerary_id
      WHERE d.workspace_id=? AND d.public_ref=? LIMIT 1`)
      .bind(input.workspaceId, target.departure).first<Row>();
    if (!departure) throw new Error('TRAVEL_PROMOTION_FORMAL_LINK_TARGET_NOT_FOUND');
  }
  if (target.itinerary) {
    itinerary = await db.prepare(`SELECT id,public_ref FROM travel_itineraries WHERE workspace_id=? AND public_ref=? LIMIT 1`)
      .bind(input.workspaceId, target.itinerary).first<Row>();
    if (!itinerary) throw new Error('TRAVEL_PROMOTION_FORMAL_LINK_TARGET_NOT_FOUND');
  } else if (departure) {
    itinerary = { id: departure.itinerary_id, public_ref: departure.itinerary_ref };
  }
  if (departure && itinerary && departure.itinerary_id !== itinerary.id) {
    throw new Error('TRAVEL_PROMOTION_FORMAL_LINK_TARGET_MISMATCH');
  }

  const current = await currentLinkRow(db, input.workspaceId, String(promotion.id));
  if (current && Number(current.promotion_version_no) === Number(promotion.active_version_no)
    && String(current.itinerary_id) === String(itinerary?.id || '')
    && String(current.departure_id || '') === String(departure?.id || '')) {
    return safeLink(current);
  }

  const statements: D1PreparedStatement[] = [];
  if (current) statements.push(db.prepare(`UPDATE travel_promotion_formal_links
    SET status='REMOVED',removed_by_user_id=?,removed_at=CURRENT_TIMESTAMP
    WHERE workspace_id=? AND id=? AND status='ACTIVE'`).bind(input.userId, input.workspaceId, current.id));
  if (itinerary) statements.push(db.prepare(`INSERT INTO travel_promotion_formal_links
    (id,workspace_id,promotion_document_id,promotion_version_no,itinerary_id,departure_id,created_by_user_id)
    VALUES(?,?,?,?,?,?,?)`).bind(makeId(), input.workspaceId, promotion.id, promotion.active_version_no,
      itinerary.id, departure?.id || null, input.userId));
  if (statements.length) await db.batch(statements);
  if (!itinerary) return null;
  return safeLink(await currentLinkRow(db, input.workspaceId, String(promotion.id)));
}

type ItineraryAuthorityView = { safeItineraryReference: string; title: string; status: string };
type DepartureAuthorityView = {
  safeDepartureReference: string; status: string; departureDate: string; returnDate: string;
  bookingOpensAt: string; bookingClosesAt: string; remainingSeats: number;
  priceAmountMinor: number; currencyCode: string;
};

export function buildPromotionLiveTravel(itinerary: ItineraryAuthorityView, departure: DepartureAuthorityView | null, now = new Date()): PromotionLiveTravel {
  const itineraryCurrent = itinerary.status === 'PUBLISHED';
  if (!departure) return {
    linked: true,
    itinerary: { safeItineraryReference: itinerary.safeItineraryReference, title: itinerary.title, status: itinerary.status, current: itineraryCurrent },
    departure: null, currentBookability: null, soldOut: null, remainingSeats: null, authoritativePrice: null,
  };
  const timestamp = now.getTime();
  const soldOut = departure.status === 'SOLD_OUT' || departure.remainingSeats <= 0;
  const bookingWindowOpen = timestamp >= Date.parse(departure.bookingOpensAt) && timestamp <= Date.parse(departure.bookingClosesAt);
  const currentBookability = itineraryCurrent && departure.status === 'OPEN' && bookingWindowOpen && !soldOut;
  return {
    linked: true,
    itinerary: { safeItineraryReference: itinerary.safeItineraryReference, title: itinerary.title, status: itinerary.status, current: itineraryCurrent },
    departure: { safeDepartureReference: departure.safeDepartureReference, status: departure.status,
      departureDate: departure.departureDate, returnDate: departure.returnDate },
    currentBookability, soldOut, remainingSeats: departure.remainingSeats,
    authoritativePrice: { amountMinor: departure.priceAmountMinor, currencyCode: departure.currencyCode },
  };
}

export async function readPromotionLiveTravel(db: D1Database, input: {
  workspaceId: string;
  documentId: string;
  activeVersionNo: number;
  now?: Date;
}): Promise<PromotionLiveTravel | null> {
  const row = await currentLinkRow(db, input.workspaceId, input.documentId);
  if (!row || Number(row.promotion_version_no) !== input.activeVersionNo) return null;
  const { readDeparture, readItinerary } = await import('./travel.ts');
  const itinerary = await readItinerary(db, input.workspaceId, String(row.itinerary_ref));
  const departure = row.departure_ref ? await readDeparture(db, input.workspaceId, String(row.departure_ref)) : null;
  return buildPromotionLiveTravel(itinerary, departure, input.now || new Date());
}
