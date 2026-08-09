import type { GuideContext } from '../guide/types.ts';
import type { RecommendationCandidate, RecommendationRule } from '../guide/recommendations/types.ts';

/** Smart Menu Studio heuristic. It is not a LINE official standard. */
export const OPTIMIZATION_THRESHOLDS = Object.freeze({
  minimumTrackedUriClicks: 20,
  minimumAttributedConversions: 3,
  minimumAttributionCoverage: 0.8,
  staleConversionSourceDays: 3,
  minimumObservedInteractionVolume: 30,
  lowTrackedConversionRate: 0.02,
  highTrackedConversionRate: 0.1,
});

const q = (context: GuideContext): any => (context as any).optimization || {
  period: { from: '', to: '', days: 0 }, project: {}, areas: [],
  dataQuality: { ready: false, reasonCodes: ['NO_USAGE_DATA'] },
};
const evidence = (context: GuideContext, extra: Array<{ key: string; value: string | number | boolean | null }> = []) => {
  const o = q(context); const p = o.project || {};
  return [
    { key: 'periodFrom', value: o.period?.from || '' }, { key: 'periodTo', value: o.period?.to || '' }, { key: 'periodDays', value: o.period?.days || 0 },
    { key: 'aggregateLineClicks', value: Number(p.aggregateLineClicks || 0) }, { key: 'trackedUriClicks', value: Number(p.trackedUriClicks || 0) },
    { key: 'observedActions', value: Number(p.observedActions || 0) }, { key: 'attributedConversions', value: Number(p.attributedConversions || 0) },
    { key: 'attributionCoverage', value: p.attributionCoverage ?? null }, { key: 'activeConversionSources', value: Number(p.activeConversionSources || 0) },
    { key: 'staleConversionSources', value: Number(p.staleConversionSources || 0) }, { key: 'webhookFailureRate', value: p.webhookFailureRate ?? null }, ...extra,
  ];
};
const project = (context: GuideContext, code: string, fields: any): RecommendationCandidate => ({
  ...fields, stableKey: `${context.project.id}:${code}`, entityType: 'project', entityId: context.project.id,
  source: 'optimization', canGenerateProposal: false, proposal: { available: false, type: null, reason: 'PROPOSAL_NOT_AVAILABLE' },
});
const area = (context: GuideContext, code: string, item: any, fields: any): RecommendationCandidate => ({
  ...project(context, code, fields), stableKey: `${context.project.id}:${code}:${item.areaId}`, entityType: 'project_area', entityId: item.areaId,
});

export function evaluateOptimizationDataQuality(context: GuideContext) {
  const o = q(context); const p = o.project || {}; const reasons: string[] = [];
  if (Number(p.aggregateLineClicks || 0) <= 0) reasons.push('NO_USAGE_DATA');
  if (Number(p.observedActions || 0) <= 0) reasons.push('NO_JOURNEY_DATA');
  if (!p.uriTrackingAvailable) reasons.push('URI_TRACKING_NOT_ENABLED');
  if (p.attributionCoverage === null || p.attributionCoverage === undefined || Number(p.attributionCoverage) < OPTIMIZATION_THRESHOLDS.minimumAttributionCoverage) reasons.push('ATTRIBUTION_COVERAGE_LOW');
  if (!p.conversionIntegrationAvailable) reasons.push('NO_CONVERSION_INTEGRATION');
  if (p.conversionIntegrationAvailable && Number(p.conversionSourceEvents || 0) <= 0) reasons.push('NO_CONVERSION_SOURCE_EVENTS');
  if (Number(p.staleConversionSources || 0) > 0) reasons.push('CONVERSION_SOURCE_STALE');
  if (Number(p.freshnessDays ?? Infinity) > 3) reasons.push('STALE_DATA');
  return { ready: reasons.length === 0, reasonCodes: reasons.length ? reasons : ['READY'] };
}

