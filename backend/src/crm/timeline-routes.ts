import { crmTimeline } from './timeline';
export function registerCrmTimelineRoutes(app:any,deps:any){
  app.get('/api/crm/people/:safePersonReference/timeline',async(c:any)=>{try{
    deps.requireRole(c,'viewer');const workspaceId=deps.workspaceIdOf(c),person:any=await deps.crmPersonByReference(c.env.smart_menu_db,{workspaceId,publicRef:deps.text(c.req.param('safePersonReference'),80)});
    if(!person)return c.json({success:false,error:'NOT_FOUND'},404);
    const requested=Number(c.req.query('limit')||25);if(!Number.isInteger(requested)||requested<1||requested>100)return c.json({success:false,error:'CRM_TIMELINE_LIMIT_INVALID'},400);
    const viewer=String(c.get('userRole')||'viewer').toLowerCase()==='viewer';
    return c.json({success:true,...await crmTimeline(c.env.smart_menu_db,{workspaceId,personId:person.id,limit:requested,cursor:deps.text(c.req.query('cursor'),512)||null,viewer})});
  }catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'CRM_TIMELINE_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
}
