import { createCheckout, newebpayConfig, sha256Hex, verifyCallback } from './providers/newebpay';

const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const publicRef = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const row = async (statement: any) => statement.first();
const results = async (statement: any) => ((await statement.all()).results || []);

function exactKeys(value: any, allowed: string[], error: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(error);
}
function cleanText(value: unknown, max: number) { return String(value || '').trim().slice(0, max); }
function amount(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100000000) throw new Error('COMMERCE_PRODUCT_PRICE_INVALID');
  return Number(value);
}
function sku(value: unknown) {
  const normalized = cleanText(value, 64).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(normalized)) throw new Error('COMMERCE_PRODUCT_SKU_INVALID');
  return normalized;
}
function productView(product: any) {
  return { safeProductReference: product.public_ref, sku: product.sku, name: product.name, description: product.description,
    status: product.status, priceAmountMinor: Number(product.price_amount_minor), currencyCode: product.currency_code,
    createdAt: product.created_at, updatedAt: product.updated_at };
}
function orderView(order: any, items: any[] = []) {
  return { safeOrderReference: order.public_ref, status: order.status, paymentStatus: order.payment_status,
    subtotalAmountMinor: Number(order.subtotal_amount_minor), discountAmountMinor: Number(order.discount_amount_minor),
    totalAmountMinor: Number(order.total_amount_minor), currencyCode: order.currency_code, createdAt: order.created_at,
    updatedAt: order.updated_at, paidAt: order.paid_at || null, cancelledAt: order.cancelled_at || null,
    items: items.map(item => ({ sku: item.sku_snapshot, name: item.name_snapshot, unitAmountMinor: Number(item.unit_amount_minor), quantity: Number(item.quantity), lineAmountMinor: Number(item.line_amount_minor), currencyCode: item.currency_code })) };
}

