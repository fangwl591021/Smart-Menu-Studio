const id = () => `troe_${crypto.randomUUID().replace(/-/g, '')}`;
const now = () => new Date().toISOString();

async function scopedDeparture(db: D1Database, workspaceId: string, safeDepartureReference: string) {
  const departure = await db.prepare(`SELECT id,status FROM travel_departures
    WHERE workspace_id=? AND public_ref=? LIMIT 1`).bind(workspaceId, safeDepartureReference).first<any>();
  if (!departure) throw new Error('TRAVEL_DEPARTURE_NOT_FOUND');
  return departure;
}

export async function readOperationalState(db: D1Database, workspaceId: string, departureId: string) {
  const rows = (await db.prepare(`SELECT event_type,occurred_at FROM travel_operation_events
    WHERE workspace_id=? AND departure_id=? ORDER BY occurred_at ASC,id ASC`).bind(workspaceId, departureId).all<any>()).results || [];
  const confirmed = rows.find(row => row.event_type === 'OPERATION_CONFIRMED');
  const completed = rows.find(row => row.event_type === 'SERVICE_COMPLETED');
  return { confirmed: Boolean(confirmed), confirmedAt: confirmed?.occurred_at || null,
    completed: Boolean(completed), completedAt: completed?.occurred_at || null };
}

async function recordMilestone(db: D1Database, input: {
  workspaceId: string; safeDepartureReference: string; eventType: 'OPERATION_CONFIRMED'|'SERVICE_COMPLETED'; actorUserId?: string | null;
}) {
  const departure = await scopedDeparture(db, input.workspaceId, input.safeDepartureReference);
  const current = await readOperationalState(db, input.workspaceId, String(departure.id));
  if (input.eventType === 'OPERATION_CONFIRMED' && current.confirmed) return current;
  if (input.eventType === 'SERVICE_COMPLETED' && current.completed) return current;
  if (!['OPEN','CLOSED','SOLD_OUT'].includes(String(departure.status))) throw new Error('TRAVEL_OPERATION_DEPARTURE_INVALID');
  if (input.eventType === 'SERVICE_COMPLETED' && !current.confirmed) throw new Error('TRAVEL_OPERATION_NOT_CONFIRMED');
  const timestamp = now();
  await db.prepare(`INSERT INTO travel_operation_events(
    id,workspace_id,departure_id,event_type,actor_user_id,reason_code,occurred_at,created_at
  ) VALUES(?,?,?,?,?,NULL,?,?)
  ON CONFLICT(workspace_id,departure_id,event_type) DO NOTHING`).bind(
    id(), input.workspaceId, departure.id, input.eventType, input.actorUserId || null, timestamp, timestamp,
  ).run();
  return readOperationalState(db, input.workspaceId, String(departure.id));
}

export const confirmDepartureOperation = (db: D1Database, input: Omit<Parameters<typeof recordMilestone>[1], 'eventType'>) =>
  recordMilestone(db, { ...input, eventType: 'OPERATION_CONFIRMED' });

export const completeDepartureService = (db: D1Database, input: Omit<Parameters<typeof recordMilestone>[1], 'eventType'>) =>
  recordMilestone(db, { ...input, eventType: 'SERVICE_COMPLETED' });

export async function readMemberBookingFulfillment(db: D1Database, input: {
  workspaceId: string; lineAccountId: string; lineMemberId: string; safeBookingReference: string;
}) {
  const booking = await db.prepare(`SELECT b.booking_status,d.status departure_status,d.id departure_id
    FROM travel_booking_extensions b JOIN travel_departures d ON d.workspace_id=b.workspace_id AND d.id=b.departure_id
    WHERE b.workspace_id=? AND b.line_account_id=? AND b.line_member_id=? AND b.public_ref=? LIMIT 1`)
    .bind(input.workspaceId, input.lineAccountId, input.lineMemberId, input.safeBookingReference).first<any>();
  if (!booking) throw new Error('TRAVEL_BOOKING_NOT_FOUND');
  const operation = await readOperationalState(db, input.workspaceId, String(booking.departure_id));
  const state = booking.booking_status === 'CANCELLED' || booking.departure_status === 'CANCELLED' ? 'CANCELLED'
    : operation.completed ? 'COMPLETED' : operation.confirmed ? 'CONFIRMED' : 'PENDING';
  return { state: state as 'PENDING'|'CONFIRMED'|'COMPLETED'|'CANCELLED',
    confirmedAt: operation.confirmedAt, completedAt: operation.completedAt };
}
