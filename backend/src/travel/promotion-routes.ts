import { executeMeteredAiCall, extractGeminiUsageMetadata } from '../ai/usage.ts';
import { GEMINI_MODEL, requestGeminiContent } from '../gemini.ts';
import { requireWorkspaceModule } from '../modules/entitlements.ts';
import { TRAVEL_PROMOTION_EXTRACT_SCHEMA, TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION, activatePromotion, archivePromotion, createPromotion, extractionSource, listPromotions, extractionToPromotionDraft, parsePromotionAiPayload, readPromotion, saveExtractedDraft, updatePromotionDraft } from './promotion.ts';
import { searchTravelPromotionKnowledge } from './promotion-retrieval.ts';
import { setPromotionFormalLink } from './promotion-formal-link.ts';
import { composeTravelPromotions } from './promotion-composer.ts';

const arrayBufferToBase64=(buffer:ArrayBuffer)=>{const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(binary)};
const exactAction=(value:unknown,fields:readonly string[])=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('TRAVEL_PROMOTION_INPUT_INVALID');const body=value as Record<string,unknown>;if(Object.keys(body).some(key=>!fields.includes(key)))throw new Error('TRAVEL_PROMOTION_INPUT_INVALID');return body};
type TravelPromotionProviderFailure = {
  errorCode: string;
  error: string;
  responseStatus: number;
  upstreamCode: number | string | null;
  upstreamStatus: string | null;
  upstreamMessage: string | null;
};

const safeProviderText = (value: unknown, maximum = 500) => {
  const result = String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  return result ? result.slice(0, maximum) : null;
};

export function travelPromotionGeminiSchema(value: unknown): any {
  if (Array.isArray(value)) return value.map(travelPromotionGeminiSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'maxLength')
    .map(([key, child]) => [key, travelPromotionGeminiSchema(child)]));
}

export function classifyTravelPromotionProviderFailure(status: number, payload: unknown): TravelPromotionProviderFailure {
  const root = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
  const upstream = root.error && typeof root.error === 'object' ? root.error as Record<string, unknown> : {};
  const upstreamCode = typeof upstream.code === 'number' || typeof upstream.code === 'string' ? upstream.code : null;
  const upstreamStatus = safeProviderText(upstream.status, 100);
  const upstreamMessage = safeProviderText(upstream.message);
  const quota = status === 429 || upstreamStatus === 'RESOURCE_EXHAUSTED' || /quota|rate limit|resource exhausted/iu.test(upstreamMessage || '');
  if (quota) return { errorCode: 'TRAVEL_PROMOTION_AI_QUOTA_EXCEEDED', error: 'AI 使用額度已用盡或請求過於頻繁，請稍後再試。', responseStatus: 429, upstreamCode, upstreamStatus, upstreamMessage };
  if (status === 401 || upstreamStatus === 'UNAUTHENTICATED') return { errorCode: 'TRAVEL_PROMOTION_AI_AUTH_FAILED', error: 'AI API 金鑰無效或已失效，請聯絡系統管理員。', responseStatus: 502, upstreamCode, upstreamStatus, upstreamMessage };
  if (status === 403 || upstreamStatus === 'PERMISSION_DENIED') return { errorCode: 'TRAVEL_PROMOTION_AI_ACCESS_DENIED', error: 'AI API 金鑰沒有呼叫此模型的權限，請聯絡系統管理員。', responseStatus: 502, upstreamCode, upstreamStatus, upstreamMessage };
  if (status === 404 || upstreamStatus === 'NOT_FOUND') return { errorCode: 'TRAVEL_PROMOTION_AI_MODEL_UNAVAILABLE', error: 'AI 模型目前無法使用，請聯絡系統管理員。', responseStatus: 502, upstreamCode, upstreamStatus, upstreamMessage };
  if (status === 400 || upstreamStatus === 'INVALID_ARGUMENT') return { errorCode: 'TRAVEL_PROMOTION_AI_REQUEST_INVALID', error: 'AI 服務拒絕了分析格式，請聯絡系統管理員。', responseStatus: 502, upstreamCode, upstreamStatus, upstreamMessage };
  return { errorCode: 'TRAVEL_PROMOTION_AI_PROVIDER_FAILED', error: 'AI 服務暫時無法完成分析，請稍後再試。', responseStatus: 502, upstreamCode, upstreamStatus, upstreamMessage };
}

