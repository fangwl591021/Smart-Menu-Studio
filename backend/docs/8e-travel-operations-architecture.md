# 8E Travel Operations and Departure Fulfillment Architecture

Status: planning contract only
Production baseline: `4b9a699aa42c87dab22eec9124aca2e03f211255`
Prerequisites: 8C and 8D are production-complete and frozen; migrations `0050` through `0053` are applied.

8E answers one question: after a Member creates and pays for a Travel booking, how can a Tenant operate the departure without creating a second CRM, payment, seller, commission, settlement, or payout authority?

This document proposes no runtime change, migration, deployment, production data, TravelKeeper import, export, or AI behavior.

## A. Current authority map

| Concern | Current authority | Current implementation | 8E rule |
| --- | --- | --- | --- |
| Itinerary | TRAVEL | `travel_itineraries` | Reuse unchanged. Itinerary content/review is not an operations record. |
| Departure | TRAVEL | `travel_departures` | Reuse as the departure occurrence, booking-window, capacity, price-policy, and sales-state authority. |
| Booking | TRAVEL extension of Commerce Order | `travel_booking_extensions` linked 1:1 to `commerce_orders` | Reuse. Do not create `travel_orders`. |
| Traveler | Immutable TRAVEL snapshot | `travel_booking_travelers` | Reuse only the fields already collected in 8C. Travelers do not become CRM People automatically. |
| Payment schedule | Immutable TRAVEL snapshot, with Commerce as truth | `travel_payment_schedules` joined to `commerce_order_payment_obligations` | Reuse. TRAVEL may display payment readiness but cannot mark a leg paid. |
| Customer | CRM Person plus verified Member | `customer_crm_person_id`, `line_member_id`, and verified identity links; safe projection from CRM profile | Reuse. Do not create `travel_customers` or expose internal identity keys. |
| Seller | Dealer plus Travel capability | `line_oa_dealers`, `travel_seller_permissions`, and immutable `travel_booking_seller_contexts` | Reuse safe seller snapshot only. No reassignment. |
| Referral | Referral domain | `member_referral_attributions` | Read only through the existing trusted seller bridge. No 8E mutation. |
| Commission | Existing Commission domain | Conversion evidence, attribution, calculation, and `commission_ledger_entries` | Reuse unchanged. 8E is not a commission calculator. |
| Settlement and payout | Existing Commission settlement/payout domains | Existing settlement, payout request, and payment-execution tables/services | Reuse unchanged; not exposed as departure fulfillment controls. |
| Timeline | TRAVEL | Append-only `travel_events`; 8D seller events remain in `travel_seller_bridge_events` | Reuse current events for current vocabulary. Add an operations-specific stream only if mutations are approved, for the additive-schema reason in section K. |

### Current safe projections

The current departure projection already returns the safe departure and itinerary references, title, dates, booking window, `seatLimit`, `minGroupSize`, `reservedTravelerCount`, `remainingSeats`, price, currency, and payment schedule type. Reserved seats are the sum of traveler counts for bookings whose `booking_status <> 'CANCELLED'`.

The current booking projection returns safe booking/order/departure/itinerary references, itinerary title, departure date, booking state, safe customer label, traveler count, payment schedule, safe seller label when frozen, and timestamps. It deliberately omits raw Workspace, Member, Dealer, CRM Person, Commerce Order, payment obligation, provider transaction, Commission, and Travel database IDs.

## B. Current lifecycle and status map

The following names are copied from the current migrations and runtime. TravelKeeper names are not authority.

### Itinerary lifecycle

Stored enum:

- `DRAFT`
- `PENDING_REVIEW`
- `PUBLISHED`
- `REJECTED`
- `ARCHIVED`

Implemented transitions:

- `DRAFT` or `REJECTED` -> `PENDING_REVIEW` by submit-review.
- `PENDING_REVIEW` -> `PUBLISHED` by owner approval.
- `PENDING_REVIEW` -> `REJECTED` by owner rejection.
- Any non-archived state -> `ARCHIVED` through the current archive rules.
- Editing is restricted to `DRAFT` or `REJECTED` and returns the record to `DRAFT`.

### Departure lifecycle

Stored enum:

- `DRAFT`
- `OPEN`
- `CLOSED`
- `SOLD_OUT`
- `CANCELLED`
- `ARCHIVED`

