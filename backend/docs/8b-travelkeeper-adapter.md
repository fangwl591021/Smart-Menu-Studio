# 8B TravelKeeper to Smart-Menu TRAVEL Architecture Adapter

## Decision

8B defines an adapter contract only. It adds no runtime route, database migration, production data, frontend surface, or long-running synchronization process.

Smart-Menu remains the authority for Workspace identity, verified Member identity, CRM Person, Dealer, Referral evidence, Commerce Order and Payment, Commission, Settlement, Payout, Campaign, and R2 assets. The future TRAVEL module owns only travel-specific itinerary, departure, seat, booking-extension, traveler-snapshot, payment-schedule, seller-capability, and operational-event concepts.

This prevents TravelKeeper from becoming a second authority inside Smart-Menu.

## Reference audit

The audit used the actual TravelKeeper checkout at commit `b29953122010e31a7c8ea64da71ea7c55acf1e3c`. The reference repository was read-only.

Files reviewed:

- `PROCESS-SOP.md`
- `docs/travelkeeper-mother-api-contract.md`
- `docs/d1-migration-plan.md`
- `docs/sheets-to-d1-map.md`
- `docs/wasabi-to-d1-migration-plan.md`
- `admin.html`
- `dashboard.html`
- `itinerary-maintenance.html`
- `itinerary-maintenance-v2.html`
- `itinerary-maintenance-list.html`
- `booking.html`
- `Pay balance.html`
- `Agent.html`
- `internal-accounting.html`
- `internal-ops.html`
- `worker.js`
- `worker-tenant.js`
- `lib/tenant-booking-api.js`
- `lib/tenant-distributor-api.js`
- `lib/tenant-payment-api.js`
- `lib/tenant-payment-policy.js`
- `lib/referral-token.js`
- `lib/platform-settlement-api.js`
- `lib/settlement-finance-api.js`
- `lib/tenant-context.js`
- `lib/line-auth.js`
- migrations `0001` and `0100` through `0114`, with emphasis on tenant, booking, payment, customer, CRM, settlement, and identity changes

Observed TravelKeeper authorities include `distributors`, `itineraries`, `customers`, `orders`, `payment_attempts`, payout batches, tenant memberships/profiles, referral tokens/share events, platform collection settlement records, and tenant CRM records. The legacy and transitional implementations include public `uid`, `distributor_uid`, `owner_uid`, `operatorUid`, phone-primary customer identity, and browser ReturnURL flows. Newer tenant adapters verify LINE access tokens, but legacy UID compatibility remains an explicit source risk and is not imported.

## Classification legend

- `REUSE`: Smart-Menu already owns the domain and remains the only authority.
- `ADAPT`: preserve the business concept through a narrow bridge or Travel extension to an existing authority.
- `REPLACE`: retire the TravelKeeper authority and resolve it into an existing Smart-Menu authority during migration.
- `NEW_TRAVEL_DOMAIN`: create a Travel-specific authority in 8C or later.
- `DO_NOT_IMPORT`: do not bring the source feature, table, state machine, or integration into Smart-Menu.

Every source domain below has exactly one primary classification.

## Domain mapping

