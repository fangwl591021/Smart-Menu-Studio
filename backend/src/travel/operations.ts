import { readOperationalState } from './milestones.ts';

const clean = (value: unknown, max = 160) => String(value ?? '').trim().slice(0, max);

export const travelOperationsLimit = (value: unknown) => {
  const parsed = Number(value ?? 25);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;
};

export const travelOperationsPage = (value: unknown) => {
  const parsed = Number(value ?? 1);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 10000) : 1;
};

export type TravelReadinessWarning =
  | 'MIN_GROUP_NOT_REACHED'
  | 'UNPAID_BOOKINGS_EXIST'
  | 'DEPOSIT_ONLY_BOOKINGS_EXIST'
  | 'DEPARTURE_CANCELLED'
  | 'BOOKING_WINDOW_OPEN'
  | 'SOLD_OUT';

export function projectDepartureReadiness(input: {
  departureStatus: string; reservedSeats: number; remainingSeats: number; minGroupSize: number;
  unpaidBookings: number; depositCompletedBookings: number; bookingOpenAt: string; bookingClosesAt: string; now?: Date;
}) {
  const warnings: TravelReadinessWarning[] = [];
  if (input.departureStatus === 'CANCELLED') warnings.push('DEPARTURE_CANCELLED');
  if (input.reservedSeats < input.minGroupSize) warnings.push('MIN_GROUP_NOT_REACHED');
  if (input.unpaidBookings > 0) warnings.push('UNPAID_BOOKINGS_EXIST');
  if (input.depositCompletedBookings > 0) warnings.push('DEPOSIT_ONLY_BOOKINGS_EXIST');
  const timestamp = (input.now || new Date()).toISOString();
  if (timestamp >= input.bookingOpenAt && timestamp <= input.bookingClosesAt) warnings.push('BOOKING_WINDOW_OPEN');
  if (input.departureStatus === 'SOLD_OUT' || input.remainingSeats === 0) warnings.push('SOLD_OUT');
  const state = ['CANCELLED', 'ARCHIVED'].includes(input.departureStatus) ? 'BLOCKED'
    : warnings.some(value => ['MIN_GROUP_NOT_REACHED', 'UNPAID_BOOKINGS_EXIST', 'DEPOSIT_ONLY_BOOKINGS_EXIST'].includes(value)) ? 'ATTENTION' : 'READY';
  return { state: state as 'READY' | 'ATTENTION' | 'BLOCKED', warnings };
}

const paymentStatusSql = `CASE
  WHEN b.booking_status='CANCELLED' THEN 'CANCELLED'
  WHEN o.status='PAID' AND o.payment_status='PAID' THEN 'FULLY_PAID'
  WHEN b.payment_schedule_type_snapshot='DEPOSIT_BALANCE' AND EXISTS (
    SELECT 1 FROM commerce_order_payment_obligations po
    WHERE po.workspace_id=b.workspace_id AND po.order_id=b.order_id AND po.payment_leg='DEPOSIT' AND po.status='PAID'
  ) THEN 'DEPOSIT_COMPLETED'
  ELSE 'UNPAID'
END`;
const safeCustomerLabelSql = `COALESCE(NULLIF(trim(pr.display_name),''),NULLIF(trim(pr.contact_name),''),NULLIF(trim(pr.company_name),''),'會員顧客')`;

async function departureRow(db: D1Database, workspaceId: string, safeDepartureReference: string) {
  const row = await db.prepare(`SELECT d.id,d.public_ref,d.status,d.departure_date,d.return_date,d.booking_opens_at,d.booking_closes_at,
    d.seat_limit,d.min_group_size,i.title itinerary_title
    FROM travel_departures d JOIN travel_itineraries i ON i.workspace_id=d.workspace_id AND i.id=d.itinerary_id
    WHERE d.workspace_id=? AND d.public_ref=? LIMIT 1`).bind(workspaceId, safeDepartureReference).first<any>();
  if (!row) throw new Error('TRAVEL_DEPARTURE_NOT_FOUND');
  return row;
}