Implemented transitions:

- `DRAFT`, `CLOSED`, or `SOLD_OUT` -> `OPEN`; the itinerary must be `PUBLISHED`.
- `OPEN` or `SOLD_OUT` -> `CLOSED`.
- `DRAFT`, `OPEN`, `CLOSED`, or `SOLD_OUT` -> `CANCELLED`.
- `DRAFT`, `CLOSED`, `CANCELLED`, or `SOLD_OUT` -> `ARCHIVED`.

`SOLD_OUT` exists in the database contract but current runtime does not automatically write it when remaining seats reach zero. Member availability instead derives capacity directly. There is no current `DEPARTED` or `COMPLETED` departure state.

The departure enum is a sales/availability lifecycle. 8E must not overload it with payment or fulfillment truth.

### Booking lifecycle

Stored enum:

- `PENDING_PAYMENT`
- `DEPOSIT_PAID`
- `CONFIRMED`
- `BALANCE_DUE`
- `FULLY_PAID`
- `CANCELLED`

Current runtime writes:

- Booking creation -> `PENDING_PAYMENT`.
- Verified deposit leg -> `DEPOSIT_PAID`.
- All Commerce obligations paid -> `FULLY_PAID` and append `BOOKING_CONFIRMED`.
- A cancelled booking is terminal to payment projection and is not revived.

`CONFIRMED` and `BALANCE_DUE` are valid schema values but have no current explicit Tenant transition. Consequently they must not be treated as implemented operational authority merely because they appear in the CHECK constraint.

### Payment lifecycle

Travel schedule types are `FULL` and `DEPOSIT_BALANCE`. Frozen payment legs are `FULL`, `DEPOSIT`, and `BALANCE`.

Commerce owns the actual states:

- Commerce Order: `DRAFT`, `PENDING_PAYMENT`, `PAID`, `CANCELLED`, `PAYMENT_FAILED`.
- Commerce payment status: `UNPAID`, `PENDING`, `PAID`, `FAILED`, `CANCELLED`.
- Payment obligation: `PENDING`, `PAID`, `FAILED`, `EXPIRED`, `CANCELLED`.
- Provider transaction: `SUCCEEDED`, `FAILED`, `VERIFICATION_FAILED`.

Only a verified provider callback may settle an obligation. Browser return state is never payment truth. The safe Travel presentation is derived server-side:

- `未付款`: no qualifying paid leg.
- `訂金完成`: `DEPOSIT` is paid but the full obligation set is not paid.
- `已付清`: all required Commerce obligations are paid and Commerce Order/payment are both `PAID`.

### Seller and commission lifecycle

- Travel seller permission: `ACTIVE` or `REVOKED`.
- A trusted seller requires the existing verified Member -> qualified Referral -> active Dealer -> active Travel permission chain.
- The seller context is frozen at booking creation and cannot be updated, deleted, or reassigned.
- No seller remains a valid booking outcome.
- Commission eligibility is projected only after the Commerce order is fully settled.
- Deposit-only payment does not project commission eligibility.
- Conversion, evidence, attribution, calculation, and ledger dedupe rules remain the Commission authority.

### Current Travel event vocabulary

`travel_events` currently permits only:

- itinerary: `ITINERARY_CREATED`, `ITINERARY_SUBMITTED`, `ITINERARY_PUBLISHED`, `ITINERARY_REJECTED`, `ITINERARY_ARCHIVED`
- departure: `DEPARTURE_CREATED`, `DEPARTURE_OPENED`, `DEPARTURE_CLOSED`, `DEPARTURE_CANCELLED`, `DEPARTURE_ARCHIVED`
- booking/payment: `BOOKING_CREATED`, `DEPOSIT_PAID`, `BALANCE_PAID`, `FULL_PAYMENT_PAID`, `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`

The table is append-only and idempotency-capable through `(workspace_id, dedupe_key)`. It has no operational-started, fulfillment-completed, departure-completed, or internal-note event type.

## C. Operational gaps

### Departure operations

There is no single departure-scoped Tenant read combining capacity, booking counts, traveler counts, payment readiness, cancellations, safe customers, seller labels, and timeline. Current reads are itinerary-scoped departures plus a global booking list.

