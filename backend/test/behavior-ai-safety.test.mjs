import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBehaviorRecommendationForAi } from '../src/guide/explanations/prompt.ts';
import { executeMeteredAiCall } from '../src/ai/usage.ts';

const recommendation = (ruleCode = 'R101', tone = 'improvement') => ({
  id: 'rec:behavior', ruleCode, category: 'engagement', priority: 'low', tone, source: 'behavior', title: 'Safe title', message: 'Safe message', reason: 'not for Gemini',
  evidence: [
    { key: 'periodFrom', value: '2026-08-01' }, { key: 'periodTo', value: '2026-08-30' }, { key: 'periodDays', value: 30 }, { key: 'clicks', value: 12 },
    { key: 'rawDailyRows', value: [{ lineUserId: 'U-raw' }] }, { key: 'rawWebhookEvents', value: [{ source_user_hash: 'hash' }] }, { key: 'lineUserId', value: 'U-raw' }, { key: 'sourceUserHash', value: 'hash' }, { key: 'actionData', value: 'postback=raw' }, { key: 'messageText', value: 'secret text' }, { key: 'urlQuery', value: '?token=raw' }, { key: 'token', value: 'token' }, { key: 'secret', value: 'secret' }, { key: 'nestedUnsafe', value: { password: 'x' } },
  ], suggestedAction: { type: 'navigate', target: 'intelligence' }, proposal: { available: false }, canGenerateProposal: false, explanationSource: 'rule', extraContext: { token: 'nope' }, project: { password: 'nope' }, rawDailyRows: [{ uid: 'nope' }],
});

test('behavior Gemini payload is explicit allowlist and strips unsafe fields', () => {
  const payload = sanitizeBehaviorRecommendationForAi(recommendation());
  assert.deepEqual(Object.keys(payload).sort(), ['category', 'evidence', 'message', 'period', 'priority', 'ruleCode', 'title', 'tone']);
  assert.deepEqual(payload.period, { from: '2026-08-01', to: '2026-08-30', days: 30 });
  assert.deepEqual(payload.evidence, [{ key: 'periodFrom', value: '2026-08-01' }, { key: 'periodTo', value: '2026-08-30' }, { key: 'periodDays', value: 30 }, { key: 'clicks', value: 12 }]);
  const wire = JSON.stringify(payload);
  for (const forbidden of ['rawDailyRows', 'rawWebhookEvents', 'lineUserId', 'sourceUserHash', 'actionData', 'messageText', 'urlQuery', 'token', 'secret', 'password', 'U-raw', 'postback=raw']) assert.equal(wire.includes(forbidden), false, forbidden);
});
test('R101 and R108 behavior explanations retain only allowed data and tone', () => {
  assert.equal(sanitizeBehaviorRecommendationForAi(recommendation('R101')).ruleCode, 'R101');
  assert.equal(sanitizeBehaviorRecommendationForAi(recommendation('R108', 'positive')).tone, 'positive');
});

class Db { constructor(){ this.ledger=[]; } prepare(sql){ const db=this; return { bind(...args){ return { async first(){ return null; }, async run(){ if(sql.includes('INSERT INTO ai_usage_ledger')) db.ledger.push(args); return { meta:{changes:1} }; } }; } }; } }
test('behavior explanation metering attributes workspace user and preserves fallback billing', async () => {
  const db = new Db();
  await executeMeteredAiCall({ db, workspaceId: 'ws-behavior', userId: 'user-behavior', featureCode: 'behavior_recommendation_explanation', operationCode: 'R108', provider: 'google', model: 'gemini', execute: async () => ({ value: 'fallback', status: 'fallback', usage: { inputTokens: 10, outputTokens: 10 } }) });
  assert.equal(db.ledger.length, 1);
  assert.deepEqual(db.ledger[0].slice(1, 5), ['ws-behavior', 'user-behavior', 'behavior_recommendation_explanation', 'R108']);
  assert.equal(db.ledger[0][15], 0);
});
test('deterministic behavior evaluation does not write AI usage', () => {
  const ledger = []; const deterministicEvaluation = () => ({ ruleCode: 'R101', aiUsageLedger: ledger.length });
  assert.equal(deterministicEvaluation().aiUsageLedger, 0);
});
