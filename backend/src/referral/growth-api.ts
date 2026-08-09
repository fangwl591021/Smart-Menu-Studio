import { evaluateReferralGrowthDataQuality, referralFunnelRates, referralGrowthRecommendations } from './growth.ts';

const SOURCES=['qr','line_share','web_share'];
const n=(v:unknown)=>Number(v||0);
export const referralGrowthPeriod=(value:unknown)=>String(value)==='7d'?7:30;
export async function referralGrowthSnapshot(db:D1Database,input:{workspaceId:string;lineAccountId?:string;days:number;inviterMemberId?:string;referralIdentityId?:string}){
  const since=new Date(Date.now()-input.days*86400000).toISOString();
  const scope=input.lineAccountId?' AND line_account_id=?':'';
  const accountArgs=input.lineAccountId?[input.workspaceId,input.lineAccountId,since]:[input.workspaceId,since];
  const eventRows:any[]=(await db.prepare(`SELECT event_type,source,COUNT(*) count,MAX(occurred_at) last_at FROM member_referral_events WHERE workspace_id=?${scope} AND occurred_at>=? GROUP BY event_type,source`).bind(...accountArgs).all()).results||[];
  const qualifiedRows:any[]=(await db.prepare(`SELECT source,COUNT(*) count,MAX(qualified_at) last_at FROM member_referral_attributions WHERE workspace_id=?${scope} AND status='qualified' AND qualified_at>=?${input.inviterMemberId?' AND inviter_member_id=?':''} GROUP BY source`).bind(...accountArgs,...(input.inviterMemberId?[input.inviterMemberId]:[])).all()).results||[];
  const value=(event:string,source?:string)=>n(eventRows.filter(r=>r.event_type===event&&(!source||r.source===source)).reduce((sum,r)=>sum+n(r.count),0));
  const q=(source?:string)=>n(qualifiedRows.filter(r=>!source||r.source===source).reduce((sum,r)=>sum+n(r.count),0));
  const funnel={landings:value('REFERRAL_LINK_OPENED'),authenticated:value('LIFF_AUTHENTICATED'),friendshipConfirmed:value('FRIENDSHIP_CONFIRMED'),memberEstablished:value('MEMBER_ESTABLISHED'),qualified:q()};
  const sourceBreakdown=Object.fromEntries(SOURCES.map(source=>{const f={landings:value('REFERRAL_LINK_OPENED',source),authenticated:value('LIFF_AUTHENTICATED',source),friendshipConfirmed:value('FRIENDSHIP_CONFIRMED',source),memberEstablished:value('MEMBER_ESTABLISHED',source),qualified:q(source)};return [source,{...f,qualificationRate:f.landings?f.qualified/f.landings:null}]}));
  const trendRows:any[]=(await db.prepare(`SELECT substr(qualified_at,1,10) day,COUNT(*) count FROM member_referral_attributions WHERE workspace_id=?${scope} AND status='qualified' AND qualified_at>=?${input.inviterMemberId?' AND inviter_member_id=?':''} GROUP BY substr(qualified_at,1,10) ORDER BY day`).bind(...accountArgs,...(input.inviterMemberId?[input.inviterMemberId]:[])).all()).results||[];
  const config:any=await db.prepare(`SELECT COUNT(*) count FROM workspace_liff_configs WHERE workspace_id=?${input.lineAccountId?' AND line_account_id=?':''} AND linkage_confirmed_at IS NOT NULL AND runtime_verified_at IS NOT NULL`).bind(input.workspaceId,...(input.lineAccountId?[input.lineAccountId]:[])).first();
  const last=[...eventRows,...qualifiedRows].map(r=>r.last_at).filter(Boolean).sort().at(-1)||null;
  const dataQuality=evaluateReferralGrowthDataQuality({landings:funnel.landings,qualified:funnel.qualified,liffReady:n(config?.count)>0,lastOccurredAt:last});
  return {period:{days:input.days,from:since,to:new Date().toISOString()},funnel,rates:referralFunnelRates(funnel),sourceBreakdown,trend:trendRows.map(r=>({day:r.day,qualified:n(r.count)})),dataQuality,recommendations:referralGrowthRecommendations({funnel,liffReady:dataQuality.code!=='LIFF_NOT_READY',lastOccurredAt:last,sources:sourceBreakdown})};
}