### Fulfillment

Current booking financial milestones are insufficient to answer whether staff have operationally confirmed or completed service. Reusing `FULLY_PAID` as fulfillment would incorrectly equate money received with service delivered. The unused `CONFIRMED` enum is also ambiguous because current payment projection appends `BOOKING_CONFIRMED` while writing `FULLY_PAID`.

### Roster

Traveler snapshots exist but there is no departure-scoped roster. A roster can be built from existing immutable `display_name`, `traveler_type`, `phone`, and `note` fields. Broad export is not approved.

### Payment visibility

The raw facts exist, but departure-level paid/deposit/unpaid counts and safe warnings are not projected in one place.

### Cancellation

Four separate facts must remain separate:

1. Departure cancellation is a TRAVEL availability/operations decision.
2. Booking cancellation is a TRAVEL booking decision.
3. Refund or payment reversal belongs to Commerce/provider financial authority.
4. Commission reversal belongs to the existing Commission ledger/settlement contract.

Current departure cancellation changes the departure and its Commerce offer availability, but does not cancel bookings, refund payments, or reverse commission. Current Commerce cancellation rejects already-paid orders and does not establish a complete Travel booking-cancellation workflow. There is no approved refund/reversal engine. Therefore 8E must initially show cancellation visibility and explicit warnings, not claim cascading cancellation.

### Readiness

No deterministic readiness projection exists. Minimum group size, reserved traveler count, dates, sales state, booking states, and payment facts already provide enough inputs for a safe first projection.

### Member post-booking

Members can already read their own booking, payment schedule, and bounded timeline, but cannot see a clearly separated departure operational phase or fulfillment milestone. They must never see internal notes, seller commission, other bookings, or another traveler's data.

## D. Proposed 8E domain model

### Read-only foundation: no new entity

8E-A should first introduce server-computed read models over existing tables:

- departure operations summary
- departure booking summary
- privacy-minimized roster
- deterministic readiness
- merged safe timeline projection using currently approved events

This slice needs no migration and creates no new authority.

### Operational mutation extension

If operational confirmation, completion, and internal notes are approved in 8E-B, introduce one new append-only entity:

`travel_operation_events`

Recommended fields:

- internal primary key and `workspace_id`
- `departure_id` required
- optional `booking_id`
- event type
- actor type and authenticated Tenant actor reference
- bounded `note_text` only for internal note events
- idempotency/dedupe key
- `occurred_at` and `created_at`

Recommended exact event types:

- `DEPARTURE_OPERATION_STARTED`
- `DEPARTURE_OPERATION_COMPLETED`
- `BOOKING_FULFILLMENT_CONFIRMED`
- `BOOKING_FULFILLMENT_COMPLETED`
- `OPERATIONAL_NOTE_ADDED`

Current state is projected from the latest valid event; no mutable status column is required. Cancellation remains in existing departure/booking authority and is never inferred from these operations events.

This is intentionally one new entity, not separate departure-operation, fulfillment, note, and timeline tables.

### Deterministic readiness

Readiness is computed, not stored and not decided by AI. Proposed safe output:

- `BLOCKED`: departure is `CANCELLED` or `ARCHIVED`, or dates/configuration are invalid for operation.
- `ATTENTION`: reserved travelers are below `minGroupSize`, any non-cancelled booking is unpaid/deposit-only near departure, or operational confirmation is incomplete.
- `READY`: departure is not cancelled/archived, reserved travelers meet minimum group size, capacity is not exceeded, every included booking has approved payment readiness, and required confirmations are present when the 8E-B event slice exists.
- `COMPLETED`: an authenticated Tenant has recorded `DEPARTURE_OPERATION_COMPLETED` and the departure was not cancelled.

Return machine-readable warning codes such as `MIN_GROUP_NOT_MET`, `PAYMENT_OUTSTANDING`, `BOOKING_CONFIRMATION_PENDING`, and `DEPARTURE_CANCELLED`. UI copy maps these codes; the browser does not calculate readiness.

`READY` is advisory operational projection, not permission to charge, refund, pay commission, or send Campaign messages.

## E. Proposed APIs

All Tenant endpoints require the existing Tenant session, Workspace resolution, TRAVEL entitlement, and role checks. External input uses only safe references.

