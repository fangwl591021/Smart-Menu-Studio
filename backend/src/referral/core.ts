const clean=(value:unknown,max=200)=>String(value??'').trim().slice(0,max);
export const REFERRAL_SOURCES=new Set(['qr','line_share','web_share']);
export const safeReturnTo=(value:unknown)=>{const path=clean(value,240);return /^\/(?:member|registration|booking|product|campaign)(?:[/?#][^\\]*)?$/.test(path)?path:'/member/referral';};
export const parseReferralLanding=(input:URLSearchParams)=>({referralCode:clean(input.get('ref'),80),source:REFERRAL_SOURCES.has(clean(input.get('src'),30))?clean(input.get('src'),30):'web_share',returnTo:safeReturnTo(input.get('returnTo'))});
export async function memberIdentityHash(secret:string,workspaceId:string,lineAccountId:string,rawLineUserId:string){if(!secret)throw new Error('MEMBER_IDENTITY_SECRET_MISSING');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const input=`${workspaceId}:${lineAccountId}:${rawLineUserId}`;const value=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(input));return [...new Uint8Array(value)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export const referralCode=()=>`r_${crypto.randomUUID().replace(/-/g,'').slice(0,24)}`;
export const referralUrl=(entryUrl:string,code:string,source:string,returnTo:string)=>{const url=new URL(entryUrl);url.searchParams.set('ref',code);url.searchParams.set('src',REFERRAL_SOURCES.has(source)?source:'web_share');url.searchParams.set('returnTo',safeReturnTo(returnTo));return url.toString();};
export async function verifyLiffAccessToken(accessToken:string,clientId:string,fetcher:typeof fetch=fetch){const verify=await fetcher('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({access_token:accessToken})});if(!verify.ok)throw new Error('LIFF_TOKEN_INVALID');const details:any=await verify.json();if(clean(details.client_id)!==clientId)throw new Error('LIFF_CLIENT_ID_MISMATCH');if(!clean(details.scope).split(/\s+/).includes('profile'))throw new Error('LIFF_PROFILE_SCOPE_REQUIRED');const profile=await fetcher('https://api.line.me/v2/profile',{headers:{Authorization:`Bearer ${accessToken}`}});if(!profile.ok)throw new Error('LIFF_PROFILE_UNAVAILABLE');const person:any=await profile.json();if(!clean(person.userId))throw new Error('LIFF_IDENTITY_UNAVAILABLE');return {lineUserId:clean(person.userId),clientId};}
export async function backendFriendship(accessToken:string,fetcher:typeof fetch=fetch){const response=await fetcher('https://api.line.me/friendship/v1/status',{headers:{Authorization:`Bearer ${accessToken}`}});if(!response.ok)throw new Error('FRIENDSHIP_CHECK_FAILED');const body:any=await response.json();return body.friendFlag===true;}
export async function establishMember(db:D1Database,input:{workspaceId:string;lineAccountId:string;identityHash:string;providerRecipientId?:string}){
  const existing:any=await db.prepare('SELECT id FROM line_oa_members WHERE workspace_id=? AND line_account_id=? AND line_identity_hash=? LIMIT 1').bind(input.workspaceId,input.lineAccountId,input.identityHash).first();
  const memberId=existing?clean(existing.id):`loam_${crypto.randomUUID()}`;
  const statements:D1PreparedStatement[]=[];
  if(existing){
    statements.push(db.prepare('UPDATE line_oa_members SET last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND line_account_id=?').bind(memberId,input.workspaceId,input.lineAccountId));
  }else{
    statements.push(db.prepare('INSERT INTO line_oa_members(id,workspace_id,line_account_id,line_identity_hash,status) VALUES(?,?,?,?,?)').bind(memberId,input.workspaceId,input.lineAccountId,input.identityHash,'active'));
  }
  const providerRecipientId=clean(input.providerRecipientId,100);
  if(providerRecipientId){
    statements.push(db.prepare(`INSERT INTO line_member_delivery_targets(
      workspace_id,line_account_id,line_member_id,provider_recipient_id,verified_at
    ) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(workspace_id,line_account_id,line_member_id) DO UPDATE SET
      provider_recipient_id=excluded.provider_recipient_id,
      verified_at=excluded.verified_at,
      updated_at=CURRENT_TIMESTAMP`).bind(input.workspaceId,input.lineAccountId,memberId,providerRecipientId));
  }
  await db.batch(statements);
  return memberId;
}
