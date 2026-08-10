import { normalizedEmail, normalizedMobile } from './index';

export const IMPORT_FIELDS=['displayName','contactName','englishName','companyName','department','jobTitle','mobile','companyPhone','email','websiteUrl','lineUrl','address','birthday','gender','region','preferredLanguage','serviceDescription','note'] as const;
const prohibited=new Set(['referrer','inviter','dealer','points','commission','tier','payout','lineuid','linehash','lineidentityhash','linememberid']);
const clean=(v:unknown,max=2000)=>typeof v==='string'?v.trim().slice(0,max):'';
const key=(v:string)=>v.replace(/[ _-]/g,'').toLowerCase();
export type ImportCandidate=Record<string,string>;

export function parseCsvCandidateRows(csv:string) {
  const lines=csv.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim()!=='');
  if(lines.length<2) throw new Error('CSV_ROWS_REQUIRED');
  const cells=(line:string)=>{const out:string[]=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){out.push(value);value='';}else value+=ch;}if(quoted)throw new Error('CSV_INVALID_QUOTE');out.push(value);return out;};
  const headers=cells(lines.shift()!).map(clean), normalized=headers.map(key);
  const warnings=headers.filter((header,i)=>!IMPORT_FIELDS.some(field=>key(field)===normalized[i])&&!prohibited.has(normalized[i])).map(header=>`UNKNOWN_COLUMN:${header}`);
  return {warnings,rows:lines.map((line,rowNumber)=>{const values=cells(line),candidate:ImportCandidate={};headers.forEach((header,i)=>{const field=IMPORT_FIELDS.find(value=>key(value)===normalized[i]);if(field)candidate[field]=clean(values[i]);});return {rowNumber:rowNumber+2,candidate,prohibitedColumns:headers.filter((_,i)=>prohibited.has(normalized[i]))};})};
}
export function validateImportCandidate(candidate:ImportCandidate) {
  const mobile=normalizedMobile(candidate.mobile||''),email=normalizedEmail(candidate.email||'');
  const hasData=Object.values(candidate).some(Boolean);
  return {valid:hasData,normalizedMobile:mobile,normalizedEmail:email};
}
export function classifyImportMatch(candidate:{normalizedMobile:string;normalizedEmail:string;contactName?:string;companyName?:string}, matches:{mobilePersonId?:string|null;emailPersonId?:string|null}) {
  const mobile=matches.mobilePersonId||null,email=matches.emailPersonId||null;
  if(mobile&&email&&mobile!==email)return {confidence:'CONFLICT',status:'MERGE_REVIEW_REQUIRED',candidatePersonId:null,reason:'PHONE_EMAIL_DIFFERENT_PEOPLE'};
  if(mobile||email)return {confidence:'TRUSTED_EXACT',status:'READY_LINK',candidatePersonId:mobile||email,reason:mobile&&email?'EXACT_PHONE_AND_EMAIL':'EXACT_CONTACT'};
  if(clean(candidate.contactName)&&clean(candidate.companyName))return {confidence:'POSSIBLE_MATCH',status:'MATCH_CANDIDATE',candidatePersonId:null,reason:'NAME_AND_COMPANY'};
  return {confidence:'NO_MATCH',status:'READY_CREATE',candidatePersonId:null,reason:'NO_CREDIBLE_MATCH'};
}
export const importCapability=(type:string)=>type==='CSV'?{available:true,code:'CSV_READY'}:type==='XLSX'?{available:false,code:'XLSX_PARSER_PENDING'}:type==='BUSINESS_CARD_OCR'?{available:false,code:'OCR_PROVIDER_ADAPTER_PENDING'}:{available:false,code:'API_IMPORT_FOUNDATION_ONLY'};
