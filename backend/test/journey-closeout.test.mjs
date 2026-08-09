import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JOURNEY_RECOMMENDATION_RULES } from '../src/journey/recommendations.ts';
import { sanitizeJourneyRecommendationForAi } from '../src/guide/explanations/prompt.ts';

const baseJourney = (overrides = {}) => ({ period:{ from:'2026-08-01', to:'2026-08-09', days:9 }, project:{ observedActions:100, aggregateClicks:100, keywordMatches:5, webhookRoutes:50, webhookSuccesses:48, webhookFailures:2, conversions:20 }, areas:[{ areaId:'area-a', label:'A', actionType:'postback', sessions:50, observedActions:50, aggregateClicks:5, conversions:10, observedConversionRate:.2 }], dataQuality:{ ready:true, reasonCodes:[], observedSessions:100, webhookSamples:50, conversionSamples:20, freshnessDays:0, mappingRatio:1, conversionIntegrationAvailable:true }, ...overrides });
const context = journey => ({ project:{ id:'project-a', name:'A', status:'draft', templateId:'t', assetId:'a', areaCount:1 }, journey, behavior:undefined, areas:[], lineAccount:{}, completeness:{} });
const rule = code => JOURNEY_RECOMMENDATION_RULES.find(item => item.code === code);
const has = (code, journey) => rule(code).evaluate(context(journey));

test('4F-3B journey data quality reason states and conversion-integration gates are deterministic', () => {
  for (const reason of ['NO_JOURNEY_DATA','INSUFFICIENT_OBSERVED_SESSIONS','INSUFFICIENT_WEBHOOK_SAMPLES','INSUFFICIENT_CONVERSION_SAMPLES','STALE_DATA','MAPPING_INCOMPLETE']) assert.equal(has('R201', baseJourney({ dataQuality:{ ...baseJourney().dataQuality, ready:false, reasonCodes:[reason] } })).length, 0, reason);
  const unavailable = baseJourney({ dataQuality:{ ...baseJourney().dataQuality, ready:true, reasonCodes:['NO_CONVERSION_INTEGRATION'], conversionIntegrationAvailable:false }, project:{ ...baseJourney().project, webhookRoutes:50, webhookFailures:15, keywordMatches:5 } });
  assert.equal(has('R201', unavailable).length, 0); assert.equal(has('R202', unavailable).length, 0); assert.equal(has('R205', unavailable).length, 0); assert.equal(has('R206', unavailable).length, 0);
  assert.equal(has('R203', unavailable).length, 1); assert.equal(has('R204', unavailable).length, 1);
});

test('R201-R206 trigger thresholds, tone, safety, stable keys, and deterministic order', () => {
  const cases = [
    ['R201', baseJourney({ areas:[{ ...baseJourney().areas[0], aggregateClicks:30, observedConversionRate:.01 }] }), 'improvement'],
    ['R202', baseJourney(), 'positive'],
    ['R203', baseJourney({ project:{ ...baseJourney().project, webhookRoutes:50, webhookFailures:12 } }), 'improvement'],
    ['R204', baseJourney({ project:{ ...baseJourney().project, keywordMatches:5 } }), 'improvement'],
    ['R205', baseJourney({ project:{ ...baseJourney().project, webhookRoutes:500, webhookSuccesses:500, conversions:10 } }), 'improvement'],
    ['R206', baseJourney(), 'positive'],
  ];
  for (const [code, journey, tone] of cases) { const first=has(code, journey), second=has(code, journey); assert.ok(first.length, code); assert.deepEqual(first, second); assert.equal(first[0].source,'journey'); assert.equal(first[0].tone,tone); assert.equal(first[0].proposal.available,false); assert.equal(first[0].proposal.reason,'PROPOSAL_NOT_AVAILABLE'); assert.ok(first[0].stableKey); }
  assert.equal(has('R201', baseJourney({ areas:[{ ...baseJourney().areas[0], sessions:29, aggregateClicks:30, observedConversionRate:.01 }] })).length,0);
  assert.equal(has('R202', baseJourney({ areas:[{ ...baseJourney().areas[0], sessions:5, observedActions:5 }] })).length,0);
  assert.equal(has('R203', baseJourney({ project:{ ...baseJourney().project, webhookRoutes:19, webhookFailures:19 } })).length,0);
  assert.equal(has('R205', baseJourney({ project:{ ...baseJourney().project, conversions:9 } })).length,0);
});

