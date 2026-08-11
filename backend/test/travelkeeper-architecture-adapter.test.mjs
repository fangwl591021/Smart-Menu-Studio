import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const doc = await readFile(new URL('../docs/8b-travelkeeper-adapter.md', import.meta.url), 'utf8');

test('8B is an architecture-only adapter with no runtime, migration, import, or deployment', () => {
  assert.match(doc, /adds no runtime route, database migration, production data, frontend surface/);
  assert.match(doc, /creates documentation and a static architecture-contract test only/);
});

test('8B reuses Smart-Menu CRM Dealer Commerce Referral and Commission authorities', () => {
  for (const authority of [
    'CRM Person',
    'Dealer',
    'Referral evidence',
    'Commerce Order and Payment',
    'Commission, Settlement, Payout',
  ]) assert.match(doc, new RegExp(authority));
});

test('8B proposes only Travel-specific 8C entities', () => {
  for (const entity of [
    'travel_itineraries',
    'travel_departures',
    'travel_booking_extensions',
    'travel_booking_travelers',
    'travel_payment_schedules',
    'travel_seller_permissions',
    'travel_events',
  ]) assert.match(doc, new RegExp('- `' + entity + '`:'));
});

test('8B plans no duplicate customer order payment commission referral CRM or broadcast authority', () => {
  assert.match(doc, /must not create a Travel customer master, generic Travel order, provider payment authority, Travel commission ledger, second Referral authority, second CRM, broadcast engine/);
});

test('TRAVEL entitlement and Commerce dependency are backend requirements', () => {
  assert.match(doc, /All future Tenant and Member Travel routes require the `TRAVEL` entitlement at the backend/);
  assert.match(doc, /`COMMERCE`: required to enable\/use TRAVEL booking and payment features/);
  assert.match(doc, /No frontend-only entitlement decision is security authority/);
});

test('CRM is recommended and AI remains an optional gated dependency', () => {
  assert.match(doc, /`CRM`: recommended and required for CRM-integrated payer\/customer features/);
  assert.match(doc, /`AI`: optional; required in addition to TRAVEL/);
});

test('verified callback remains payment truth and ReturnURL is never authority', () => {
  assert.match(doc, /Verified provider callback remains payment truth/);
  assert.match(doc, /ReturnURL and browser query state are never paid authority/);
});

test('Travel seller identity and author capability remain separate', () => {
  assert.match(doc, /Dealer eligibility and Travel content-authoring permission are separate/);
  assert.match(doc, /must not become a generic Dealer flag/);
});

test('public Travel contracts require safe references and no client UID authority', () => {
  assert.match(doc, /never accept raw `workspace_id`/);
  assert.match(doc, /Never trust query\/body\/header `uid`, `operatorUid`/);
  assert.match(doc, /opaque, high-entropy, workspace-scoped public references/);
});

test('TravelKeeper Wasabi mother sync CRM broadcast and legacy UID patterns are not imported', () => {
  assert.match(doc, /Wasabi is not imported as authority/);
  assert.match(doc, /mother sync and `mother_sync_map` are not imported/);
  assert.match(doc, /Do not ship a second CRM UI or data model/);
  assert.match(doc, /Do not import a second broadcast/);
  assert.match(doc, /legacy UID compatibility remains an explicit source risk and is not imported/);
});

test('8B defines phased preview validation import and cutover without permanent dual write', () => {
  for (const phase of ['Phase A', 'Phase B', 'Phase C', 'Phase D', 'Phase E']) assert.match(doc, new RegExp(phase));
  assert.match(doc, /Avoid permanent dual write/);
});
