import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const architecture = await readFile(new URL('../docs/8f-travel-promotion-intelligence-architecture.md', import.meta.url), 'utf8');

const requiredContracts = [
  ['production baseline is explicit', /be5442a7f549b47ec797e9efbe4fdf26c0293a54/],
  ['TravelKeeper is reference only', /TravelKeeper was inspected[\s\S]*reference behavior only[\s\S]*No TravelKeeper runtime, data/],
  ['DM is not an itinerary', /Promotion DM is promotional source material[\s\S]*DM is not a formal itinerary/],
  ['AI cannot create or update Travel', /AI extraction or promotion activation must never automatically create or[\s\S]*travel_itineraries[\s\S]*travel_departures/],
  ['AI output requires operator approval', /AI output is DRAFT ONLY[\s\S]*Operator review and explicit activation are required/],
  ['existing R2 is reused', /existing workspace-scoped `assets` metadata and[\s\S]*`smart_menu_assets` R2 binding/],
  ['PDF is deferred safely', /PDF is deferred from V1/],
  ['platform AI key only', /Only the platform-shared Gemini credential is allowed[\s\S]*No Tenant Gemini key/],
  ['AI entitlement and metering are required', /`AI`: additionally required for extract[\s\S]*every provider call must use `executeMeteredAiCall`/],
  ['strict structured output is bounded', /strict server-validated structured data[\s\S]*rejects unknown top-level keys/],
  ['prompt injection is isolated', /DM content is untrusted document data[\s\S]*cannot grant tools[\s\S]*DRAFT ONLY/],
  ['approved versions are immutable', /Approved promotion knowledge is immutable and explainable/],
  ['expired knowledge is excluded', /`expiresAt < now`[\s\S]*excluded from current-offer retrieval/],
  ['Travel live facts remain authority', /formal Travel and Commerce override promotional assumptions/],
  ['retrieval is deterministic and scoped', /Only same-workspace, `ACTIVE`, not-expired, approved versions are candidates[\s\S]*model cannot add a promotion/],
  ['five promotion formats are exact', /`SINGLE`: exactly 1[\s\S]*`CAROUSEL`: 2 through 10[\s\S]*`LIST`: 2 through 10[\s\S]*`TRAVEL_4_GRID`: exactly 4[\s\S]*`TRAVEL_6_GRID`: exactly 6/],
  ['preview never sends', /Composer preview[\s\S]*does not send LINE/],
  ['Campaign sender is not duplicated', /8F never owns audience, prepare, execution, delivery, retry, logs, or analytics/],
  ['Campaign TEXT gap is explicit', /current Campaign content contract is `TEXT` only[\s\S]*Campaign structured-content contract extension/],
  ['single webhook remains authority', /one existing Smart Menu Gateway and one webhook ingress[\s\S]*no\s+Travel webhook, DM webhook/],
  ['simulator never replies to LINE', /simulator[\s\S]*never calls LINE Reply API/],
  ['seller and referral remain frozen', /never create\/reassign a Dealer[\s\S]*fabricate seller attribution/],
  ['existing tracked link authority is reused', /Reuse the existing tracked-URI issuance\/redirect and conversion[\s\S]*must not create a second attribution\s+engine/],
  ['no Wasabi or GAS', /There is no Wasabi, GAS, or external TravelKeeper/],
  ['high-risk personal data is forbidden', /not allowed for passport, national ID, health, bank, customer[\s\S]*personal documents/],
  ['0055 is additive and not created', /8F-A needs an additive `0055` migration[\s\S]*No `0055` file is created or applied/],
];

for (const [name, pattern] of requiredContracts) {
  test(name, () => assert.match(architecture, pattern));
}

test('planning scope changes no runtime or production', () => {
  assert.match(architecture, /architecture and planning contract only/);
  assert.match(architecture, /no runtime change,[\s\S]*migration,[\s\S]*deployment,[\s\S]*production data/);
});