test('Journey Gemini payload has an explicit primitive allowlist and drops unsafe fields', () => {
  const payload=sanitizeJourneyRecommendationForAi({ ruleCode:'R202', category:'conversion', priority:'low', tone:'positive', title:'safe', message:'safe', evidence:[{key:'periodFrom',value:'2026-08-01'},{key:'periodTo',value:'2026-08-09'},{key:'periodDays',value:9},{key:'aggregateClicks',value:5},{key:'mappingRatio',value:null},{key:'rawDailyRows',value:'secret'},{key:'journey_session_id',value:'session'},{key:'metadata_safe_json',value:'secret'},{key:'webhookBody',value:'body'},{key:'lineUid',value:'uid'},{key:'token',value:'token'},{key:'unknown',value:'unknown'}], rawDailyRows:[1], rawConversionRows:[1], metadata_safe_json:{ x:1 }, journey_session_id:'session', token:'token' });
  assert.deepEqual(Object.keys(payload).sort(),['category','evidence','message','period','priority','ruleCode','title','tone']);
  assert.deepEqual(payload.period,{from:'2026-08-01',to:'2026-08-09',days:9});
  assert.deepEqual(payload.evidence.map(item=>item.key),['periodFrom','periodTo','periodDays','aggregateClicks','mappingRatio']);
  assert.equal(JSON.stringify(payload).includes('secret'),false);
  assert.equal(JSON.stringify(payload).includes('session'),false);
});

test('4F-3B proposal, metering, grouping, settings, and admin UI completion gates are present', async () => {
  const [index, engine, settings, health, app, journeyUi] = await Promise.all([
    readFile(new URL('../src/index.ts', import.meta.url),'utf8'), readFile(new URL('../src/guide/recommendations/engine.ts', import.meta.url),'utf8'), readFile(new URL('../../frontend/src/components/ConversionApiKeyPanel.jsx', import.meta.url),'utf8'), readFile(new URL('../../frontend/src/components/LineIntelligenceHealthPanel.jsx', import.meta.url),'utf8'), readFile(new URL('../../frontend/src/App.jsx', import.meta.url),'utf8'), readFile(new URL('../../frontend/src/components/JourneyIntelligencePanel.jsx', import.meta.url),'utf8'),
  ]);
  for(const code of ['R201','R202','R203','R204','R205','R206']) assert.match(index,new RegExp("recommendation.source === 'journey'"));
  assert.match(index,/PROPOSAL_NOT_AVAILABLE/); assert.match(index,/journey_recommendation_explanation/); assert.match(index,/app\.get\('\/api\/system\/journey-health'/);
  assert.match(engine,/usage-vs-conversion-quality/); assert.match(engine,/R101.*R202/);
  for(const word of ['Conversion API','請立即複製，此金鑰之後不會再次顯示。']) assert.ok(settings.includes(word),word);
  assert.equal(/localStorage\.(setItem|getItem)|sessionStorage\.(setItem|getItem)|indexedDB/.test(settings),false);
  for(const word of ['Journey Ready','Conversion Integration','Active Keys','Last Journey Event','Last Conversion Event','Webhook Failure Rate','value === null']) assert.ok(health.includes(word),word);
  assert.match(app,/currentView === 'settings' && !isPlatformAdminMode/); assert.match(app,/ConversionApiKeyPanel/);
  for(const target of ['journey-summary','journey-funnel','journey-webhook','journey-conversion','journey-area-']) assert.ok(journeyUi.includes(target),target);
  assert.equal(journeyUi.includes('Proposal'),false);
});
