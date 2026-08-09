type Db = D1Database;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2,'0')).join('');
const safe = (value: unknown, max=120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
export const CONVERSION_KEY_PREFIX = 'smc_live_';
export async function conversionKeyHash(value: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
export function createConversionApiKey() { const bytes=crypto.getRandomValues(new Uint8Array(24)); const secret=hex(bytes); const publicPrefix=hex(crypto.getRandomValues(new Uint8Array(6))); return { key: `smc_live_${publicPrefix}_${secret}`, prefix: publicPrefix }; }
const equal = (left:string,right:string) => { if(left.length!==right.length) return false; let diff=0; for(let i=0;i<left.length;i++) diff|=left.charCodeAt(i)^right.charCodeAt(i); return diff===0; };
export async function authenticateConversionApiKey(db:Db, authorization:string|undefined) { const match=/^Bearer\s+(smc_live_([a-f0-9]{12})_([a-f0-9]{48}))$/i.exec(safe(authorization,200)); if(!match) return null; const row:any=await db.prepare("SELECT id,workspace_id,key_hash,status FROM workspace_conversion_api_keys WHERE key_prefix=? AND status='active' LIMIT 1").bind(match[2]).first(); if(!row || !equal(await conversionKeyHash(match[1]), safe(row.key_hash,128))) return null; await db.prepare("UPDATE workspace_conversion_api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='active'").bind(row.id,row.workspace_id).run(); return { id:safe(row.id), workspaceId:safe(row.workspace_id) }; }
export const conversionMetadata = (value:unknown) => { if(!value || typeof value!=='object' || Array.isArray(value)) return {}; const out:Record<string,string|number|boolean>={}; for(const [key,item] of Object.entries(value as Record<string,unknown>)){ if(/token|secret|password|uid|message|postback/i.test(key)) continue; if(typeof item==='string'||typeof item==='number'||typeof item==='boolean') out[safe(key,64)]=typeof item==='string'?safe(item,160):item; } return out; };