| TravelKeeper source domain | Current source table/field or flow | Classification | Smart-Menu authority | Adapter decision |
| --- | --- | --- | --- | --- |
| Distributor identity | `distributors.uid`, tenant membership, LINE UID | REPLACE | verified `line_oa_members` plus `line_oa_dealers` | Resolve server-side through verified Member/Dealer identity. Never copy raw UID as public authority. |
| Distributor profile | name, phone, email, company/profile links | ADAPT | CRM Person/Profile and safe Dealer projection | Import preview may match an existing verified Member/CRM Person; no second dealer profile master. |
| Distributor approval | pending/approved/active/suspended/rejected | REUSE | Dealer `PENDING/ACTIVE/SUSPENDED/REJECTED` | Map `pending -> PENDING`, `approved/active -> ACTIVE`, `suspended -> SUSPENDED`, `rejected -> REJECTED`; do not modify the Dealer state machine. |
| Upload permission | `canUpload`, editor role | NEW_TRAVEL_DOMAIN | future Travel seller capability | `TRAVEL_ITINERARY_AUTHOR` is independent of Dealer approval. It must not become a generic Dealer flag. |
| Distributor commission setting | `commission`, `commission_pct` | REPLACE | Commission program and immutable rule versions | Do not write a mutable rate onto Dealer. Import only through reviewed Commission rule mapping. |
| Distributor bank data | bank name/branch/account/holder | DO_NOT_IMPORT | future approved payout-account security contract | HIGH sensitivity. Do not copy in 8B/8C without encryption, retention, reveal audit, and access policy. |
| Invite code | `inviteCode`, `invite_code` | ADAPT | Referral identity/evidence or opaque Travel share context | Resolve to a verified Dealer through existing Referral authority. Public URLs never carry raw UID/Dealer ID. |
| Share link/Flex card | `invite`, `uid`, referral token, share events | ADAPT | safe Referral/Dealer evidence and Campaign | Issue an opaque, workspace- and purpose-bound Travel share context; Campaign owns broadcast delivery. |
| Referral attribution | customer owner, referral source | REUSE | `member_referral_attributions` and conversion referral evidence | Travel consumes trusted evidence. Referrer and commission recipient are not automatically identical. |
| Itinerary | `itineraries` metadata and publication state | NEW_TRAVEL_DOMAIN | `travel_itineraries` | Travel owns itinerary content and lifecycle; Commerce Product is never the itinerary master. |
| Itinerary review | `review_status`, review note, admin review | NEW_TRAVEL_DOMAIN | itinerary lifecycle plus append-only Travel events | Tenant owner/admin approves or publishes. Authorized Travel seller/editor creates and edits only its own drafts. System Admin is not normal Travel content approval authority. |
| Itinerary image | image URL, DM/AI-upload assets | ADAPT | Smart-Menu asset/R2 authority | Store only safe asset references. Do not create a parallel TravelKeeper bucket authority. |
| Departure/travel date | `travel_date` mixed into order/itinerary | NEW_TRAVEL_DOMAIN | `travel_departures` | Departure and booking window are separate from itinerary content and Commerce Product. |
| Seat inventory | `seat_limit`, `min_group_size`, traveler count | NEW_TRAVEL_DOMAIN | departure-scoped seat authority | Future transactional invariant: confirmed/reserved traveler count must not exceed seat limit. |
| Customer master | `customers`, phone primary key, owner UID | REPLACE | CRM Person and verified Member | No Travel customer master. Phone is normalized evidence, not a global identity key. |
| Customer LINE identity | `customer_line_uid` | REPLACE | verified LIFF `line_oa_members` and CRM identity link | Never accept a client-provided LINE UID as authority. |
| Generic order | `orders` | REPLACE | `commerce_orders` and immutable order items | Travel adds a 1:1 booking extension; it does not create a second generic order state machine. |
| Booking | itinerary/date/travelers mixed into `orders` | NEW_TRAVEL_DOMAIN | `travel_booking_extensions` linked 1:1 to Commerce Order | Holds only Travel lifecycle and frozen Travel facts. Commerce owns amount, order, and payment truth. |
| Traveler/passenger | numeric `travelers`; future personal details | NEW_TRAVEL_DOMAIN | `travel_booking_travelers` immutable snapshots | Payer/customer is not every traveler. Do not auto-create CRM People for passengers. |
| Deposit/balance policy | itinerary `payment_mode`, ratio/amount, balance collection | NEW_TRAVEL_DOMAIN | `travel_payment_schedules` | Freeze FULL or DEPOSIT_BALANCE amounts and policy at booking creation using integer minor units. |
| Payment attempt | `payment_attempts` with deposit/balance leg | ADAPT | Commerce Payment intent/transaction plus a Travel leg association | Commerce remains provider and callback authority. 8C must not duplicate provider credentials or callback verification. |
| Payment truth | notify/return flows | REUSE | Commerce verified provider callback | Browser ReturnURL is navigation only. Verified callback is the only paid authority. |
| Commission snapshot | amount/rate frozen on order | ADAPT | Travel booking eligibility snapshot feeding Commission | Freeze seller, rule/evidence reference, basis, and calculated candidate facts; actual earning is created only by Commission authority. |
| Commission payable | full paid or balance paid | ADAPT | existing Commission eligibility/calculation engine | FULL paid or BALANCE paid may emit trusted eligibility. Deposit-only does not create payable commission. |
| Commission ledger | order `commission_status` | REPLACE | `commission_calculations` and `commission_ledger_entries` | No Travel commission ledger or mutable paid-out flag. |
| Commission settlement | payout batches/order flags | REUSE | Commission Settlement | Use existing locked/finalized/cancelled snapshot authority. |
| Payout | `paid_out`, payout batch, operator UID | REUSE | Payout Request and Payment Execution | Do not import the TravelKeeper payout state machine. Existing provider support remains `INTERNAL_TEST` until separately expanded. |
| CRM page/functions | `crm.html`, tenant CRM tables | DO_NOT_IMPORT | Smart-Menu CRM | Do not ship a second CRM UI or data model. |
| Broadcast/LINE marketing | broadcast workbench, Flex push | DO_NOT_IMPORT | Smart-Menu Campaign | Do not import a second broadcast, push, retry, or audience engine. |
| LINE/member authentication | LIFF token plus legacy UID compatibility | REPLACE | existing verified Tenant/Member authentication | Server derives Workspace, Member, Dealer, and CRM Person. Query/body/header UID is never an authority. |
| Admin approval | front-end `operatorUid` and admin UID sets | REPLACE | authenticated Tenant owner/admin role | No client operator identity. System Admin manages platform/module entitlement, not ordinary itinerary approval. |
| AI itinerary | AI itinerary/DM helpers | DO_NOT_IMPORT | future TRAVEL + AI adapter | Not imported now. Future use requires TRAVEL enabled, AI enabled, and provider readiness. |
| R2 storage | TravelKeeper R2 image assets | REUSE | Smart-Menu R2/assets | Reuse scoped asset ownership and safe projections. |
| Wasabi archive/sync | Wasabi prefixes, export/import preview | DO_NOT_IMPORT | none in V1 | May be reconsidered only as a one-way external archive adapter; never live business authority. |
| Mother-site sync | API key/HMAC mother sync map | DO_NOT_IMPORT | Smart-Menu platform authority | Smart-Menu is the mother/platform. Do not adopt permanent mother sync or bidirectional authority. |
| Internal accounting UI | receipts, payment facts, settlement and manual controls | ADAPT | Commerce + Commission + Travel events | Split facts by owning domain; do not copy the UI or its client UID authorization. |
| 7C click engagement | share/campaign click evidence | REUSE | Campaign tracked-link and trusted attribution evidence | Travel consumes evidence and emits no duplicate click-tracking authority. |
| Commerce conversion | paid Travel booking | REUSE | Commerce Conversion bridge | A verified paid booking can feed the existing conversion seam; do not create generic `travel_conversion_events`. |