### 8E-A read APIs

- `GET /api/travel/departures/:safeDepartureReference/operations`
  - role: `viewer`
  - returns departure header, capacity summary, booking/payment counts, deterministic readiness, warnings, and safe recent timeline
- `GET /api/travel/departures/:safeDepartureReference/bookings`
  - role: `viewer`
  - returns departure-scoped booking summaries with safe booking/customer/seller labels and server-derived payment presentation
- `GET /api/travel/departures/:safeDepartureReference/roster`
  - role: `viewer`
  - returns privacy-minimized existing traveler snapshots grouped by safe booking reference
  - no download/export disposition

Optional query filters must be enum allowlists and cannot accept Workspace, Member, Dealer, CRM, Commerce, or internal Travel IDs.

### 8E-B mutation and timeline APIs

- `POST /api/travel/bookings/:safeBookingReference/fulfillment/confirm`
- `POST /api/travel/bookings/:safeBookingReference/fulfillment/complete`
- `POST /api/travel/departures/:safeDepartureReference/operations/start`
- `POST /api/travel/departures/:safeDepartureReference/operations/complete`
- `POST /api/travel/departures/:safeDepartureReference/operations/notes`
- `GET /api/travel/departures/:safeDepartureReference/operations/events`

Writes require `admin`; reads require `viewer`. Request bodies are exact allowlists. Notes are bounded plain text, internal-only, and not returned by Member routes. Every transition is idempotent and workspace/departure/booking scoped in both service and database constraints.

Do not add a refund, commission-reversal, seller-reassignment, roster-export, or Campaign-send API in 8E.

### Member APIs

Extend existing own-booking reads rather than creating a second Member surface:

- `GET /api/member/travel/bookings/:safeBookingReference` may add safe `departureOperationalStatus`, `fulfillmentStatus`, and server-derived payment presentation.
- `GET /api/member/travel/bookings/:safeBookingReference/events` may merge only Member-safe operational milestones.

Member context continues to resolve through verified LIFF identity and must scope by Workspace, LINE account, and Member. No Member mutation of operational status is proposed.

## F. Proposed Tenant UI

Prefer the existing `旅遊管理` structure:

`出發日` -> select one departure -> `營運總覽`

Do not add a new top-level application navigation item or a fifth Travel tab.

The departure detail should contain:

- header: itinerary title, departure/return dates, sales state, booking window
- capacity cards: seat limit, reserved travelers, remaining seats, minimum group size
- booking/payment cards: bookings, travelers, unpaid, deposit-complete, fully-paid, cancelled
- deterministic readiness badge plus explicit warnings
- booking table: safe customer label, safe booking reference, traveler count, payment presentation, fulfillment presentation, safe seller label or `無`
- roster view: current low-risk traveler fields only
- timeline: safe departure and fulfillment milestones
- internal notes: visible only to authorized Tenant roles after 8E-B

Existing close-registration and cancel-departure actions remain separate. A cancel-departure confirmation must state that booking cancellation, refund, and commission reversal do not happen automatically.

Roster export is absent. A future export requires a separate privacy decision covering purpose, fields, roles, audit, retention, download lifetime, and deletion.

## G. Proposed Member UI

Inside `我的旅遊訂單` booking detail, add only:

- departure current state
- server-derived `未付款`, `訂金完成`, or `已付清`
- Member-safe fulfillment milestone
- Member-safe timeline entries

Do not expose:

- internal operational notes
- other bookings or other travelers
- seller commission, settlement, or payout
- internal IDs
- provider transaction details
- readiness internals intended only for staff

## H. Privacy boundaries

8E V1 may read only traveler fields already approved and collected by 8C:

- display name
- traveler type
- bounded phone snapshot
- bounded note snapshot

8E does not add passport number/image, national ID, birthdate, health data, bank data, identity documents, or new emergency/document fields. Any future identity-document capability is a separate high-risk phase requiring encryption, least privilege, access audit, retention, deletion, breach handling, and explicit export policy.

Public/API projections expose no LINE UID/hash, Member DB ID, Dealer DB ID, CRM Person ID, Commerce internal ID, payment obligation/transaction ID, Travel internal ID, Commission internal ID, provider secret, R2 storage key, or actor internal ID.

