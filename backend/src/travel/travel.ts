import { createOrder, initiatePaymentForLeg } from '../commerce/commerce';
import { ensureCommerceOfferForTravelDeparture, resolveCommerceOfferForTravelDeparture } from '../commerce/travel-offer';
import type { CommercePaymentLeg, CommercePaymentObligationInput } from '../commerce/payment-obligations';
import { resolveTrustedTravelSellerAttribution, travelSellerSnapshotStatements } from './seller-commission.ts';

const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const publicRef = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const rows = async (statement: any) => ((await statement.all()).results || []);
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);

function exact(value: any, allowed: readonly string[], code: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(code);
}
function integer(value: unknown, min: number, max: number, code: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(code);
  return Number(value);
}
function boundedText(value: unknown, max: number, code: string) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new Error(code);
  return value.trim();
}
function coverReference(value: unknown) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('TRAVEL_COVER_ASSET_INVALID');
  const reference = value.trim();
  if (!/^asset_[A-Za-z0-9_-]{8,114}$/.test(reference)) throw new Error('TRAVEL_COVER_ASSET_INVALID');
  return reference;
}
async function requireCoverAsset(db: D1Database, workspaceId: string, reference: string | null) {
  if (!reference) return null;
  const asset = await db.prepare(`SELECT id FROM assets
    WHERE id=? AND workspace_id=? AND deleted_at IS NULL AND status='ready'
      AND content_type LIKE 'image/%' AND length(storage_key)>0 LIMIT 1`).bind(reference, workspaceId).first();
  if (!asset) throw new Error('TRAVEL_COVER_ASSET_INVALID');
  return reference;
}
function iso(value: unknown, code: string) {
  const raw = clean(value, 40), parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) throw new Error(code);
  return parsed.toISOString();
}
function dateOnly(value: unknown, code: string) {
  const raw = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) throw new Error(code);
  return raw;
}