## Distributor and seller authority

Dealer eligibility and Travel content-authoring permission are separate:

1. The person must resolve from verified Member identity to an existing Dealer.
2. Dealer status must be `ACTIVE` to sell or receive Travel commission eligibility.
3. A separate Travel permission grants itinerary authoring. Recommended capability: `TRAVEL_ITINERARY_AUTHOR`.
4. The permission is workspace-scoped, references the Dealer internally, and exposes only an opaque safe reference.
5. Tenant owner/admin grants or revokes the capability. A seller cannot grant it to itself.
6. Revocation blocks new authoring but does not rewrite itineraries, bookings, payments, or commissions.

`travel_seller_permissions` is required only because the existing role/module framework cannot express per-Dealer Travel authoring. It is not a new identity, profile, approval, or commission table.

## Itinerary and review contract

Conceptual `travel_itineraries` fields for 8C:

- internal id and `workspace_id`
- unique opaque public/safe reference
- title, region, description, notes, duration days
- safe cover asset reference
- status: `DRAFT`, `PENDING_REVIEW`, `PUBLISHED`, `REJECTED`, `ARCHIVED`
- internal author Dealer reference when seller-authored
- review note/reason code and lifecycle timestamps
- created/updated/archive timestamps

Authority:

- Tenant owner/admin: create, edit, review, publish, reject, archive.
- Active Dealer with Travel author capability: create and edit only its own `DRAFT`, `PENDING_REVIEW`, or rejected revision; submit for review; never directly publish.
- Tenant viewer: read safe Tenant projections.
- Member/public: read only published, active, safe projections.

Admin-created content may be published directly. Seller-created content begins as `DRAFT` and requires explicit submission to `PENDING_REVIEW`. Editing a published seller itinerary must create a new reviewable version or move a controlled revision back through review; it must not silently change the currently published facts.

## Departure and seat contract

Conceptual `travel_departures` fields:

- itinerary reference
- departure and optional return date
- seat limit and minimum group size
- booking open/close timestamps
- status: `DRAFT`, `OPEN`, `CLOSED`, `SOLD_OUT`, `DEPARTED`, `CANCELLED`, `ARCHIVED`
- optional Commerce offer reference
- immutable/frozen public pricing-policy reference used by new bookings

