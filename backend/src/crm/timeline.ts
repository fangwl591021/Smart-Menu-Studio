type TimelineItem={eventType:string;sourceDomain:string;title:string;summary:string|null;occurredAt:string;metadata:Record<string,unknown>;sortKey:string};
const text=(value:any,max=240)=>typeof value==='string'?value.trim().slice(0,max):'';
const num=(value:any)=>Number.isFinite(Number(value))?Number(value):0;

function cursor(value:any){
  if(!value)return 0;
  try{const parsed=JSON.parse(atob(String(value).replace(/-/g,'+').replace(/_/g,'/')));return Number.isInteger(parsed?.p)&&parsed.p>=0?parsed.p:0;}catch{return 0;}
}
function nextCursor(position:number){return btoa(JSON.stringify({v:1,p:position})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function item(row:any,eventType:string,sourceDomain:string,title:string,summary:string|null,metadata:Record<string,unknown>={}) : TimelineItem {
  return {eventType,sourceDomain,title,summary,occurredAt:String(row.occurred_at||row.created_at||row.changed_at||row.assigned_at||''),metadata,sortKey:String(row.id||row.sort_key||'')};
}
function publicItem(value:TimelineItem,viewer:boolean){return {eventType:value.eventType,sourceDomain:value.sourceDomain,title:value.title,summary:viewer?null:value.summary,occurredAt:value.occurredAt,metadata:viewer?{}:value.metadata};}
async function rows(db:D1Database,sql:string,args:any[]){return ((await db.prepare(sql).bind(...args).all<any>()).results||[]) as any[];}

/** Computed projection only: the source rows remain the sole business authority. */
export async function crmTimeline(db:D1Database,input:{workspaceId:string;personId:string;limit?:number;cursor?:string|null;viewer?:boolean}){
  const limit=Math.min(Math.max(Number(input.limit)||25,1),100), args=[input.workspaceId,input.personId];
  const [profile,acquisition,referral,imports,cards,cardEvidence,tags,insights,traits,stage,owners,followUps,points,rewards,contribution,tiers,commission,settlements,payouts,payments]=await Promise.all([
    rows(db,`SELECT MIN(id) id,changed_at,COUNT(*) changed_count FROM crm_profile_field_events WHERE workspace_id=? AND crm_person_id=? GROUP BY changed_at`,args),
    rows(db,`SELECT id,source_type,channel,occurred_at FROM crm_acquisition_events WHERE workspace_id=? AND crm_person_id=?`,args),
    rows(db,`SELECT a.id,a.qualified_at occurred_at,COALESCE(p.contact_name,p.display_name) referrer_label FROM crm_person_identity_links l JOIN member_referral_attributions a ON a.workspace_id=l.workspace_id AND a.line_account_id=l.line_account_id AND a.invitee_member_id=l.line_member_id LEFT JOIN crm_person_identity_links i ON i.workspace_id=a.workspace_id AND i.line_account_id=a.line_account_id AND i.line_member_id=a.inviter_member_id AND i.identity_type='LINE_MEMBER' LEFT JOIN crm_profiles p ON p.crm_person_id=i.crm_person_id WHERE l.workspace_id=? AND l.crm_person_id=? AND l.identity_type='LINE_MEMBER'`,args),
    rows(db,`SELECT r.id,r.resolution,r.reviewed_at occurred_at,j.import_type FROM crm_import_rows r JOIN crm_import_jobs j ON j.id=r.import_job_id WHERE r.workspace_id=? AND r.resolved_person_id=? AND r.status='RESOLVED' AND r.resolution IN ('CREATE_PERSON','LINK_EXISTING')`,args),
    rows(db,`SELECT id,'PERSONAL_CARD' kind,created_at occurred_at FROM crm_personal_cards WHERE workspace_id=? AND crm_person_id=? UNION ALL SELECT v.id,'PERSONAL_CARD_VERSION',v.created_at FROM crm_personal_card_versions v JOIN crm_personal_cards c ON c.id=v.personal_card_id WHERE v.workspace_id=? AND c.crm_person_id=? UNION ALL SELECT id,'BUSINESS_CARD',COALESCE(captured_at,created_at) FROM crm_business_cards WHERE workspace_id=? AND crm_person_id=?`,[...args,...args,...args]),
    rows(db,`SELECT id,'CARD_COLLECTED' kind,collected_at occurred_at FROM crm_card_collections WHERE workspace_id=? AND collector_person_id=? UNION ALL SELECT id,'CARD_SHARED',created_at FROM crm_card_shares WHERE workspace_id=? AND owner_person_id=?`,[...args,...args]),
    rows(db,`SELECT pt.id,pt.assigned_at,pt.removed_at,t.name FROM crm_person_tags pt JOIN crm_tags t ON t.id=pt.crm_tag_id WHERE pt.workspace_id=? AND pt.crm_person_id=?`,args),
    rows(db,`SELECT id,label,generated_at occurred_at FROM crm_person_insights WHERE workspace_id=? AND crm_person_id=?`,args),
    rows(db,`SELECT id,trait_type,generated_at occurred_at FROM crm_person_traits WHERE workspace_id=? AND crm_person_id=?`,args),
    rows(db,`SELECT e.id,e.occurred_at,fs.name from_name,ts.name to_name FROM crm_person_stage_events e LEFT JOIN crm_pipeline_stages fs ON fs.id=e.from_stage_id LEFT JOIN crm_pipeline_stages ts ON ts.id=e.to_stage_id WHERE e.workspace_id=? AND e.crm_person_id=?`,args),
    rows(db,`SELECT r.id,r.assigned_at occurred_at,u.display_name FROM crm_person_relationships r LEFT JOIN users u ON u.id=r.related_user_id WHERE r.workspace_id=? AND r.crm_person_id=? AND r.relationship_type='ASSIGNED_TO'`,args),
    rows(db,`SELECT e.id,e.event_type,e.occurred_at,t.title,t.status,t.due_at,t.completed_at FROM crm_follow_up_task_events e JOIN crm_follow_up_tasks t ON t.id=e.crm_follow_up_task_id WHERE e.workspace_id=? AND t.crm_person_id=?`,args),
    rows(db,`SELECT e.id,e.entry_type,e.points,e.reason_code,e.effective_at occurred_at FROM member_point_ledger_entries e JOIN member_point_accounts a ON a.id=e.point_account_id JOIN crm_person_identity_links l ON l.workspace_id=a.workspace_id AND l.line_account_id=a.line_account_id AND l.line_member_id=a.member_id WHERE l.workspace_id=? AND l.crm_person_id=?`,args),
    rows(db,`SELECT r.id,r.reward_name_snapshot,r.points_cost_snapshot,r.status,r.completed_at occurred_at FROM point_redemptions r JOIN member_point_accounts a ON a.id=r.point_account_id JOIN crm_person_identity_links l ON l.workspace_id=a.workspace_id AND l.line_account_id=a.line_account_id AND l.line_member_id=a.member_id WHERE l.workspace_id=? AND l.crm_person_id=?`,args),
    rows(db,`SELECT e.id,e.event_type,e.score_delta,e.effective_at occurred_at FROM member_contribution_events e JOIN crm_person_identity_links l ON l.workspace_id=e.workspace_id AND l.line_account_id=e.line_account_id AND l.line_member_id=e.member_id WHERE l.workspace_id=? AND l.crm_person_id=?`,args),
    rows(db,`SELECT e.id,e.tier_code,e.qualified_at occurred_at FROM member_tier_qualification_events e JOIN crm_person_identity_links l ON l.workspace_id=e.workspace_id AND l.line_account_id=e.line_account_id AND l.line_member_id=e.member_id WHERE l.workspace_id=? AND l.crm_person_id=?`,args),
    rows(db,`SELECT e.id,e.amount_minor,e.currency_code,e.effective_at occurred_at FROM commission_ledger_entries e JOIN line_oa_dealers d ON d.id=e.dealer_id JOIN crm_person_identity_links l ON l.workspace_id=d.workspace_id AND l.line_account_id=d.line_account_id AND l.line_member_id=d.member_id WHERE l.workspace_id=? AND l.crm_person_id=?`,args),
    rows(db,`SELECT s.id,s.status,COALESCE(s.updated_at,s.created_at) occurred_at FROM commission_settlements s JOIN commission_settlement_items si ON si.settlement_id=s.id JOIN line_oa_dealers d ON d.id=si.dealer_id JOIN crm_person_identity_links l ON l.workspace_id=d.workspace_id AND l.line_account_id=d.line_account_id AND l.line_member_id=d.member_id WHERE l.workspace_id=? AND l.crm_person_id=? AND s.status='FINALIZED'`,args),
    rows(db,`SELECT p.id,p.status,p.requested_at occurred_at FROM commission_payout_requests p JOIN line_oa_dealers d ON d.id=p.dealer_id JOIN crm_person_identity_links l ON l.workspace_id=d.workspace_id AND l.line_account_id=d.line_account_id AND l.line_member_id=d.member_id WHERE l.workspace_id=? AND l.crm_person_id=?`,args),
    rows(db,`SELECT x.id,x.status,COALESCE(x.completed_at,x.created_at) occurred_at FROM commission_payment_attempts x JOIN commission_payout_requests p ON p.id=x.payout_request_id JOIN line_oa_dealers d ON d.id=p.dealer_id JOIN crm_person_identity_links l ON l.workspace_id=d.workspace_id AND l.line_account_id=d.line_account_id AND l.line_member_id=d.member_id WHERE l.workspace_id=? AND l.crm_person_id=? AND x.status='SUCCEEDED'`,args),
  ]);
  const all:TimelineItem[]=[];
  profile.forEach(r=>all.push(item(r,'PROFILE_UPDATED','PROFILE','Profile updated',`${num(r.changed_count)} field${num(r.changed_count)===1?'':'s'} updated`)));
  acquisition.forEach(r=>all.push(item(r,'ACQUISITION_RECORDED','ACQUISITION','Acquisition recorded',text(r.source_type),{sourceType:text(r.source_type,40),channel:text(r.channel,80)||null})));
  referral.forEach(r=>all.push(item(r,'REFERRAL_ATTRIBUTED','REFERRAL','Referral attributed',text(r.referrer_label,120)||'Qualified referral')));
  imports.forEach(r=>all.push(item(r,r.resolution==='CREATE_PERSON'?'IMPORT_CREATED_PERSON':'IMPORT_LINKED_PERSON','IMPORT',r.resolution==='CREATE_PERSON'?'Person created from import':'Person linked from import',text(r.import_type,40))));
  cards.forEach(r=>all.push(item(r,r.kind==='BUSINESS_CARD'?'BUSINESS_CARD_LINKED':r.kind==='PERSONAL_CARD_VERSION'?'PERSONAL_CARD_VERSION_CREATED':'PERSONAL_CARD_CREATED','CARD',r.kind==='BUSINESS_CARD'?'Business card linked':r.kind==='PERSONAL_CARD_VERSION'?'Personal card version created':'Personal card created',null)));
  cardEvidence.forEach(r=>all.push(item(r,r.kind,'CARD',r.kind==='CARD_SHARED'?'Personal card shared':'Card collected',null)));
  tags.forEach(r=>{all.push(item({...r,occurred_at:r.assigned_at},'TAG_ASSIGNED','CRM','Tag assigned',text(r.name,120)));if(r.removed_at)all.push(item({...r,occurred_at:r.removed_at,id:`${r.id}:removed`},'TAG_REMOVED','CRM','Tag removed',text(r.name,120)));});
  insights.forEach(r=>all.push(item(r,'INSIGHT_RECORDED','INSIGHT','Insight recorded',text(r.label,120)))); traits.forEach(r=>all.push(item(r,'TRAIT_DERIVED','INSIGHT','Trait derived',text(r.trait_type,80))));
  stage.forEach(r=>all.push(item(r,'STAGE_CHANGED','CRM','Pipeline stage changed',null,{fromStageLabel:text(r.from_name,120)||null,toStageLabel:text(r.to_name,120)||null})));
  owners.forEach(r=>all.push(item(r,'OWNER_ASSIGNED','CRM','CRM owner assigned',text(r.display_name,120)||'Workspace user')));
  followUps.forEach(r=>all.push(item(r,`FOLLOW_UP_${text(r.event_type,20)}`,'CRM',`Follow-up ${text(r.event_type,20).toLowerCase()}`,text(r.title,240),{status:text(r.status,20),dueAt:r.due_at||null,completedAt:r.completed_at||null})));
  points.forEach(r=>all.push(item(r,r.entry_type==='DEBIT'?'POINTS_DEBITED':'POINTS_CREDITED','ECONOMY',r.entry_type==='DEBIT'?'Points debited':'Points credited',text(r.reason_code,80),{delta:r.entry_type==='DEBIT'?-num(r.points):num(r.points),reason:text(r.reason_code,80)})));
  rewards.forEach(r=>all.push(item(r,'REWARD_REDEEMED','ECONOMY','Reward redeemed',text(r.reward_name_snapshot,120),{pointsCost:num(r.points_cost_snapshot),status:text(r.status,20)})));
  contribution.forEach(r=>all.push(item(r,'CONTRIBUTION_RECORDED','ECONOMY','Contribution recorded',text(r.event_type,80),{scoreDelta:num(r.score_delta)}))); tiers.forEach(r=>all.push(item(r,'TIER_QUALIFIED','ECONOMY','Tier qualified',text(r.tier_code,40),{tierLabel:text(r.tier_code,40)})));
  commission.forEach(r=>all.push(item(r,'COMMISSION_EARNED','ECONOMY','Commission earned',null,{amountMinor:num(r.amount_minor),currencyCode:text(r.currency_code,12)}))); settlements.forEach(r=>all.push(item(r,'SETTLEMENT_FINALIZED','ECONOMY','Settlement finalized',text(r.status,20),{status:text(r.status,20)}))); payouts.forEach(r=>all.push(item(r,'PAYOUT_REQUESTED','ECONOMY','Payout requested',text(r.status,20),{status:text(r.status,20)}))); payments.forEach(r=>all.push(item(r,'PAYMENT_SIMULATED_SUCCEEDED','ECONOMY','Simulated payment succeeded','Simulated payment only',{status:text(r.status,20),executionMode:'SIMULATED'})));
  const sorted=all.filter(x=>x.occurredAt).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.sortKey.localeCompare(a.sortKey));
  const start=cursor(input.cursor),page=sorted.slice(start,start+limit),next=start+limit<sorted.length?nextCursor(start+limit):null;
  return {items:page.map(x=>publicItem(x,Boolean(input.viewer))),nextCursor:next};
}