export async function readDepartureOperations(db: D1Database, input: { workspaceId: string; safeDepartureReference: string; now?: Date }) {
  const departure = await departureRow(db, input.workspaceId, input.safeDepartureReference);
  const summary: any = await db.prepare(`SELECT COUNT(*) booking_count,
    COALESCE(SUM(CASE WHEN b.booking_status<>'CANCELLED' THEN b.traveler_count ELSE 0 END),0) traveler_count,
    COALESCE(SUM(CASE WHEN b.booking_status='CANCELLED' THEN 1 ELSE 0 END),0) cancelled_bookings,
    COALESCE(SUM(CASE WHEN b.booking_status<>'CANCELLED' AND o.status='PAID' AND o.payment_status='PAID' THEN 1 ELSE 0 END),0) fully_paid_bookings,
    COALESCE(SUM(CASE WHEN b.booking_status<>'CANCELLED' AND NOT (o.status='PAID' AND o.payment_status='PAID')
      AND b.payment_schedule_type_snapshot='DEPOSIT_BALANCE' AND EXISTS (SELECT 1 FROM commerce_order_payment_obligations po
        WHERE po.workspace_id=b.workspace_id AND po.order_id=b.order_id AND po.payment_leg='DEPOSIT' AND po.status='PAID') THEN 1 ELSE 0 END),0) deposit_completed_bookings,
    COALESCE(SUM(CASE WHEN b.booking_status<>'CANCELLED' AND NOT (o.status='PAID' AND o.payment_status='PAID')
      AND NOT (b.payment_schedule_type_snapshot='DEPOSIT_BALANCE' AND EXISTS (SELECT 1 FROM commerce_order_payment_obligations po
        WHERE po.workspace_id=b.workspace_id AND po.order_id=b.order_id AND po.payment_leg='DEPOSIT' AND po.status='PAID')) THEN 1 ELSE 0 END),0) unpaid_bookings
    FROM travel_booking_extensions b JOIN commerce_orders o ON o.workspace_id=b.workspace_id AND o.id=b.order_id
    WHERE b.workspace_id=? AND b.departure_id=?`).bind(input.workspaceId, departure.id).first();
  const seatLimit = Number(departure.seat_limit), reservedSeats = Number(summary?.traveler_count || 0);
  const facts = {
    safeDepartureReference: String(departure.public_ref), itineraryTitle: clean(departure.itinerary_title),
    departureStart: departure.departure_date, departureEnd: departure.return_date,
    bookingOpenAt: departure.booking_opens_at, bookingClosesAt: departure.booking_closes_at,
    departureStatus: String(departure.status), seatLimit, minGroupSize: Number(departure.min_group_size || 1),
    reservedSeats, remainingSeats: Math.max(0, seatLimit - reservedSeats), bookingCount: Number(summary?.booking_count || 0), travelerCount: reservedSeats,
    unpaidBookings: Number(summary?.unpaid_bookings || 0), depositCompletedBookings: Number(summary?.deposit_completed_bookings || 0),
    fullyPaidBookings: Number(summary?.fully_paid_bookings || 0), cancelledBookings: Number(summary?.cancelled_bookings || 0),
  };
  const operationalState = await readOperationalState(db, input.workspaceId, String(departure.id));
  return { ...facts, readiness: projectDepartureReadiness({ ...facts, now: input.now }), operationalState };
}