Departure is Travel authority. A Commerce Product may be a one-way purchasable offer bridge, but product edits cannot rewrite itinerary content, departure dates, seat capacity, or historical booking snapshots.

8C must design an atomic reservation/confirmation invariant. At minimum, active reserved or confirmed traveler count plus a new claim cannot exceed `seat_limit`. Cancellation/release semantics require an auditable event and idempotent transition. 8B does not implement concurrency or inventory mutation.

## Booking, customer, and traveler contract

`commerce_orders` remains the generic order and financial total authority. A single `travel_booking_extensions` record links 1:1 to a Commerce Order and freezes:

- itinerary and departure safe/internal references
- itinerary title and departure date snapshots needed for historical display
- payer CRM Person/Member relation through existing Commerce order ownership
- traveler count
- Travel booking status and notes
- payment schedule reference
- seller/Dealer reference and trusted acquisition evidence reference
- commission eligibility snapshot reference/facts

Recommended Travel booking lifecycle:

- `PENDING`: booking/order created, no qualifying payment.
- `DEPOSIT_PAID`: verified deposit leg paid; not commission-payable.
- `CONFIRMED`: operational confirmation after the required initial payment and seat checks.
- `BALANCE_DUE`: deposit booking requires remaining payment.
- `FULLY_PAID`: FULL leg, or DEPOSIT plus BALANCE legs, are verified paid.
- `CANCELLED`: operational cancellation; it does not reverse provider or ledger truth.

State derives from Commerce payment-leg truth and explicit Travel operational decisions. Do not overload or rewrite Commerce Order statuses.

`travel_booking_travelers` stores immutable booking snapshots, not CRM identities. Each row is scoped to a booking and sequence. LOW/MEDIUM fields may include name, contact phone snapshot, emergency-contact snapshot, and document-completion status when justified. Birthdate, passport, national ID, passport image, and similar fields are HIGH sensitivity and are excluded from 8C until the business need, encryption, retention, deletion, export, audit, and role policy are approved.

One Member/CRM Person may pay for multiple travelers. Travelers are not automatically converted into CRM People.

## Payment schedule and provider contract

The future `travel_payment_schedules` authority freezes one of:

- `FULL`: one Commerce payment leg for the frozen total.
- `DEPOSIT_BALANCE`: deposit and balance amounts whose integer-minor-unit sum equals the frozen Commerce Order total.

For deposit bookings, freeze payment mode, deposit ratio or fixed amount, computed deposit amount, computed balance amount, currency, balance collection policy, and source policy version when the booking is created. Later itinerary/departure edits never change a historical booking.

Each payable leg creates or binds a Commerce payment intent. Balance is a second payment leg, never a manual reduction or mutation of order total. A future Commerce extension must allow an immutable leg reference while keeping provider credentials, merchant order number, callback verification, transaction records, and paid terminal state in Commerce.

Current payment-method classification:

| TravelKeeper method | Classification | Decision |
| --- | --- | --- |
| `credit_card` | SUPPORTED_NOW | Current Commerce NewebPay checkout explicitly enables credit card, subject to workspace provider readiness. |
| `linepay` | FUTURE_PROVIDER | Not supported by current Smart-Menu Commerce provider contract. |
| `vacc` / ATM | FUTURE_PROVIDER | Not enabled by the current Smart-Menu NewebPay checkout contract. |
| `offline` | MANUAL_OFFLINE_EVIDENCE | May become reviewed operational evidence, never a forged provider callback or automatic paid truth. |

Verified provider callback remains payment truth. ReturnURL and browser query state are never paid authority.

## Commission and attribution bridge

Travel seller ownership and Referral attribution are separate facts. A booking can have:

- an operational seller/Dealer responsible for the booking;
- trusted Referral, Campaign, or 7C acquisition evidence;
- a Commission program/rule that decides eligibility and recipient.

Priority must be explicit and server-side. Recommended V1 policy:

1. Resolve the operational seller from a signed/opaque Travel share context or server-selected direct seller.
2. Preserve independent trusted Referral/Campaign evidence.
3. Ask the existing Commission program/rule whether the Dealer is eligible and which evidence is authoritative.
4. Never assume the first referrer, last click, payer, or itinerary author is the commission recipient.

