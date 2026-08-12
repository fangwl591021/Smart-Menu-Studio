import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { requireWorkspaceModule, tenantModuleForPath } from '../src/modules/entitlements.ts';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [promotionRoutesSource, campaignRoutesSource, composerSource] = await Promise.all([
  read('../src/travel/promotion-routes.ts'),
  read('../src/campaign/campaign-routes.ts'),
  read('../src/travel/promotion-composer.ts'),
]);

class EntitlementDb {
  constructor({ travel, campaign }) {
    this.statuses = new Map([
      ['CRM', 'ENABLED'],
      ['COMMERCE', 'ENABLED'],
      ['TRAVEL', travel ? 'ENABLED' : 'DISABLED'],
      ['CAMPAIGN', campaign ? 'ENABLED' : 'DISABLED'],
    ]);
  }

  prepare() {
    return {
      bind: (_workspaceId, moduleKey) => ({
        first: async () => ({ status: this.statuses.get(moduleKey) }),
      }),
    };
  }
}

const previewAccess = db => requireWorkspaceModule({ db, workspaceId: 'workspace-a', moduleKey: 'TRAVEL' });
const handoffAccess = async db => {
  await requireWorkspaceModule({ db, workspaceId: 'workspace-a', moduleKey: 'CAMPAIGN' });
  await requireWorkspaceModule({ db, workspaceId: 'workspace-a', moduleKey: 'TRAVEL' });
};

const matrix = [
  { travel: true, campaign: true, preview: true, handoff: true },
  { travel: true, campaign: false, preview: true, handoff: false },
  { travel: false, campaign: true, preview: false, handoff: false },
  { travel: false, campaign: false, preview: false, handoff: false },
];

for (const entry of matrix) {
  test(`entitlement matrix TRAVEL ${entry.travel ? 'yes' : 'no'} / CAMPAIGN ${entry.campaign ? 'yes' : 'no'}`, async () => {
    const db = new EntitlementDb(entry);
    if (entry.preview) await assert.doesNotReject(() => previewAccess(db));
    else await assert.rejects(() => previewAccess(db), /MODULE_NOT_ENABLED/);

    if (entry.handoff) await assert.doesNotReject(() => handoffAccess(db));
    else await assert.rejects(() => handoffAccess(db), /MODULE_NOT_ENABLED/);
  });
}

test('compose preview is guarded by the TRAVEL route boundary without an inner CAMPAIGN requirement', () => {
  assert.equal(tenantModuleForPath('/api/travel/promotions/compose'), 'TRAVEL');
  const start = promotionRoutesSource.indexOf("app.post('/api/travel/promotions/compose'");
  const end = promotionRoutesSource.indexOf("app.put('/api/travel/promotions/:safePromotionReference/formal-link'", start);
  assert.ok(start >= 0 && end > start);
  const composeRoute = promotionRoutesSource.slice(start, end);
  assert.match(composeRoute, /composeTravelPromotions/);
  assert.doesNotMatch(composeRoute, /moduleKey\s*:\s*'CAMPAIGN'/);
  assert.doesNotMatch(composeRoute, /createCampaign|prepareCampaign|sendLine|delivery/i);
});

test('structured Campaign handoff remains protected by both CAMPAIGN and TRAVEL', () => {
  const start = campaignRoutesSource.indexOf('async function requireStructuredTravelModules');
  const end = campaignRoutesSource.indexOf('function fail', start);
  assert.ok(start >= 0 && end > start);
  const handoffGuard = campaignRoutesSource.slice(start, end);
  assert.match(handoffGuard, /moduleKey\s*:\s*'CAMPAIGN'/);
  assert.match(handoffGuard, /moduleKey\s*:\s*'TRAVEL'/);
});

test('composer remains preview-only and has no Campaign or LINE authority', () => {
  assert.doesNotMatch(composerSource, /createCampaign|prepareCampaign|executeCampaign|sendLine|message\/push|delivery/i);
});