Internal notes must be bounded, treated as potentially personal data, excluded from Member APIs and broad analytics, and governed by an approved retention policy before implementation.

## I. Payment and cancellation authority

- Commerce payment obligations plus verified provider callbacks remain financial truth.
- Travel readiness reads Commerce; it never writes paid state.
- Browser return/query state has no authority.
- Deposit-only presentation remains `訂金完成`, never `已付清`.
- Departure cancellation does not imply booking cancellation.
- Booking cancellation does not imply provider refund/reversal.
- Refund/reversal does not automatically define Commission reversal.
- No refund engine or financial reversal is included in 8E.

Until an explicit cross-domain cancellation contract is approved, 8E may display action-needed warnings and current facts but must not offer a cascading cancel/refund/reverse button.

## J. Seller and commission boundaries

8D is frozen. 8E may read `seller_label_snapshot` through the existing safe booking projection. It must not:

- accept a seller from the browser
- reassign or retroactively add a seller
- modify Referral evidence or parentage
- recalculate Commission
- write Commission ledger entries directly
- reopen or reverse Settlement
- create or execute Payout

Operational confirmation and completion have no automatic Commission meaning. Fully settled Commerce remains the current Commission eligibility trigger unless a future Commission policy ticket explicitly changes it.

There is also no automatic CRM Stage, Tag, Follow-up, Campaign, Audience, LINE send, Points, Rewards, Contribution/Tier, or AI mutation.

## K. Migration recommendation

### Recommendation

- 8E-A read-only operations foundation: no migration.
- 8E-B operational mutations: migration needed.
- Proposed migration number: `0054_travel_operations_events.sql`.
- Migration style: additive only.

`0054` should create only `travel_operation_events`, its workspace/departure/booking foreign-key constraints, read indexes, unique dedupe key, and append-only/no-reassignment triggers. It creates no production rows, seed, fake booking, note, or backfill.

The current `travel_events.event_type` CHECK is closed over the 8C vocabulary. Adding operational types to that table in SQLite/D1 would require replacing or rebuilding the existing table, which violates the additive-only production posture. A narrowly scoped companion event stream is therefore justified. Tenant timelines may merge the two streams in a read projection; neither stream replaces Commerce transactions or Commission events.

Do not add mutable operational columns to `travel_departures` or reinterpret existing booking enum values merely to avoid the companion event table.

## L. Implementation slices

The contract complexity justifies three implementation slices plus the final gate.

### 8E-A — Departure Operations read foundation

- No migration.
- Implement departure-scoped operations summary, booking summary, privacy-minimized roster, payment presentation, and deterministic readiness from existing authorities.
- Add Tenant viewer routes and focused tests.
- No write action, export, cancellation orchestration, or Member UI.

This is the recommended first implementation ticket because it delivers operational visibility with the smallest risk and validates the projections before storing new operational facts.

### 8E-B — Operational milestones and timeline

- Add `0054_travel_operations_events.sql` only after 8E-A contracts are approved.
- Implement authenticated, idempotent operational start/completion, booking fulfillment confirmation/completion, bounded internal notes, and merged Tenant timeline.
- Preserve cancellation and financial boundaries.

### 8E-UI — Tenant and Member experience

- Add `營運總覽` inside selected `出發日` detail.
- Add roster display without export.
- Add server-authoritative readiness/payment/fulfillment presentation.
- Extend `我的旅遊訂單` with Member-safe status and timeline only.

### 8E Final Production Gate

- Full backend/frontend regression, typecheck, Wrangler dry-run, build, and lint.
- If 0054 exists: Time Travel bookmark, exact pending check, zero-row and unchanged-count validation.
- Fast-forward-only main integration, deploy only Smart Menu targets, non-mutating smoke, and no real Travel operational data.

## Explicit non-goals

8E does not implement or import:

- a Travel customer, order, payment transaction, Dealer, Referral, Commission, Settlement, or Payout authority
- refund/reversal or Commission clawback
- roster export
- passport, national-ID, health, bank, or identity-document data
- CRM/Campaign/Points/Rewards/Contribution/Tier mutation
- AI or Gemini decision authority
- TravelKeeper customer/order/payment/distributor/commission authority
- mother-site sync, Wasabi, legacy UID flows, or legacy UI