export function registerTravelPromotionRoutes(app:any,deps:any,fail:(c:any,error:unknown,fallback:string)=>Response){
  app.get('/api/travel/promotions',async(c:any)=>{try{deps.requireRole(c,'viewer');return c.json({success:true,promotions:await listPromotions(c.env.smart_menu_db,deps.workspaceIdOf(c))})}catch(e){return fail(c,e,'TRAVEL_PROMOTION_LIST_FAILED')}});
  app.post('/api/travel/promotions',async(c:any)=>{try{deps.requireRole(c,'admin');const promotion=await createPromotion(c.env.smart_menu_db,{workspaceId:deps.workspaceIdOf(c),userId:deps.text(c.get('userId'))||null,body:await c.req.json().catch(()=>({}))});return c.json({success:true,promotion},201)}catch(e){return fail(c,e,'TRAVEL_PROMOTION_CREATE_FAILED')}});
  app.post('/api/travel/promotions/search',async(c:any)=>{try{deps.requireRole(c,'viewer');const body=exactAction(await c.req.json().catch(()=>({})),['query','limit']);const result=await searchTravelPromotionKnowledge(c.env.smart_menu_db,{workspaceId:deps.workspaceIdOf(c),query:body.query,limit:body.limit});return c.json({success:true,...result})}catch(e){return fail(c,e,'TRAVEL_PROMOTION_SEARCH_FAILED')}});
  app.post('/api/travel/promotions/compose',async(c:any)=>{try{deps.requireRole(c,'viewer');const workspaceId=deps.workspaceIdOf(c);const composed=await composeTravelPromotions(c.env.smart_menu_db,{workspaceId,body:await c.req.json().catch(()=>({})),publicBaseUrl:new URL(c.req.url).origin});return c.json({success:true,composition:{format:composed.format,fallbackText:composed.fallbackText,structuredContent:composed.structuredContent,preview:composed.preview}})}catch(e){return fail(c,e,'TRAVEL_PROMOTION_COMPOSE_FAILED')}});
  app.put('/api/travel/promotions/:safePromotionReference/formal-link',async(c:any)=>{try{deps.requireRole(c,'admin');const formalTravelLink=await setPromotionFormalLink(c.env.smart_menu_db,{workspaceId:deps.workspaceIdOf(c),promotionReference:deps.text(c.req.param('safePromotionReference'),100),userId:deps.text(c.get('userId'))||null,body:await c.req.json().catch(()=>({}))});return c.json({success:true,formalTravelLink})}catch(e){return fail(c,e,'TRAVEL_PROMOTION_FORMAL_LINK_FAILED')}});
  app.get('/api/travel/promotions/:safePromotionReference',async(c:any)=>{try{deps.requireRole(c,'viewer');return c.json({success:true,promotion:await readPromotion(c.env.smart_menu_db,deps.workspaceIdOf(c),deps.text(c.req.param('safePromotionReference'),100))})}catch(e){return fail(c,e,'TRAVEL_PROMOTION_READ_FAILED')}});
  app.patch('/api/travel/promotions/:safePromotionReference/draft',async(c:any)=>{try{deps.requireRole(c,'admin');const promotion=await updatePromotionDraft(c.env.smart_menu_db,{workspaceId:deps.workspaceIdOf(c),reference:deps.text(c.req.param('safePromotionReference'),100),userId:deps.text(c.get('userId'))||null,body:await c.req.json().catch(()=>({}))});return c.json({success:true,promotion})}catch(e){return fail(c,e,'TRAVEL_PROMOTION_DRAFT_UPDATE_FAILED')}});
  app.post('/api/travel/promotions/:safePromotionReference/extract',async(c:any)=>{try{
    deps.requireRole(c,'admin');const workspaceId=deps.workspaceIdOf(c);
    try{await requireWorkspaceModule({db:c.env.smart_menu_db,workspaceId,moduleKey:'AI'})}catch(e){if(e instanceof Error&&['MODULE_NOT_ENABLED','MODULE_DEPENDENCY_NOT_ENABLED'].includes(e.message))throw new Error('TRAVEL_PROMOTION_AI_DISABLED');throw e}
    if(!c.env.GEMINI_API_KEY)return c.json({success:false,errorCode:'TRAVEL_PROMOTION_AI_UNAVAILABLE',error:'AI 尚未設定，請聯絡系統管理員。'},503);
    const body=exactAction(await c.req.json().catch(()=>({})),['expectedVersionNo','expectedSourceRevision']);const expectedVersionNo=Number(body.expectedVersionNo),expectedSourceRevision=Number(body.expectedSourceRevision);if(!Number.isInteger(expectedVersionNo)||expectedVersionNo<1||!Number.isInteger(expectedSourceRevision)||expectedSourceRevision<1)throw new Error('TRAVEL_PROMOTION_INPUT_INVALID');
    const reference=deps.text(c.req.param('safePromotionReference'),100);const source=await extractionSource(c.env.smart_menu_db,{workspaceId,reference,userId:deps.text(c.get('userId'))||null,expectedVersionNo,expectedSourceRevision});
    const parts:Array<Record<string,unknown>>=[{text:TRAVEL_PROMOTION_EXTRACTION_INSTRUCTION}];let total=0;
    for(const asset of source.assets){const size=Number(asset.size_bytes||0);total+=size;if(size<1||size>1024*1024||total>5*1024*1024)throw new Error('TRAVEL_PROMOTION_ASSET_INVALID');const object=await c.env.smart_menu_assets.get(asset.storage_key);if(!object)throw new Error('TRAVEL_PROMOTION_ASSET_INVALID');parts.push({inline_data:{mime_type:asset.content_type,data:arrayBufferToBase64(await object.arrayBuffer())}})}
    parts.push({text:`Supplemental untrusted source text begins:\n<source>${source.sourceText}</source>\nSupplemental source text ends.`});
    let providerRequestId:string|null=null;let providerFailure:TravelPromotionProviderFailure|null=null;const extraction=await executeMeteredAiCall({db:c.env.smart_menu_db,workspaceId,userId:deps.text(c.get('userId'))||null,featureCode:'travel_promotion_extract',operationCode:`promotion_v${source.versionNo}_r${source.sourceRevision}`,provider:'google',model:GEMINI_MODEL,execute:async()=>{const response=await requestGeminiContent({apiKey:c.env.GEMINI_API_KEY,body:{contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',responseSchema:travelPromotionGeminiSchema(TRAVEL_PROMOTION_EXTRACT_SCHEMA)}}});providerRequestId=response.headers.get('x-request-id')||response.headers.get('x-goog-request-id');const payload=await response.json().catch(()=>null);if(!response.ok){providerFailure=classifyTravelPromotionProviderFailure(response.status,payload);console.error(JSON.stringify({message:'travel promotion Gemini provider failed',model:GEMINI_MODEL,httpStatus:response.status,providerRequestId,upstreamCode:providerFailure.upstreamCode,upstreamStatus:providerFailure.upstreamStatus,upstreamMessage:providerFailure.upstreamMessage}));return{value:null as never,status:'failed' as const,usage:extractGeminiUsageMetadata(payload),providerRequestId,errorCode:providerFailure.errorCode}};return{value:parsePromotionAiPayload(payload),status:'success' as const,usage:extractGeminiUsageMetadata(payload),providerRequestId}}});
    if(!extraction){const failure=providerFailure||classifyTravelPromotionProviderFailure(502,null);return c.json({success:false,errorCode:failure.errorCode,error:failure.error},failure.responseStatus as any)}const draft=extractionToPromotionDraft(extraction);const promotion=await saveExtractedDraft(c.env.smart_menu_db,{workspaceId,reference,versionNo:source.versionNo,sourceRevision:source.sourceRevision,draft,extraction});return c.json({success:true,promotion});
  }catch(e){return fail(c,e,'TRAVEL_PROMOTION_AI_EXTRACT_FAILED')}});
  app.post('/api/travel/promotions/:safePromotionReference/activate',async(c:any)=>{try{deps.requireRole(c,'admin');const body=exactAction(await c.req.json().catch(()=>({})),['expectedVersionNo']);const expectedVersionNo=Number(body.expectedVersionNo);if(!Number.isInteger(expectedVersionNo)||expectedVersionNo<1)throw new Error('TRAVEL_PROMOTION_INPUT_INVALID');const promotion=await activatePromotion(c.env.smart_menu_db,{workspaceId:deps.workspaceIdOf(c),reference:deps.text(c.req.param('safePromotionReference'),100),userId:deps.text(c.get('userId'))||null,expectedVersionNo});return c.json({success:true,promotion})}catch(e){return fail(c,e,'TRAVEL_PROMOTION_ACTIVATE_FAILED')}});
  app.post('/api/travel/promotions/:safePromotionReference/archive',async(c:any)=>{try{deps.requireRole(c,'admin');exactAction(await c.req.json().catch(()=>({})),[]);const promotion=await archivePromotion(c.env.smart_menu_db,{workspaceId:deps.workspaceIdOf(c),reference:deps.text(c.req.param('safePromotionReference'),100)});return c.json({success:true,promotion})}catch(e){return fail(c,e,'TRAVEL_PROMOTION_ARCHIVE_FAILED')}});
}