const R301: RecommendationRule = { code: 'R301', order: 301, evaluate(context) { const o=q(context), p=o.project||{}; const volume=Math.max(Number(p.aggregateLineClicks||0),Number(p.observedActions||0)); if(volume<OPTIMIZATION_THRESHOLDS.minimumObservedInteractionVolume || Number(p.trackedUriClicks||0)<=0 || Number(p.attributionCoverage??0)>=OPTIMIZATION_THRESHOLDS.minimumAttributionCoverage) return []; return [project(context,'R301',{category:'optimization',priority:'medium',tone:'improvement',title:'Attribution coverage is low',message:'Meaningful interaction exists, but too little can be reliably attributed. This is an observability gap, not a conversion-failure claim.',reason:'Improve reliable tracked URI or observed journey coverage before interpreting downstream performance.',evidence:evidence(context),suggestedAction:{type:'navigate',target:'journey-summary'}})]; } };
const R302: RecommendationRule = { code: 'R302', order: 302, evaluate(context) { const o=q(context), p=o.project||{}; if(!p.conversionIntegrationAvailable || Number(p.activeConversionSources||0)<=0) return []; return (o.areas||[]).filter((a:any)=>a.trackingEnabled&&Number(a.trackedUriClicks||0)>=OPTIMIZATION_THRESHOLDS.minimumTrackedUriClicks&&Number(a.attributedConversions||0)>=OPTIMIZATION_THRESHOLDS.minimumAttributedConversions&&Number(a.attributionCoverage??0)>=OPTIMIZATION_THRESHOLDS.minimumAttributionCoverage&&a.trackedObservedConversionRate!==null&&Number(a.trackedObservedConversionRate)<=OPTIMIZATION_THRESHOLDS.lowTrackedConversionRate).map((a:any)=>area(context,'R302',a,{category:'optimization',priority:'high',tone:'improvement',title:'High traffic area has low tracked conversion',message:'Reliable tracked URI observations show limited tracked conversion quality for this area.',reason:'Use the tracked URI denominator to review this downstream path; this is more specific than aggregate clicks.',evidence:evidence(context,[{key:'areaId',value:a.areaId},{key:'trackedUriClicks',value:Number(a.trackedUriClicks)},{key:'attributedConversions',value:Number(a.attributedConversions)},{key:'trackedObservedConversionRate',value:a.trackedObservedConversionRate}]),suggestedAction:{type:'navigate',target:`journey-area-${a.areaId}`}})); } };
const R303: RecommendationRule = { code: 'R303', order: 303, evaluate(context) { const o=q(context); return (o.areas||[]).filter((a:any)=>a.trackingEnabled&&Number(a.trackedUriClicks||0)>=OPTIMIZATION_THRESHOLDS.minimumTrackedUriClicks&&Number(a.attributedConversions||0)>=OPTIMIZATION_THRESHOLDS.minimumAttributedConversions&&Number(a.attributionCoverage??0)>=OPTIMIZATION_THRESHOLDS.minimumAttributionCoverage&&a.trackedObservedConversionRate!==null&&Number(a.trackedObservedConversionRate)>=OPTIMIZATION_THRESHOLDS.highTrackedConversionRate&&Number(a.aggregateLineClicks||0)<=Math.max(1,Number(o.project?.aggregateLineClicks||0)*.25)).map((a:any)=>area(context,'R303',a,{category:'optimization',priority:'low',tone:'positive',title:'Lower traffic area converts well when tracked',message:'This lower-traffic area has a strong, reliably tracked conversion signal with a sufficient sample.',reason:'Treat this as a positive optimization-quality signal, not a prediction.',evidence:evidence(context,[{key:'areaId',value:a.areaId},{key:'trackedUriClicks',value:Number(a.trackedUriClicks)},{key:'attributedConversions',value:Number(a.attributedConversions)},{key:'trackedObservedConversionRate',value:a.trackedObservedConversionRate}]),suggestedAction:{type:'navigate',target:`journey-area-${a.areaId}`}})); } };
const R304: RecommendationRule = { code: 'R304', order: 304, evaluate(context) { const p=q(context).project||{}; if(Number(p.staleConversionSources||0)<=0) return []; return [project(context,'R304',{category:'optimization',priority:'medium',tone:'improvement',title:'Conversion source is stale',message:'A previously active conversion source is stale. This is distinct from a source that has never sent events.',reason:'Review the source integration freshness without exposing source event contents.',evidence:evidence(context),suggestedAction:{type:'navigate',target:'journey-conversion'}})]; } };
const R305: RecommendationRule = { code: 'R305', order: 305, evaluate(context) { const p=q(context).project||{}; const volume=Math.max(Number(p.aggregateLineClicks||0),Number(p.observedActions||0)); if(volume<OPTIMIZATION_THRESHOLDS.minimumObservedInteractionVolume || Number(p.attributionCoverage??0)>=OPTIMIZATION_THRESHOLDS.minimumAttributionCoverage) return []; return [project(context,'R305',{category:'optimization',priority:'medium',tone:'improvement',title:'Observability gap limits interpretation',message:'Current data cannot reliably determine downstream performance because tracked or observed coverage is limited.',reason:'Improve observability first; this rule does not classify conversion performance as poor.',evidence:evidence(context),suggestedAction:{type:'navigate',target:'journey-summary'}})]; } };
const R306: RecommendationRule = { code: 'R306', order: 306, evaluate(context) { const p=q(context).project||{}, quality=evaluateOptimizationDataQuality(context); const goodWebhook=p.webhookFailureRate!==null&&Number(p.webhookFailureRate)<=.1; if(!quality.ready||!goodWebhook||Number(p.attributedConversions||0)<OPTIMIZATION_THRESHOLDS.minimumAttributedConversions||!(Number(p.trackedUriClicks||0)>0||Number(p.observedActions||0)>=OPTIMIZATION_THRESHOLDS.minimumObservedInteractionVolume)) return []; return [project(context,'R306',{category:'optimization',priority:'low',tone:'positive',title:'Optimization signals are healthy',message:'Fresh, reliable tracked and journey signals are sufficient for optimization analysis. This is not a business-success guarantee.',reason:'Continue monitoring this deterministic readiness baseline.',evidence:evidence(context),suggestedAction:{type:'navigate',target:'journey-summary'}})]; } };
export const OPTIMIZATION_RECOMMENDATION_RULES = [R301,R302,R303,R304,R305,R306];