export async function listDepartureOperationBookings(db: D1Database, input: { workspaceId: string; safeDepartureReference: string; limit?: unknown; page?: unknown }) {
  const departure = await departureRow(db, input.workspaceId, input.safeDepartureReference), limit = travelOperationsLimit(input.limit), page = travelOperationsPage(input.page), offset = (page - 1) * limit;
  const rows = (await db.prepare(`SELECT b.public_ref,${safeCustomerLabelSql} safe_customer_label,b.booking_status,
    ${paymentStatusSql} payment_status,b.traveler_count,sc.seller_label_snapshot,b.created_at
    FROM travel_booking_extensions b JOIN commerce_orders o ON o.workspace_id=b.workspace_id AND o.id=b.order_id
    JOIN crm_people cp ON cp.workspace_id=b.workspace_id AND cp.id=b.customer_crm_person_id LEFT JOIN crm_profiles pr ON pr.crm_person_id=cp.id
    LEFT JOIN travel_booking_seller_contexts sc ON sc.workspace_id=b.workspace_id AND sc.booking_id=b.id
    WHERE b.workspace_id=? AND b.departure_id=? ORDER BY b.created_at ASC,b.id ASC LIMIT ? OFFSET ?`)
    .bind(input.workspaceId, departure.id, limit, offset).all<any>()).results || [];
  return { limit, page, bookings: rows.map(row => ({ safeBookingReference: String(row.public_ref), safeCustomerLabel: clean(row.safe_customer_label, 120) || '會員顧客',
    bookingStatus: String(row.booking_status), paymentStatus: String(row.payment_status), travelerCount: Number(row.traveler_count),
    safeSellerLabel: row.seller_label_snapshot ? clean(row.seller_label_snapshot, 120) : null, createdAt: row.created_at })) };
}

export async function listDepartureOperationTravelers(db: D1Database, input: { workspaceId: string; safeDepartureReference: string; limit?: unknown; page?: unknown }) {
  const departure = await departureRow(db, input.workspaceId, input.safeDepartureReference), limit = travelOperationsLimit(input.limit), page = travelOperationsPage(input.page), offset = (page - 1) * limit;
  const rows = (await db.prepare(`SELECT b.public_ref booking_ref,t.sequence_no,t.display_name,t.traveler_type,t.phone,t.note
    FROM travel_booking_travelers t JOIN travel_booking_extensions b ON b.workspace_id=t.workspace_id AND b.id=t.booking_id
    WHERE t.workspace_id=? AND b.departure_id=? AND b.booking_status<>'CANCELLED'
    ORDER BY b.created_at ASC,b.id ASC,t.sequence_no ASC LIMIT ? OFFSET ?`).bind(input.workspaceId, departure.id, limit, offset).all<any>()).results || [];
  return { limit, page, travelers: rows.map(row => ({ safeBookingReference: String(row.booking_ref), sequence: Number(row.sequence_no),
    displayName: clean(row.display_name, 120), travelerType: String(row.traveler_type), phone: clean(row.phone, 40), note: clean(row.note, 500) })) };
}

const eventLabels: Record<string, string> = {
  DEPARTURE_CREATED: '出發日已建立', DEPARTURE_OPENED: '出發日開放報名', DEPARTURE_CLOSED: '出發日停止報名',
  DEPARTURE_CANCELLED: '出發日已取消', DEPARTURE_ARCHIVED: '出發日已封存', BOOKING_CREATED: '報名訂單已建立',
  DEPOSIT_PAID: '訂金已付款', BALANCE_PAID: '尾款已付款', FULL_PAYMENT_PAID: '全額已付款',
  BOOKING_CONFIRMED: '報名訂單已確認', BOOKING_CANCELLED: '報名訂單已取消',
  OPERATION_CONFIRMED: '出發日作業已確認', SERVICE_COMPLETED: '旅遊服務已完成',
};
export async function listDepartureOperationEvents(db: D1Database, input: { workspaceId: string; safeDepartureReference: string; limit?: unknown }) {
  const departure = await departureRow(db, input.workspaceId, input.safeDepartureReference), limit = travelOperationsLimit(input.limit);
  const rows = (await db.prepare(`SELECT event_type,occurred_at FROM (
      SELECT event_type,occurred_at,0 source_order,id tie_break FROM travel_events
      WHERE workspace_id=? AND departure_id=?
      UNION ALL
      SELECT event_type,occurred_at,1 source_order,id tie_break FROM travel_operation_events
      WHERE workspace_id=? AND departure_id=?
    ) ORDER BY occurred_at ASC,source_order ASC,tie_break ASC LIMIT ?`)
    .bind(input.workspaceId, departure.id, input.workspaceId, departure.id, limit).all<any>()).results || [];
  return { limit, events: rows.map(row => ({ eventType: clean(row.event_type, 60), safeEventLabel: eventLabels[String(row.event_type)] || '旅遊狀態更新', occurredAt: row.occurred_at || null })) };
}