At booking creation, freeze the Dealer, Commission program/rule reference, calculation mode, eligible basis, and candidate rate/amount facts needed for audit. This is not a ledger entry. After verified FULL payment, or verified BALANCE completion for a deposit booking, a trusted bridge may create the existing conversion/attribution/calculation input. Commission alone creates `commission_ledger_entries`; Settlement and Payout remain unchanged.

Allowed booking-source concepts are `DIRECT`, `DEALER_SHARE`, `REFERRAL`, `CAMPAIGN`, and `OTHER_APPROVED`, but every non-direct source must point to existing trusted evidence. Arbitrary query parameters are not evidence.

## Travel operational events

`travel_events` is an append-only operational audit/event stream, not a replacement for Commerce transactions, Conversion events, Commission ledger entries, or Campaign click events.

Initial event types may include:

- `BOOKING_CREATED`
- `DEPOSIT_PAID_OBSERVED`
- `BALANCE_PAID_OBSERVED`
- `BOOKING_CONFIRMED`
- `BOOKING_CANCELLED`
- `TRAVEL_COMPLETED`
- itinerary review/publication events
- seat reservation/release events

Payment-observed events must reference immutable Commerce truth and be idempotent. They cannot make a payment paid by themselves.

## Entitlement contract

All future Tenant and Member Travel routes require the `TRAVEL` entitlement at the backend.

Dependency decision:

- `COMMERCE`: required to enable/use TRAVEL booking and payment features.
- `CRM`: recommended and required for CRM-integrated payer/customer features.
- `DEALER_COMMISSION`: required only for seller/commission features.
- `AI`: optional; required in addition to TRAVEL for AI itinerary features, together with provider readiness.

The existing 8A dependency engine already requires CRM and COMMERCE when enabling TRAVEL. 8B changes no dependency code.

No frontend-only entitlement decision is security authority. Member Travel routes verify LIFF identity before resolving Workspace and checking TRAVEL.

## Safe API draft for 8C

The route names are a contract draft and must be reconciled with existing route conventions during 8C.

Tenant reads/writes:

- `GET /api/travel/itineraries`
- `POST /api/travel/itineraries`
- `GET /api/travel/itineraries/:safeTravelItineraryReference`
- `PATCH /api/travel/itineraries/:safeTravelItineraryReference`
- `POST /api/travel/itineraries/:safeTravelItineraryReference/submit-review`
- `POST /api/travel/itineraries/:safeTravelItineraryReference/publish`
- `POST /api/travel/itineraries/:safeTravelItineraryReference/reject`
- `POST /api/travel/itineraries/:safeTravelItineraryReference/archive`
- `GET /api/travel/departures`
- `POST /api/travel/departures`
- `GET /api/travel/departures/:safeTravelDepartureReference`
- `PATCH /api/travel/departures/:safeTravelDepartureReference`
- `GET /api/travel/bookings`
- `GET /api/travel/bookings/:safeTravelBookingReference`

Member reads/writes:

- `GET /api/member/travel/itineraries`
- `GET /api/member/travel/itineraries/:safeTravelItineraryReference`
- `GET /api/member/travel/departures`
- `GET /api/member/travel/departures/:safeTravelDepartureReference`
- `POST /api/member/travel/bookings`
- `GET /api/member/travel/bookings`
- `GET /api/member/travel/bookings/:safeTravelBookingReference`

External requests use only opaque safe references. They never accept raw `workspace_id`, internal Workspace ID, Dealer ID, CRM Person ID, Member ID, Commerce Order ID, or client-supplied UID as authority.

## Privacy and security classification

| Level | Examples | Policy |
| --- | --- | --- |
| LOW | published itinerary title, region, duration, public price | Safe bounded public projection after publication rules. |
| MEDIUM | booking notes, contact snapshot, emergency contact, operational document status | Authenticated, workspace/booking scoped, minimized, retention-limited, excluded from broad analytics. |
| HIGH | passport, national ID, birthdate, bank data, passport image | Not implemented in 8C without explicit need and approved encryption, retention, deletion, audit, export, and least-privilege policy. |

Security requirements:

- Use existing Tenant session or verified LIFF Member authentication.
- Resolve Workspace, Member, CRM Person, Dealer, Commerce Order, and entitlement server-side.
- Never trust query/body/header `uid`, `operatorUid`, raw Dealer ID, or raw Workspace ID.
- Use opaque, high-entropy, workspace-scoped public references and purpose-bound share contexts.
- Never expose provider secrets, raw LINE UID, identity hash, passport/ID values, bank account data, or internal audit IDs.
- Preserve one payment authority, one referral authority, one commission ledger, and one LINE/Campaign execution owner.