function itineraryView(row: any, member = false) {
  const coverAssetReference = row.safe_cover_ref || null;
  return { safeItineraryReference: row.public_ref, title: row.title, summary: row.summary, durationDays: Number(row.duration_days),
    region: row.region || '', notes: row.notes || '', coverAssetReference,
    coverUrl: coverAssetReference ? `${member?'/api/member/travel/assets':'/api/assets'}/${encodeURIComponent(coverAssetReference)}` : null,
    status: row.status, sellerContext: row.seller_dealer_id ? 'DEALER' : 'TENANT', reviewNote: row.review_note || '',
    submittedAt: row.submitted_at || null, publishedAt: row.published_at || null, rejectedAt: row.rejected_at || null,
    archivedAt: row.archived_at || null, createdAt: row.created_at, updatedAt: row.updated_at };
}
function departureView(row: any) {
  const reserved = Number(row.reserved_count || 0), limit = Number(row.seat_limit);
  return { safeDepartureReference: row.public_ref, safeItineraryReference: row.itinerary_ref, itineraryTitle: row.itinerary_title,
    status: row.status, departureDate: row.departure_date, returnDate: row.return_date, bookingOpensAt: row.booking_opens_at,
    bookingClosesAt: row.booking_closes_at, seatLimit: limit, minGroupSize: Number(row.min_group_size || 1), reservedTravelerCount: reserved, remainingSeats: Math.max(0, limit - reserved),
    priceAmountMinor: Number(row.price_amount_minor), currencyCode: 'TWD', paymentScheduleType: row.payment_schedule_type,
    depositAmountMinor: Number(row.deposit_amount_minor), depositDueAt: row.deposit_due_at || null, balanceDueAt: row.balance_due_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
const departureSelect = `SELECT d.*,i.public_ref itinerary_ref,i.title itinerary_title,i.summary itinerary_summary,i.status itinerary_status,i.seller_dealer_id,
  (SELECT COALESCE(SUM(b.traveler_count),0) FROM travel_booking_extensions b
   WHERE b.workspace_id=d.workspace_id AND b.departure_id=d.id AND b.booking_status<>'CANCELLED') reserved_count
  FROM travel_departures d JOIN travel_itineraries i ON i.workspace_id=d.workspace_id AND i.id=d.itinerary_id`;
const itinerarySelect = `SELECT i.*,a.id safe_cover_ref FROM travel_itineraries i
  LEFT JOIN assets a ON a.id=i.cover_asset_reference AND a.workspace_id=i.workspace_id
    AND a.deleted_at IS NULL AND a.status='ready' AND a.content_type LIKE 'image/%'`;

function eventStatement(db: D1Database, input: { workspaceId: string; itineraryId?: string; departureId?: string; bookingId?: string; eventType: string; actorType: 'TENANT_USER'|'MEMBER'|'SYSTEM'; actorUserId?: string | null; occurredAt?: string; dedupeKey?: string | null }) {
  const timestamp = input.occurredAt || now();
  return db.prepare(`INSERT INTO travel_events(id,workspace_id,itinerary_id,departure_id,booking_id,event_type,actor_type,actor_user_id,dedupe_key,occurred_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(makeId('tre'), input.workspaceId, input.itineraryId || null, input.departureId || null, input.bookingId || null,
      input.eventType, input.actorType, input.actorUserId || null, input.dedupeKey || null, timestamp, timestamp);
}

export async function createItinerary(db: D1Database, input: any) {
  exact(input.body, ['title','summary','durationDays','region','notes','coverAssetReference'], 'TRAVEL_ITINERARY_INPUT_INVALID');
  const title = clean(input.body.title, 160); if (!title) throw new Error('TRAVEL_ITINERARY_TITLE_REQUIRED');
  const region = input.body.region === undefined ? '' : boundedText(input.body.region,120,'TRAVEL_ITINERARY_REGION_INVALID');
  const notes = input.body.notes === undefined ? '' : boundedText(input.body.notes,4000,'TRAVEL_ITINERARY_NOTES_INVALID');
  const cover = await requireCoverAsset(db,input.workspaceId,input.body.coverAssetReference === undefined ? null : coverReference(input.body.coverAssetReference));
  const id = makeId('tri'), ref = publicRef('iti'), timestamp = now();
  await db.batch([
    db.prepare(`INSERT INTO travel_itineraries(id,public_ref,workspace_id,title,summary,duration_days,status,created_by_user_id,created_at,updated_at,region,notes,cover_asset_reference) VALUES(?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?)`)
      .bind(id, ref, input.workspaceId, title, clean(input.body.summary, 4000), integer(input.body.durationDays,1,365,'TRAVEL_DURATION_INVALID'), input.userId || null, timestamp, timestamp, region, notes, cover),
    eventStatement(db,{workspaceId:input.workspaceId,itineraryId:id,eventType:'ITINERARY_CREATED',actorType:'TENANT_USER',actorUserId:input.userId,occurredAt:timestamp}),
  ]);
  return readItinerary(db,input.workspaceId,ref);
}
export async function listItineraries(db:D1Database,workspaceId:string){return (await rows(db.prepare(`${itinerarySelect} WHERE i.workspace_id=? ORDER BY i.updated_at DESC,i.id DESC`).bind(workspaceId))).map(itineraryView);}
export async function readItinerary(db:D1Database,workspaceId:string,reference:string,member=false){const row=await db.prepare(`${itinerarySelect} WHERE i.workspace_id=? AND i.public_ref=? LIMIT 1`).bind(workspaceId,reference).first<any>();if(!row)throw new Error('TRAVEL_ITINERARY_NOT_FOUND');return itineraryView(row,member);}
export async function updateItinerary(db:D1Database,input:any){
  exact(input.body,['title','summary','durationDays','region','notes','coverAssetReference'],'TRAVEL_ITINERARY_INPUT_INVALID');
  const row=await db.prepare(`SELECT * FROM travel_itineraries WHERE workspace_id=? AND public_ref=? LIMIT 1`).bind(input.workspaceId,input.reference).first<any>();
  if(!row)throw new Error('TRAVEL_ITINERARY_NOT_FOUND');if(!['DRAFT','REJECTED'].includes(row.status))throw new Error('TRAVEL_ITINERARY_NOT_EDITABLE');
  const title=input.body.title===undefined?row.title:clean(input.body.title,160);if(!title)throw new Error('TRAVEL_ITINERARY_TITLE_REQUIRED');
  const region=input.body.region===undefined?row.region:boundedText(input.body.region,120,'TRAVEL_ITINERARY_REGION_INVALID');
  const notes=input.body.notes===undefined?row.notes:boundedText(input.body.notes,4000,'TRAVEL_ITINERARY_NOTES_INVALID');
  const cover=input.body.coverAssetReference===undefined?row.cover_asset_reference:await requireCoverAsset(db,input.workspaceId,coverReference(input.body.coverAssetReference));
  await db.prepare(`UPDATE travel_itineraries SET title=?,summary=?,duration_days=?,region=?,notes=?,cover_asset_reference=?,status='DRAFT',review_note='',rejected_at=NULL,updated_at=? WHERE workspace_id=? AND id=?`)
    .bind(title,input.body.summary===undefined?row.summary:clean(input.body.summary,4000),input.body.durationDays===undefined?row.duration_days:integer(input.body.durationDays,1,365,'TRAVEL_DURATION_INVALID'),region,notes,cover,now(),input.workspaceId,row.id).run();
  return readItinerary(db,input.workspaceId,input.reference);
}
export async function transitionItinerary(db:D1Database,input:any){
  const row=await db.prepare(`SELECT * FROM travel_itineraries WHERE workspace_id=? AND public_ref=? LIMIT 1`).bind(input.workspaceId,input.reference).first<any>();if(!row)throw new Error('TRAVEL_ITINERARY_NOT_FOUND');
  const transitions:any={submit:{from:['DRAFT','REJECTED'],to:'PENDING_REVIEW',event:'ITINERARY_SUBMITTED'},approve:{from:['PENDING_REVIEW'],to:'PUBLISHED',event:'ITINERARY_PUBLISHED'},reject:{from:['PENDING_REVIEW'],to:'REJECTED',event:'ITINERARY_REJECTED'},archive:{from:['DRAFT','PENDING_REVIEW','PUBLISHED','REJECTED'],to:'ARCHIVED',event:'ITINERARY_ARCHIVED'}};
  const rule=transitions[input.action];if(!rule||!rule.from.includes(row.status))throw new Error('TRAVEL_ITINERARY_TRANSITION_INVALID');
  const timestamp=now(),note=clean(input.reviewNote,1000);
  await db.batch([db.prepare(`UPDATE travel_itineraries SET status=?,reviewed_by_user_id=?,review_note=?,submitted_at=CASE WHEN ?='PENDING_REVIEW' THEN ? ELSE submitted_at END,published_at=CASE WHEN ?='PUBLISHED' THEN ? ELSE published_at END,rejected_at=CASE WHEN ?='REJECTED' THEN ? ELSE rejected_at END,archived_at=CASE WHEN ?='ARCHIVED' THEN ? ELSE archived_at END,updated_at=? WHERE workspace_id=? AND id=?`)
    .bind(rule.to,['approve','reject'].includes(input.action)?input.userId:null,note,rule.to,timestamp,rule.to,timestamp,rule.to,timestamp,rule.to,timestamp,timestamp,input.workspaceId,row.id),
    eventStatement(db,{workspaceId:input.workspaceId,itineraryId:row.id,eventType:rule.event,actorType:'TENANT_USER',actorUserId:input.userId,occurredAt:timestamp})]);
  return readItinerary(db,input.workspaceId,input.reference);
}

function schedule(body:any){
  const type=String(body.paymentScheduleType||'FULL').toUpperCase();if(!['FULL','DEPOSIT_BALANCE'].includes(type))throw new Error('TRAVEL_PAYMENT_SCHEDULE_INVALID');
  const price=integer(body.priceAmountMinor,1,100000000,'TRAVEL_PRICE_INVALID');
  if(type==='FULL')return {type,price,deposit:0,depositDue:null,balanceDue:null};
  const deposit=integer(body.depositAmountMinor,1,price-1,'TRAVEL_DEPOSIT_INVALID');
  return {type,price,deposit,depositDue:iso(body.depositDueAt,'TRAVEL_PAYMENT_DUE_INVALID'),balanceDue:iso(body.balanceDueAt,'TRAVEL_PAYMENT_DUE_INVALID')};
}
export async function createDeparture(db:D1Database,input:any){
  exact(input.body,['departureDate','returnDate','bookingOpensAt','bookingClosesAt','seatLimit','minGroupSize','priceAmountMinor','currencyCode','paymentScheduleType','depositAmountMinor','depositDueAt','balanceDueAt'],'TRAVEL_DEPARTURE_INPUT_INVALID');
  if(input.body.currencyCode!==undefined&&input.body.currencyCode!=='TWD')throw new Error('TRAVEL_CURRENCY_UNSUPPORTED');
  const itinerary=await db.prepare(`SELECT * FROM travel_itineraries WHERE workspace_id=? AND public_ref=? LIMIT 1`).bind(input.workspaceId,input.itineraryReference).first<any>();
  if(!itinerary)throw new Error('TRAVEL_ITINERARY_NOT_FOUND');if(itinerary.status==='ARCHIVED')throw new Error('TRAVEL_ITINERARY_ARCHIVED');
  const departureDate=dateOnly(input.body.departureDate,'TRAVEL_DEPARTURE_DATE_INVALID'),returnDate=dateOnly(input.body.returnDate,'TRAVEL_RETURN_DATE_INVALID');if(returnDate<departureDate)throw new Error('TRAVEL_DATE_RANGE_INVALID');
  const opens=iso(input.body.bookingOpensAt,'TRAVEL_BOOKING_WINDOW_INVALID'),closes=iso(input.body.bookingClosesAt,'TRAVEL_BOOKING_WINDOW_INVALID');if(closes<=opens)throw new Error('TRAVEL_BOOKING_WINDOW_INVALID');
  const terms=schedule(input.body),seatLimit=integer(input.body.seatLimit,1,10000,'TRAVEL_SEAT_LIMIT_INVALID');
  const minGroupSize=input.body.minGroupSize===undefined?1:integer(input.body.minGroupSize,1,seatLimit,'TRAVEL_MIN_GROUP_SIZE_INVALID');
  const id=makeId('trd'),ref=publicRef('dep'),timestamp=now();
  await db.batch([db.prepare(`INSERT INTO travel_departures(
    id,public_ref,workspace_id,itinerary_id,status,departure_date,return_date,booking_opens_at,booking_closes_at,
    seat_limit,min_group_size,price_amount_minor,currency_code,payment_schedule_type,deposit_amount_minor,
    deposit_due_at,balance_due_at,created_by_user_id,created_at,updated_at
  ) VALUES(?,?,?,?,'DRAFT',?,?,?,?,?,?,?,'TWD',?,?,?,?,?,?,?)`)
    .bind(id,ref,input.workspaceId,itinerary.id,departureDate,returnDate,opens,closes,seatLimit,minGroupSize,terms.price,terms.type,terms.deposit,terms.depositDue,terms.balanceDue,input.userId||null,timestamp,timestamp),
    eventStatement(db,{workspaceId:input.workspaceId,itineraryId:itinerary.id,departureId:id,eventType:'DEPARTURE_CREATED',actorType:'TENANT_USER',actorUserId:input.userId,occurredAt:timestamp})]);
  await ensureCommerceOfferForTravelDeparture(db,{workspaceId:input.workspaceId,sourceReference:ref,title:`${itinerary.title} ${departureDate}`,description:itinerary.summary,priceAmountMinor:terms.price,status:'DRAFT',actorUserId:input.userId});
  return readDeparture(db,input.workspaceId,ref);
}
export async function updateDeparture(db:D1Database,input:any){
  const allowed=['departureDate','returnDate','bookingOpensAt','bookingClosesAt','seatLimit','minGroupSize','priceAmountMinor','currencyCode'] as const;
  exact(input.body,allowed,'TRAVEL_DEPARTURE_INPUT_INVALID');
  const row=await db.prepare(`${departureSelect} WHERE d.workspace_id=? AND d.public_ref=? LIMIT 1`).bind(input.workspaceId,input.reference).first<any>();
  if(!row)throw new Error('TRAVEL_DEPARTURE_NOT_FOUND');
  if(['CLOSED','SOLD_OUT','CANCELLED','ARCHIVED'].includes(row.status))throw new Error('TRAVEL_DEPARTURE_NOT_EDITABLE');
  const changed=Object.keys(input.body);
  if(row.status==='OPEN'&&changed.some(key=>!['bookingClosesAt','seatLimit','minGroupSize','priceAmountMinor','currencyCode'].includes(key)))throw new Error('TRAVEL_DEPARTURE_NOT_EDITABLE');
  if(input.body.currencyCode!==undefined&&input.body.currencyCode!=='TWD')throw new Error('TRAVEL_CURRENCY_UNSUPPORTED');
  const departureDate=input.body.departureDate===undefined?row.departure_date:dateOnly(input.body.departureDate,'TRAVEL_DEPARTURE_DATE_INVALID');
  const returnDate=input.body.returnDate===undefined?row.return_date:dateOnly(input.body.returnDate,'TRAVEL_RETURN_DATE_INVALID');
  if(returnDate<departureDate)throw new Error('TRAVEL_DATE_RANGE_INVALID');
  const opens=input.body.bookingOpensAt===undefined?row.booking_opens_at:iso(input.body.bookingOpensAt,'TRAVEL_BOOKING_WINDOW_INVALID');
  const closes=input.body.bookingClosesAt===undefined?row.booking_closes_at:iso(input.body.bookingClosesAt,'TRAVEL_BOOKING_WINDOW_INVALID');
  if(closes<=opens)throw new Error('TRAVEL_BOOKING_WINDOW_INVALID');
  const reserved=Number(row.reserved_count||0);
  if(reserved>0&&(departureDate!==row.departure_date||returnDate!==row.return_date))throw new Error('TRAVEL_DEPARTURE_DATE_LOCKED');
  const seatLimit=input.body.seatLimit===undefined?Number(row.seat_limit):integer(input.body.seatLimit,1,10000,'TRAVEL_SEAT_LIMIT_INVALID');
  if(seatLimit<reserved)throw new Error('TRAVEL_SEAT_LIMIT_BELOW_RESERVED');
  const minGroupSize=input.body.minGroupSize===undefined?Number(row.min_group_size||1):integer(input.body.minGroupSize,1,seatLimit,'TRAVEL_MIN_GROUP_SIZE_INVALID');
  if(minGroupSize>seatLimit)throw new Error('TRAVEL_MIN_GROUP_SIZE_INVALID');
  const priceAmountMinor=input.body.priceAmountMinor===undefined?Number(row.price_amount_minor):integer(input.body.priceAmountMinor,1,100000000,'TRAVEL_PRICE_INVALID');
  const offer=await resolveCommerceOfferForTravelDeparture(db,{workspaceId:input.workspaceId,sourceReference:row.public_ref});
  if(!offer||offer.status==='ARCHIVED')throw new Error('TRAVEL_DEPARTURE_OFFER_NOT_EDITABLE');
  const timestamp=now();
  await db.batch([
    db.prepare(`UPDATE travel_departures SET departure_date=?,return_date=?,booking_opens_at=?,booking_closes_at=?,seat_limit=?,min_group_size=?,price_amount_minor=?,updated_at=? WHERE workspace_id=? AND id=?`)
      .bind(departureDate,returnDate,opens,closes,seatLimit,minGroupSize,priceAmountMinor,timestamp,input.workspaceId,row.id),
    db.prepare(`UPDATE commerce_products SET name=?,description=?,price_amount_minor=?,updated_by_user_id=?,updated_at=?
      WHERE workspace_id=? AND product_kind='TRAVEL_DEPARTURE' AND status<>'ARCHIVED' AND id=(
        SELECT product_id FROM commerce_product_sources WHERE workspace_id=? AND source_domain='TRAVEL_DEPARTURE' AND source_reference=? LIMIT 1
      )`).bind(`${row.itinerary_title} ${departureDate}`,clean(row.itinerary_summary,2000),priceAmountMinor,input.userId||null,timestamp,input.workspaceId,input.workspaceId,row.public_ref),
  ]);
  return readDeparture(db,input.workspaceId,input.reference);
}
export async function listDepartures(db:D1Database,workspaceId:string,itineraryReference?:string,member=false){const clauses=['d.workspace_id=?'],args:any[]=[workspaceId];if(itineraryReference){clauses.push('i.public_ref=?');args.push(itineraryReference)}if(member){clauses.push("i.status='PUBLISHED'","d.status='OPEN'","datetime('now')>=datetime(d.booking_opens_at)","datetime('now')<=datetime(d.booking_closes_at)","d.seat_limit>(SELECT COALESCE(SUM(mb.traveler_count),0) FROM travel_booking_extensions mb WHERE mb.workspace_id=d.workspace_id AND mb.departure_id=d.id AND mb.booking_status<>'CANCELLED')")}return (await rows(db.prepare(`${departureSelect} WHERE ${clauses.join(' AND ')} ORDER BY d.departure_date,d.id`).bind(...args))).map(departureView);}
export async function readDeparture(db:D1Database,workspaceId:string,reference:string,member=false){const extra=member?" AND i.status='PUBLISHED' AND d.status='OPEN' AND datetime('now')>=datetime(d.booking_opens_at) AND datetime('now')<=datetime(d.booking_closes_at) AND d.seat_limit>(SELECT COALESCE(SUM(mb.traveler_count),0) FROM travel_booking_extensions mb WHERE mb.workspace_id=d.workspace_id AND mb.departure_id=d.id AND mb.booking_status<>'CANCELLED')":'';const row=await db.prepare(`${departureSelect} WHERE d.workspace_id=? AND d.public_ref=?${extra} LIMIT 1`).bind(workspaceId,reference).first<any>();if(!row)throw new Error('TRAVEL_DEPARTURE_NOT_FOUND');return departureView(row);}
export async function setDepartureStatus(db:D1Database,input:any){
  const row=await db.prepare(`${departureSelect} WHERE d.workspace_id=? AND d.public_ref=? LIMIT 1`).bind(input.workspaceId,input.reference).first<any>();if(!row)throw new Error('TRAVEL_DEPARTURE_NOT_FOUND');
  const rules:any={open:{from:['DRAFT','CLOSED','SOLD_OUT'],to:'OPEN',event:'DEPARTURE_OPENED'},close:{from:['OPEN','SOLD_OUT'],to:'CLOSED',event:'DEPARTURE_CLOSED'},cancel:{from:['DRAFT','OPEN','CLOSED','SOLD_OUT'],to:'CANCELLED',event:'DEPARTURE_CANCELLED'},archive:{from:['DRAFT','CLOSED','CANCELLED','SOLD_OUT'],to:'ARCHIVED',event:'DEPARTURE_ARCHIVED'}};const rule=rules[input.action];
  if(!rule||!rule.from.includes(row.status))throw new Error('TRAVEL_DEPARTURE_TRANSITION_INVALID');if(input.action==='open'&&row.itinerary_status!=='PUBLISHED')throw new Error('TRAVEL_ITINERARY_NOT_PUBLISHED');
  const timestamp=now();await db.batch([db.prepare(`UPDATE travel_departures SET status=?,archived_at=CASE WHEN ?='ARCHIVED' THEN ? ELSE archived_at END,updated_at=? WHERE workspace_id=? AND id=?`).bind(rule.to,rule.to,timestamp,timestamp,input.workspaceId,row.id),eventStatement(db,{workspaceId:input.workspaceId,itineraryId:row.itinerary_id,departureId:row.id,eventType:rule.event,actorType:'TENANT_USER',actorUserId:input.userId,occurredAt:timestamp})]);
  await ensureCommerceOfferForTravelDeparture(db,{workspaceId:input.workspaceId,sourceReference:row.public_ref,title:`${row.itinerary_title} ${row.departure_date}`,priceAmountMinor:Number(row.price_amount_minor),status:rule.to==='OPEN'?'ACTIVE':rule.to==='ARCHIVED'?'ARCHIVED':'DRAFT',actorUserId:input.userId});
  return readDeparture(db,input.workspaceId,input.reference);
}

function travelerSnapshots(value:any){if(!Array.isArray(value)||value.length<1||value.length>100)throw new Error('TRAVEL_TRAVELERS_INVALID');return value.map((raw:any,index:number)=>{exact(raw,['displayName','travelerType','phone','note'],'TRAVEL_TRAVELER_INPUT_INVALID');const name=clean(raw.displayName,120);if(!name)throw new Error('TRAVEL_TRAVELER_NAME_REQUIRED');const type=String(raw.travelerType||'ADULT').toUpperCase();if(!['ADULT','CHILD','INFANT'].includes(type))throw new Error('TRAVEL_TRAVELER_TYPE_INVALID');return {sequence:index+1,name,type,phone:clean(raw.phone,40),note:clean(raw.note,500)}});}
function scheduleView(row:any){return {paymentLeg:row.payment_leg,amountMinor:Number(row.amount_minor_snapshot),currencyCode:'TWD',dueAt:row.due_at_snapshot||null,status:row.obligation_status||'PENDING',paidAt:row.paid_at||null};}
function bookingView(row:any,travelers:any[]=[],schedules:any[]=[]){const seller=row.safe_seller_reference_snapshot?{safeSellerReference:row.safe_seller_reference_snapshot,sellerLabel:row.seller_label_snapshot}:null;return {safeBookingReference:row.public_ref,safeOrderReference:row.order_ref,safeDepartureReference:row.departure_ref,safeItineraryReference:row.itinerary_ref,itineraryTitle:row.itinerary_title,departureDate:row.departure_date,bookingStatus:row.booking_status,safeCustomerLabel:clean(row.safe_customer_label,120)||'會員顧客',travelerCount:Number(row.traveler_count),paymentScheduleType:row.payment_schedule_type_snapshot,totalAmountMinor:Number(row.total_amount_minor_snapshot),currencyCode:'TWD',sellerContext:seller?'DEALER':'TENANT',seller,travelers:travelers.map(t=>({sequence:Number(t.sequence_no),displayName:t.display_name,travelerType:t.traveler_type,phone:t.phone,note:t.note})),paymentSchedule:schedules.map(scheduleView),createdAt:row.created_at,updatedAt:row.updated_at};}
const bookingSelect=`SELECT b.*,o.public_ref order_ref,d.public_ref departure_ref,d.departure_date,i.public_ref itinerary_ref,i.title itinerary_title,
  COALESCE(NULLIF(trim(pr.display_name),''),NULLIF(trim(pr.contact_name),''),NULLIF(trim(pr.company_name),''),'會員顧客') safe_customer_label,
  sc.safe_seller_reference_snapshot,sc.seller_label_snapshot
  FROM travel_booking_extensions b JOIN commerce_orders o ON o.workspace_id=b.workspace_id AND o.id=b.order_id
  JOIN travel_departures d ON d.workspace_id=b.workspace_id AND d.id=b.departure_id JOIN travel_itineraries i ON i.workspace_id=b.workspace_id AND i.id=d.itinerary_id
  JOIN crm_people cp ON cp.workspace_id=b.workspace_id AND cp.id=b.customer_crm_person_id LEFT JOIN crm_profiles pr ON pr.crm_person_id=cp.id
  LEFT JOIN travel_booking_seller_contexts sc ON sc.workspace_id=b.workspace_id AND sc.booking_id=b.id`;
async function hydrateBooking(db:D1Database,row:any){const travelers=await rows(db.prepare(`SELECT * FROM travel_booking_travelers WHERE workspace_id=? AND booking_id=? ORDER BY sequence_no`).bind(row.workspace_id,row.id));const schedules=await rows(db.prepare(`SELECT s.*,o.status obligation_status,o.paid_at FROM travel_payment_schedules s JOIN travel_booking_extensions b ON b.workspace_id=s.workspace_id AND b.id=s.booking_id JOIN commerce_order_payment_obligations o ON o.workspace_id=b.workspace_id AND o.order_id=b.order_id AND o.payment_leg=s.payment_leg WHERE s.workspace_id=? AND s.booking_id=? ORDER BY CASE s.payment_leg WHEN 'FULL' THEN 1 WHEN 'DEPOSIT' THEN 1 ELSE 2 END`).bind(row.workspace_id,row.id));return bookingView(row,travelers,schedules);}
export async function createMemberBooking(db:D1Database,input:any){
  exact(input.body,['safeDepartureReference','travelers'],'TRAVEL_BOOKING_INPUT_INVALID');const travelers=travelerSnapshots(input.body.travelers),timestamp=now();
  const departure:any=await db.prepare(`${departureSelect} WHERE d.workspace_id=? AND d.public_ref=? LIMIT 1`).bind(input.workspaceId,clean(input.body.safeDepartureReference,100)).first();if(!departure)throw new Error('TRAVEL_DEPARTURE_NOT_FOUND');
  if(departure.itinerary_status!=='PUBLISHED'||departure.status!=='OPEN'||timestamp<new Date(departure.booking_opens_at).toISOString()||timestamp>new Date(departure.booking_closes_at).toISOString())throw new Error('TRAVEL_BOOKING_NOT_AVAILABLE');
  if(Number(departure.seat_limit)-Number(departure.reserved_count)<travelers.length)throw new Error('TRAVEL_DEPARTURE_CAPACITY_EXCEEDED');
  const offer=await resolveCommerceOfferForTravelDeparture(db,{workspaceId:input.workspaceId,sourceReference:departure.public_ref});if(!offer||offer.status!=='ACTIVE')throw new Error('TRAVEL_DEPARTURE_NOT_PURCHASABLE');
  const total=Number(departure.price_amount_minor)*travelers.length;if(total>100000000)throw new Error('TRAVEL_BOOKING_TOTAL_INVALID');
  const seller=await resolveTrustedTravelSellerAttribution(db,{secret:String(input.sellerReferenceSecret||''),workspaceId:input.workspaceId,lineAccountId:input.lineAccountId,inviteeMemberId:input.lineMemberId,occurredAt:timestamp});
  const bookingId=makeId('trb'),bookingRef=publicRef('bkg'),obligations:CommercePaymentObligationInput[]=departure.payment_schedule_type==='FULL'?[{paymentLeg:'FULL',amountMinor:total}]:[{paymentLeg:'DEPOSIT',amountMinor:Number(departure.deposit_amount_minor)*travelers.length},{paymentLeg:'BALANCE',amountMinor:(Number(departure.price_amount_minor)-Number(departure.deposit_amount_minor))*travelers.length}];
  const order:any=await createOrder(db,{workspaceId:input.workspaceId,userId:null,productKind:'TRAVEL_DEPARTURE',memberOwner:{lineAccountId:input.lineAccountId,lineMemberId:input.lineMemberId,crmPersonId:input.crmPersonId},body:{items:[{safeProductReference:offer.safeProductReference,quantity:travelers.length}]},paymentObligations:obligations,trustedAppendStatements:({orderId}:any)=>[
    db.prepare(`INSERT INTO travel_booking_extensions(id,public_ref,workspace_id,order_id,departure_id,line_account_id,line_member_id,customer_crm_person_id,seller_dealer_id,booking_status,traveler_count,payment_schedule_type_snapshot,total_amount_minor_snapshot,currency_code_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'PENDING_PAYMENT',?,?,?,'TWD',?,?)`).bind(bookingId,bookingRef,input.workspaceId,orderId,departure.id,input.lineAccountId,input.lineMemberId,input.crmPersonId,seller?.sellerDealerId||null,travelers.length,departure.payment_schedule_type,total,timestamp,timestamp),
    ...travelers.map(t=>db.prepare(`INSERT INTO travel_booking_travelers(id,workspace_id,booking_id,sequence_no,display_name,traveler_type,phone,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(makeId('trt'),input.workspaceId,bookingId,t.sequence,t.name,t.type,t.phone,t.note,timestamp)),
    ...obligations.map(o=>db.prepare(`INSERT INTO travel_payment_schedules(id,workspace_id,booking_id,payment_leg,amount_minor_snapshot,currency_code_snapshot,due_at_snapshot,created_at) VALUES(?,?,?,?,?,'TWD',?,?)`).bind(makeId('trs'),input.workspaceId,bookingId,o.paymentLeg,o.amountMinor,o.paymentLeg==='DEPOSIT'?departure.deposit_due_at:o.paymentLeg==='BALANCE'?departure.balance_due_at:null,timestamp)),
    eventStatement(db,{workspaceId:input.workspaceId,itineraryId:departure.itinerary_id,departureId:departure.id,bookingId,eventType:'BOOKING_CREATED',actorType:'MEMBER',occurredAt:timestamp}),
    ...(seller?travelSellerSnapshotStatements(db,{workspaceId:input.workspaceId,lineAccountId:input.lineAccountId,bookingId,amountMinor:total,currencyCode:'TWD',attributedAt:timestamp,seller}):[]),
  ]});
  return readMemberBooking(db,input,order.safeOrderReference,bookingRef);
}
export async function listBookings(db:D1Database,input:any){const clauses=['b.workspace_id=?'],args:any[]=[input.workspaceId];if(input.lineAccountId&&input.lineMemberId){clauses.push('b.line_account_id=?','b.line_member_id=?');args.push(input.lineAccountId,input.lineMemberId)}const found=await rows(db.prepare(`${bookingSelect} WHERE ${clauses.join(' AND ')} ORDER BY b.created_at DESC,b.id DESC`).bind(...args));return Promise.all(found.map((r:any)=>hydrateBooking(db,r)));}
export async function readBooking(db:D1Database,input:any,reference:string){const clauses=['b.workspace_id=?','b.public_ref=?'],args:any[]=[input.workspaceId,reference];if(input.lineAccountId&&input.lineMemberId){clauses.push('b.line_account_id=?','b.line_member_id=?');args.push(input.lineAccountId,input.lineMemberId)}const found=await db.prepare(`${bookingSelect} WHERE ${clauses.join(' AND ')} LIMIT 1`).bind(...args).first<any>();if(!found)throw new Error('TRAVEL_BOOKING_NOT_FOUND');return hydrateBooking(db,found);}
const bookingEventLabels:Record<string,string>={
  BOOKING_CREATED:'訂單已建立',DEPOSIT_PAID:'訂金已付款',BALANCE_PAID:'尾款已付款',FULL_PAYMENT_PAID:'全額已付款',
  BOOKING_CONFIRMED:'訂位已確認',BOOKING_CANCELLED:'訂位已取消',DEPARTURE_OPENED:'出發團開放報名',
  DEPARTURE_CLOSED:'出發團停止報名',DEPARTURE_CANCELLED:'出發團已取消',DEPARTURE_ARCHIVED:'出發團已封存',
};
export async function listBookingEvents(db:D1Database,input:any,reference:string){
  const clauses=['workspace_id=?','public_ref=?'],args:any[]=[input.workspaceId,reference];
  if(input.lineAccountId&&input.lineMemberId){clauses.push('line_account_id=?','line_member_id=?');args.push(input.lineAccountId,input.lineMemberId)}
  const booking=await db.prepare(`SELECT id FROM travel_booking_extensions WHERE ${clauses.join(' AND ')} LIMIT 1`).bind(...args).first<any>();
  if(!booking)throw new Error('TRAVEL_BOOKING_NOT_FOUND');
  const events=await rows(db.prepare(`SELECT event_type,occurred_at FROM travel_events
    WHERE workspace_id=? AND booking_id=? ORDER BY occurred_at ASC,id ASC LIMIT 100`).bind(input.workspaceId,booking.id));
  return events.map((event:any)=>({
    eventType:clean(event.event_type,60),
    occurredAt:event.occurred_at||null,
    safeEventLabel:bookingEventLabels[String(event.event_type)]||'行程狀態更新',
  }));
}
async function readMemberBooking(db:D1Database,input:any,_orderReference:string,bookingReference:string){return readBooking(db,input,bookingReference);}
export async function initiateTravelPayment(db:D1Database,input:any){const booking:any=await db.prepare(`${bookingSelect} WHERE b.workspace_id=? AND b.public_ref=? AND b.line_account_id=? AND b.line_member_id=? LIMIT 1`).bind(input.workspaceId,input.bookingReference,input.lineAccountId,input.lineMemberId).first();if(!booking)throw new Error('TRAVEL_BOOKING_NOT_FOUND');const leg=String(input.paymentLeg||'').toUpperCase() as CommercePaymentLeg;if(!['FULL','DEPOSIT','BALANCE'].includes(leg))throw new Error('TRAVEL_PAYMENT_LEG_INVALID');const allowed=booking.payment_schedule_type_snapshot==='FULL'?['FULL']:['DEPOSIT','BALANCE'];if(!allowed.includes(leg))throw new Error('TRAVEL_PAYMENT_LEG_NOT_PERMITTED');return initiatePaymentForLeg(db,{workspaceId:input.workspaceId,reference:booking.order_ref,paymentLeg:leg,env:input.env,notifyUrl:input.notifyUrl});}
export async function listPublishedItineraries(db:D1Database,workspaceId:string){return (await rows(db.prepare(`${itinerarySelect} WHERE i.workspace_id=? AND i.status='PUBLISHED' ORDER BY i.published_at DESC,i.id DESC`).bind(workspaceId))).map((row:any)=>itineraryView(row,true));}
