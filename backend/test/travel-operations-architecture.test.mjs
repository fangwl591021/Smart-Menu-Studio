import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const architecture = await readFile(new URL('../docs/8e-travel-operations-architecture.md', import.meta.url), 'utf8');

const requiredContracts = [
  ['production baseline is explicit', /4b9a699aa42c87dab22eec9124aca2e03f211255/],
  ['current itinerary lifecycle is exact', /`DRAFT`[\s\S]*`PENDING_REVIEW`[\s\S]*`PUBLISHED`[\s\S]*`REJECTED`[\s\S]*`ARCHIVED`/],
  ['current departure lifecycle is exact', /`DRAFT`[\s\S]*`OPEN`[\s\S]*`CLOSED`[\s\S]*`SOLD_OUT`[\s\S]*`CANCELLED`[\s\S]*`ARCHIVED`/],
  ['current booking lifecycle is exact', /`PENDING_PAYMENT`[\s\S]*`DEPOSIT_PAID`[\s\S]*`CONFIRMED`[\s\S]*`BALANCE_DUE`[\s\S]*`FULLY_PAID`[\s\S]*`CANCELLED`/],
  ['Commerce remains payment authority', /Commerce payment obligations plus verified provider callbacks remain financial truth/],
  ['deposit is not shown as fully paid', /Deposit-only presentation remains `訂金完成`, never `已付清`/],
  ['cancellation domains remain separate', /Departure cancellation does not imply booking cancellation[\s\S]*Booking cancellation does not imply provider refund\/reversal[\s\S]*Refund\/reversal does not automatically define Commission reversal/],
  ['readiness is deterministic', /Readiness is computed, not stored and not decided by AI/],
  ['first slice is read only', /8E-A — Departure Operations read foundation[\s\S]*No migration/],
  ['operations stay inside departure detail', /`出發日` -> select one departure -> `營運總覽`/],
  ['roster export is not approved', /Roster export is absent/],
  ['high-risk traveler data is excluded', /does not add passport number\/image, national ID, birthdate, health data, bank data/],
  ['safe references and IDs remain private', /expose no LINE UID\/hash, Member DB ID, Dealer DB ID, CRM Person ID, Commerce internal ID/],
  ['seller cannot be reassigned', /must not:[\s\S]*reassign or retroactively add a seller/],
  ['no automatic cross-domain mutation', /no automatic CRM Stage, Tag, Follow-up, Campaign, Audience, LINE send, Points, Rewards, Contribution\/Tier, or AI mutation/],
  ['0054 is additive only', /`0054_travel_operations_events\.sql`[\s\S]*additive only/],
  ['event companion is justified by D1 constraint', /event_type` CHECK is closed[\s\S]*replacing or rebuilding the existing table[\s\S]*violates the additive-only/],
  ['TravelKeeper authority is not imported', /TravelKeeper customer\/order\/payment\/distributor\/commission authority/],
];

for (const [name, pattern] of requiredContracts) {
  test(name, () => assert.match(architecture, pattern));
}

test('planning document does not approve production execution', () => {
  assert.match(architecture, /planning contract only/);
  assert.match(architecture, /proposes no runtime change, migration, deployment, production data/);
});