## Internal accounting split

The TravelKeeper accounting screens combine facts from several authorities. The adapter separates them:

- Commerce owns payment intent/transaction facts and verified callback results.
- Commission owns earned ledger, settlement, payout request, and payment execution.
- TRAVEL owns itinerary/departure/booking operational milestones, cancellation reason, and travel completion.
- Manual offline collection is evidence requiring an authenticated, audited review path; it cannot directly impersonate provider success.
- Receipt screens and operator UID controls are not imported wholesale.

## Storage, AI, Campaign, and mother-site boundaries

- Reuse Smart-Menu R2 and asset authorization for Travel covers/documents. Wasabi is not imported as authority.
- AI itinerary assistance is a future adapter requiring TRAVEL + AI + provider readiness; no TravelKeeper AI implementation is copied.
- Broadcast and audience delivery remain in Campaign. Travel may request a campaign through future approved contracts but cannot send independently.
- Smart-Menu is the platform/mother authority. TravelKeeper HMAC/API-key mother sync and `mother_sync_map` are not imported.
- No long-term bidirectional sync is recommended.

## Data migration strategy

No data migration occurs in 8B.

1. **Phase A — schema:** approve and apply only new Travel-specific entities after 8C regression and production gate.
2. **Phase B — read-only import preview:** parse TravelKeeper exports into non-production preview/staging with source fingerprints; no business writes.
3. **Phase C — mapping validation:** manually resolve Workspace, Member/CRM Person, Dealer, Commerce offer/order, Referral evidence, and rejected/high-risk fields.
4. **Phase D — controlled import:** bounded, idempotent batches with counts, error queue, immutable source checksum, and rollback/bookmark procedure.
5. **Phase E — legacy cutover:** freeze legacy writes, reconcile counts and payment/commission truth, switch Smart-Menu TRAVEL to authority, then retain TravelKeeper read-only for the approved retention window.

Before cutover, TravelKeeper may remain the legacy operational authority. After cutover, Smart-Menu TRAVEL is the authority. Avoid permanent dual write. If a short transition window is unavoidable, define one write owner per entity, a deterministic conflict policy, reconciliation reports, and an explicit end time.

## 8C proposed entities

8C should propose only these Travel-specific entities, with final names subject to schema review:

- `travel_itineraries`: itinerary content, safe reference, author, lifecycle, and safe asset reference.
- `travel_departures`: itinerary occurrence, booking window, capacity, and status.
- `travel_booking_extensions`: 1:1 Travel extension of an existing Commerce Order.
- `travel_booking_travelers`: immutable passenger snapshots with privacy-minimized fields.
- `travel_payment_schedules`: frozen FULL or DEPOSIT_BALANCE schedule and Commerce payment-leg associations.
- `travel_seller_permissions`: Travel-specific itinerary author capability referencing an existing Dealer.
- `travel_events`: append-only Travel operational events and idempotent observations.

8C must not create a Travel customer master, generic Travel order, provider payment authority, Travel commission ledger, second Referral authority, second CRM, broadcast engine, or mother-site sync.

## 8C required invariants

- Every table is `workspace_id` scoped and every external identifier is opaque.
- All routes require backend TRAVEL entitlement; booking/payment flows also require COMMERCE.
- Existing Workspace without entitlement rows retains 8A legacy compatibility; no 8B code changes this rule.
- Itinerary publication is Tenant owner/admin authority; seller authoring is own-record and capability scoped.
- Commerce Order owns total/currency/status; Travel snapshots cannot mutate financial truth.
- FULL amount, or DEPOSIT plus BALANCE amounts, equal the frozen Commerce Order total using integer minor units.
- Payment legs reference Commerce intents/transactions and cannot independently mark paid.
- Traveler count and seat claims are bounded and atomically enforced.
- Customer/payer resolves to existing Member/CRM Person; passengers are snapshots.
- Commission eligibility is emitted only after the configured verified payment completion and never writes a Travel ledger.
- No existing CRM, Dealer, Commerce, Referral, Campaign, Commission, Settlement, Payout, Point, or LINE business row is mutated by schema installation.

## 8B non-goals and checkpoint

8B creates documentation and a static architecture-contract test only. It creates no migration, route, table, production row, data import, deployment, frontend component, provider integration, or TravelKeeper repository change.