export async function createProduct(db: any, input: any) {
  exactKeys(input.body, ['sku','name','description','priceAmountMinor','currencyCode'], 'COMMERCE_PRODUCT_INPUT_INVALID');
  const name = cleanText(input.body.name, 160); if (!name) throw new Error('COMMERCE_PRODUCT_NAME_REQUIRED');
  if (input.body.currencyCode !== undefined && input.body.currencyCode !== 'TWD') throw new Error('COMMERCE_CURRENCY_UNSUPPORTED');
  const timestamp = now(), id = makeId('cp'), ref = publicRef('prd');
  await db.prepare(`INSERT INTO commerce_products(id,public_ref,workspace_id,sku,name,description,price_amount_minor,currency_code,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,ref,input.workspaceId,sku(input.body.sku),name,cleanText(input.body.description,2000),amount(input.body.priceAmountMinor),'TWD',input.userId,input.userId,timestamp,timestamp).run();
  return productView(await row(db.prepare(`SELECT * FROM commerce_products WHERE workspace_id=? AND id=?`).bind(input.workspaceId,id)));
}
export async function listProducts(db: any, workspaceId: string) {
  return (await results(db.prepare(`SELECT * FROM commerce_products WHERE workspace_id=? ORDER BY updated_at DESC,id DESC`).bind(workspaceId))).map(productView);
}
export async function readProduct(db:any,workspaceId:string,reference:string){const product:any=await row(db.prepare(`SELECT * FROM commerce_products WHERE workspace_id=? AND public_ref=?`).bind(workspaceId,reference));if(!product)throw new Error('COMMERCE_PRODUCT_NOT_FOUND');return productView(product);}
export async function updateProduct(db: any, input: any) {
  exactKeys(input.body, ['name','description','priceAmountMinor','currencyCode','status'], 'COMMERCE_PRODUCT_INPUT_INVALID');
  const existing: any = await row(db.prepare(`SELECT * FROM commerce_products WHERE workspace_id=? AND public_ref=?`).bind(input.workspaceId,input.reference));
  if (!existing) throw new Error('COMMERCE_PRODUCT_NOT_FOUND'); if (existing.status === 'ARCHIVED') throw new Error('COMMERCE_PRODUCT_ARCHIVED');
  if (input.body.currencyCode !== undefined && input.body.currencyCode !== 'TWD') throw new Error('COMMERCE_CURRENCY_UNSUPPORTED');
  const name = input.body.name === undefined ? existing.name : cleanText(input.body.name,160); if (!name) throw new Error('COMMERCE_PRODUCT_NAME_REQUIRED');
  const price = input.body.priceAmountMinor === undefined ? existing.price_amount_minor : amount(input.body.priceAmountMinor);
  const status = input.body.status === undefined ? existing.status : String(input.body.status).toUpperCase(); if (!['DRAFT','ACTIVE'].includes(status)) throw new Error('COMMERCE_PRODUCT_STATUS_INVALID');
  await db.prepare(`UPDATE commerce_products SET name=?,description=?,price_amount_minor=?,status=?,updated_by_user_id=?,updated_at=? WHERE workspace_id=? AND id=?`)
    .bind(name,input.body.description===undefined?existing.description:cleanText(input.body.description,2000),price,status,input.userId,now(),input.workspaceId,existing.id).run();
  return productView(await row(db.prepare(`SELECT * FROM commerce_products WHERE workspace_id=? AND id=?`).bind(input.workspaceId,existing.id)));
}
export async function setProductStatus(db: any, input: any) {
  const status = String(input.status || '').toUpperCase(); if (!['ACTIVE','ARCHIVED'].includes(status)) throw new Error('COMMERCE_PRODUCT_STATUS_INVALID');
  const existing: any = await row(db.prepare(`SELECT id,status FROM commerce_products WHERE workspace_id=? AND public_ref=?`).bind(input.workspaceId,input.reference));
  if (!existing) throw new Error('COMMERCE_PRODUCT_NOT_FOUND'); if (existing.status === 'ARCHIVED') throw new Error('COMMERCE_PRODUCT_ARCHIVED');
  const timestamp=now(); await db.prepare(`UPDATE commerce_products SET status=?,archived_at=?,updated_by_user_id=?,updated_at=? WHERE workspace_id=? AND id=?`)
    .bind(status,status==='ARCHIVED'?timestamp:null,input.userId,timestamp,input.workspaceId,existing.id).run();
  return productView(await row(db.prepare(`SELECT * FROM commerce_products WHERE workspace_id=? AND id=?`).bind(input.workspaceId,existing.id)));
}

export async function createOrder(db: any, input: any) {
  exactKeys(input.body, ['items'], 'COMMERCE_ORDER_INPUT_INVALID');
  if (!Array.isArray(input.body.items) || input.body.items.length < 1 || input.body.items.length > 20) throw new Error('COMMERCE_ORDER_ITEMS_INVALID');
  const seen = new Set<string>(), prepared: any[]=[]; let total=0;
  for (const raw of input.body.items) {
    exactKeys(raw,['safeProductReference','quantity'],'COMMERCE_ORDER_ITEM_INVALID');
    const ref=cleanText(raw.safeProductReference,100); if (!ref || seen.has(ref)) throw new Error('COMMERCE_ORDER_ITEM_INVALID'); seen.add(ref);
    if (!Number.isInteger(raw.quantity) || raw.quantity<1 || raw.quantity>100) throw new Error('COMMERCE_ORDER_QUANTITY_INVALID');
    const product:any=await row(db.prepare(`SELECT * FROM commerce_products WHERE workspace_id=? AND public_ref=? AND status='ACTIVE'`).bind(input.workspaceId,ref));
    if (!product) throw new Error('COMMERCE_PRODUCT_NOT_AVAILABLE');
    const line=Number(product.price_amount_minor)*raw.quantity; total+=line; if(total>100000000) throw new Error('COMMERCE_ORDER_TOTAL_INVALID'); prepared.push({product,quantity:raw.quantity,line});
  }
  const orderId=makeId('co'), ref=publicRef('ord'), timestamp=now();
  const statements=[db.prepare(`INSERT INTO commerce_orders(id,public_ref,workspace_id,status,payment_status,subtotal_amount_minor,total_amount_minor,currency_code,created_by_user_id,created_at,updated_at) VALUES(?,?,?,'DRAFT','UNPAID',?,?,'TWD',?,?,?)`).bind(orderId,ref,input.workspaceId,total,total,input.userId,timestamp,timestamp)];
  prepared.forEach(({product,quantity,line})=>statements.push(db.prepare(`INSERT INTO commerce_order_items(id,workspace_id,order_id,product_id,sku_snapshot,name_snapshot,unit_amount_minor,quantity,line_amount_minor,currency_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,'TWD',?)`).bind(makeId('ci'),input.workspaceId,orderId,product.id,product.sku,product.name,product.price_amount_minor,quantity,line,timestamp)));
  await db.batch(statements); return readOrder(db,input.workspaceId,ref);
}
export async function listOrders(db:any,workspaceId:string){return Promise.all((await results(db.prepare(`SELECT * FROM commerce_orders WHERE workspace_id=? ORDER BY created_at DESC,id DESC`).bind(workspaceId))).map((o:any)=>orderView(o)));}
export async function readOrder(db:any,workspaceId:string,reference:string){const order:any=await row(db.prepare(`SELECT * FROM commerce_orders WHERE workspace_id=? AND public_ref=?`).bind(workspaceId,reference));if(!order)throw new Error('COMMERCE_ORDER_NOT_FOUND');const items=await results(db.prepare(`SELECT * FROM commerce_order_items WHERE workspace_id=? AND order_id=? ORDER BY created_at,id`).bind(workspaceId,order.id));return orderView(order,items);}
export async function cancelOrder(db:any,input:any){const order:any=await row(db.prepare(`SELECT * FROM commerce_orders WHERE workspace_id=? AND public_ref=?`).bind(input.workspaceId,input.reference));if(!order)throw new Error('COMMERCE_ORDER_NOT_FOUND');if(order.payment_status==='PAID')throw new Error('COMMERCE_ORDER_PAID_TERMINAL');if(order.status==='CANCELLED')return orderView(order);const timestamp=now();await db.batch([db.prepare(`UPDATE commerce_orders SET status='CANCELLED',payment_status='CANCELLED',cancelled_at=?,updated_at=? WHERE workspace_id=? AND id=? AND payment_status<>'PAID'`).bind(timestamp,timestamp,input.workspaceId,order.id),db.prepare(`UPDATE commerce_payment_intents SET status='CANCELLED',updated_at=? WHERE workspace_id=? AND order_id=? AND status='PENDING'`).bind(timestamp,input.workspaceId,order.id)]);return readOrder(db,input.workspaceId,input.reference);}

export async function listOrderPayments(db:any,workspaceId:string,reference:string){const order:any=await row(db.prepare(`SELECT id FROM commerce_orders WHERE workspace_id=? AND public_ref=?`).bind(workspaceId,reference));if(!order)throw new Error('COMMERCE_ORDER_NOT_FOUND');return (await results(db.prepare(`SELECT provider,status,amount_minor,currency_code,provider_response_code,safe_failure_code,paid_at,created_at FROM commerce_payment_transactions WHERE workspace_id=? AND order_id=? ORDER BY created_at DESC,id DESC`).bind(workspaceId,order.id))).map((payment:any)=>({provider:payment.provider,status:payment.status,amountMinor:payment.amount_minor===null?null:Number(payment.amount_minor),currencyCode:payment.currency_code||null,providerResponseCode:payment.provider_response_code||null,safeFailureCode:payment.safe_failure_code||null,paidAt:payment.paid_at||null,createdAt:payment.created_at}));}

function safeReturnUrl(value:unknown){const raw=String(value||'').trim();if(!raw)return undefined;const parsed=new URL(raw);if(parsed.protocol!=='https:')throw new Error('COMMERCE_PAYMENT_RETURN_URL_INVALID');return parsed.toString();}
export async function initiatePayment(db:any,input:any){
  exactKeys(input.body,[],'COMMERCE_PAYMENT_INPUT_INVALID'); const config=newebpayConfig(input.env);
  const order:any=await row(db.prepare(`SELECT * FROM commerce_orders WHERE workspace_id=? AND public_ref=?`).bind(input.workspaceId,input.reference));if(!order)throw new Error('COMMERCE_ORDER_NOT_FOUND');if(order.payment_status==='PAID')throw new Error('COMMERCE_ORDER_ALREADY_PAID');if(order.status==='CANCELLED')throw new Error('COMMERCE_ORDER_CANCELLED');
  const timestamp=now();await db.prepare(`UPDATE commerce_payment_intents SET status='EXPIRED',updated_at=? WHERE workspace_id=? AND order_id=? AND status='PENDING' AND expires_at<=?`).bind(timestamp,input.workspaceId,order.id,timestamp).run();
  let intent:any=await row(db.prepare(`SELECT * FROM commerce_payment_intents WHERE workspace_id=? AND order_id=? AND status='PENDING' AND expires_at>? ORDER BY created_at DESC LIMIT 1`).bind(input.workspaceId,order.id,timestamp));
  if(!intent){const id=makeId('pi'),ref=publicRef('pay'),merchantOrderNo=`SMS${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g,'').slice(0,10).toUpperCase()}`.slice(0,30),expires=new Date(Date.now()+30*60*1000).toISOString();await db.prepare(`INSERT INTO commerce_payment_intents(id,public_ref,workspace_id,order_id,provider,merchant_order_no,merchant_id,provider_mode,amount_minor,currency_code,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,'NEWEBPAY',?,?,?,?,'TWD','PENDING',?,?,?)`).bind(id,ref,input.workspaceId,order.id,merchantOrderNo,config.merchantId,config.mode,order.total_amount_minor,expires,timestamp,timestamp).run();intent=await row(db.prepare(`SELECT * FROM commerce_payment_intents WHERE workspace_id=? AND id=?`).bind(input.workspaceId,id));}
  await db.prepare(`UPDATE commerce_orders SET status='PENDING_PAYMENT',payment_status='PENDING',updated_at=? WHERE workspace_id=? AND id=? AND payment_status<>'PAID'`).bind(timestamp,input.workspaceId,order.id).run();
  const checkout=await createCheckout({config,merchantOrderNo:intent.merchant_order_no,amountMinor:Number(intent.amount_minor),itemDescription:`Smart Menu order ${order.public_ref.slice(-12)}`,notifyUrl:input.notifyUrl,returnUrl:safeReturnUrl(input.env.NEWEBPAY_RETURN_URL)});
  return {safePaymentReference:intent.public_ref,status:intent.status,expiresAt:intent.expires_at,checkout};
}

export async function handleNewebPayCallback(db:any,input:any){
  const config=newebpayConfig(input.env), callbackHash=await sha256Hex(`${input.tradeInfo}.${input.tradeShaValue}`);
  const duplicate:any=await row(db.prepare(`SELECT status FROM commerce_payment_transactions WHERE provider='NEWEBPAY' AND callback_hash=?`).bind(callbackHash));if(duplicate)return {accepted:true,idempotent:true,paid:duplicate.status==='SUCCEEDED'};
  const data:any=await verifyCallback({tradeInfo:input.tradeInfo,tradeShaValue:input.tradeShaValue,config});
  const merchantOrderNo=cleanText(data.MerchantOrderNo,30),intent:any=await row(db.prepare(`SELECT * FROM commerce_payment_intents WHERE provider='NEWEBPAY' AND merchant_order_no=?`).bind(merchantOrderNo));if(!intent)throw new Error('COMMERCE_PAYMENT_INTENT_NOT_FOUND');
  const success=String(data.Status||'').toUpperCase()==='SUCCESS';const amountValue=Number(data.Amt);const verified=String(data.MerchantID||'')===intent.merchant_id&&Number.isInteger(amountValue)&&amountValue===Number(intent.amount_minor);const timestamp=now();
  const transactionId=makeId('pt'),providerHash=data.TradeNo?await sha256Hex(String(data.TradeNo)):null;
  if(providerHash){const prior:any=await row(db.prepare(`SELECT status FROM commerce_payment_transactions WHERE provider='NEWEBPAY' AND provider_transaction_hash=?`).bind(providerHash));if(prior)return {accepted:true,idempotent:true,paid:prior.status==='SUCCEEDED'||intent.status==='PAID'};}
  if(!verified){await db.prepare(`INSERT INTO commerce_payment_transactions(id,workspace_id,payment_intent_id,order_id,provider,callback_hash,provider_transaction_hash,status,amount_minor,currency_code,provider_response_code,safe_failure_code,created_at) VALUES(?,?,?,?,'NEWEBPAY',?,?,'VERIFICATION_FAILED',?,'TWD',?,'CALLBACK_BINDING_MISMATCH',?)`).bind(transactionId,intent.workspace_id,intent.id,intent.order_id,callbackHash,providerHash,Number.isInteger(amountValue)?amountValue:null,cleanText(data.Status,40),timestamp).run();throw new Error('COMMERCE_PAYMENT_CALLBACK_MISMATCH');}
  const transactionStatus=success?'SUCCEEDED':'FAILED',safeFailure=success?null:'PROVIDER_PAYMENT_FAILED';const statements=[db.prepare(`INSERT INTO commerce_payment_transactions(id,workspace_id,payment_intent_id,order_id,provider,callback_hash,provider_transaction_hash,status,amount_minor,currency_code,provider_response_code,safe_failure_code,paid_at,created_at) VALUES(?,?,?,?,'NEWEBPAY',?,?,?,?, 'TWD',?,?,?,?)`).bind(transactionId,intent.workspace_id,intent.id,intent.order_id,callbackHash,providerHash,transactionStatus,amountValue,cleanText(data.Status,40),safeFailure,success?timestamp:null,timestamp)];
  if(success){statements.push(db.prepare(`UPDATE commerce_payment_intents SET status='PAID',updated_at=? WHERE id=? AND workspace_id=? AND status<>'PAID'`).bind(timestamp,intent.id,intent.workspace_id),db.prepare(`UPDATE commerce_orders SET status='PAID',payment_status='PAID',paid_at=COALESCE(paid_at,?),updated_at=? WHERE id=? AND workspace_id=? AND payment_status<>'PAID'`).bind(timestamp,timestamp,intent.order_id,intent.workspace_id));}else if(intent.status!=='PAID'){statements.push(db.prepare(`UPDATE commerce_payment_intents SET status='FAILED',updated_at=? WHERE id=? AND workspace_id=? AND status='PENDING'`).bind(timestamp,intent.id,intent.workspace_id),db.prepare(`UPDATE commerce_orders SET status='PAYMENT_FAILED',payment_status='FAILED',updated_at=? WHERE id=? AND workspace_id=? AND payment_status<>'PAID'`).bind(timestamp,intent.order_id,intent.workspace_id));}
  await db.batch(statements);return {accepted:true,idempotent:false,paid:success||intent.status==='PAID'};
}
