import type { CommercePaymentLeg } from '../commerce/payment-obligations';

const eventId = () => `tre_${crypto.randomUUID().replace(/-/g, '')}`;

/**
 * Projects verified Commerce payment truth into Travel operational state.
 * This intentionally does not check the TRAVEL entitlement: a provider callback
 * must remain able to finish historical payment processing after module disable.
 */
export async function projectTravelPaymentMilestone(db: D1Database, input: {
  workspaceId: string;
  orderId: string;
  paymentLeg: CommercePaymentLeg;
  occurredAt: string;
}) {
  const booking = await db.prepare(`
    SELECT id,departure_id,booking_status
    FROM travel_booking_extensions
    WHERE workspace_id=? AND order_id=? LIMIT 1
  `).bind(input.workspaceId, input.orderId).first<any>();
  if (!booking || booking.booking_status === 'CANCELLED') return { projected: false };

  const obligations = (await db.prepare(`
    SELECT payment_leg,status
    FROM commerce_order_payment_obligations
    WHERE workspace_id=? AND order_id=?
  `).bind(input.workspaceId, input.orderId).all<any>()).results || [];
  const paid = new Set(obligations.filter(row => row.status === 'PAID').map(row => String(row.payment_leg)));
  const fullyPaid = obligations.length > 0 && obligations.every(row => row.status === 'PAID');
  const statements: D1PreparedStatement[] = [];
  const append = (eventType: string) => statements.push(db.prepare(`
    INSERT INTO travel_events(id,workspace_id,departure_id,booking_id,event_type,actor_type,dedupe_key,occurred_at,created_at)
    VALUES(?,?,?,?,?,'SYSTEM',?,?,?)
    ON CONFLICT(workspace_id,dedupe_key) DO NOTHING
  `).bind(eventId(), input.workspaceId, booking.departure_id, booking.id, eventType,
    `payment:${booking.id}:${eventType}`, input.occurredAt, input.occurredAt));

  if (input.paymentLeg === 'FULL' && paid.has('FULL')) append('FULL_PAYMENT_PAID');
  if (input.paymentLeg === 'DEPOSIT' && paid.has('DEPOSIT')) append('DEPOSIT_PAID');
  if (input.paymentLeg === 'BALANCE' && paid.has('BALANCE')) append('BALANCE_PAID');

  let targetStatus = String(booking.booking_status);
  if (fullyPaid) {
    targetStatus = 'FULLY_PAID';
    append('BOOKING_CONFIRMED');
  } else if (paid.has('DEPOSIT')) {
    targetStatus = 'DEPOSIT_PAID';
  }
  if (targetStatus !== booking.booking_status) {
    statements.unshift(db.prepare(`
      UPDATE travel_booking_extensions SET booking_status=?,updated_at=?
      WHERE workspace_id=? AND id=? AND booking_status<>'CANCELLED'
    `).bind(targetStatus, input.occurredAt, input.workspaceId, booking.id));
  }
  if (statements.length) await db.batch(statements);
  return { projected: statements.length > 0, bookingStatus: targetStatus };
}
