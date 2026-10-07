import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
// Use the new isolated OCR project's pinned runtime, not the older SaaS
// runtime. No existing backend dependency or compatibility date is upgraded.
import { Miniflare, convertV4MiniflareOptions } from '../node_modules/miniflare/dist/src/index.js';
import { allowed, cleanRequest, cleanResponse, boundedText } from '../src/protocol.ts';

const payload = JSON.stringify({ base64: 'iVBORw0KGgo=' });
const request = (url = 'https://private.invalid/api/ocr', extra = {}) => new Request(url,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, ...extra });

test('private protocol only permits exact image route and drops identity/auth headers', async () => {
  for (const url of ['https://private.invalid/api/doc/upload', 'https://private.invalid/api/ocr?file=x'])
    assert.equal(allowed(request(url)), false);
  assert.equal(allowed(request(undefined, { method: 'PUT' })), false);
  const input = request(undefined, { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer private-ai-key',
    'Cookie': 'member-session', 'X-Line-User-Id': 'private-user' } });
  const cleaned = await cleanRequest(input, new AbortController().signal);
  assert.equal(cleaned.url, 'http://container/api/ocr');
  assert.equal(cleaned.headers.get('Authorization'), null);
  assert.equal(cleaned.headers.get('Cookie'), null);
  assert.equal(cleaned.headers.get('X-Line-User-Id'), null);
  assert.equal(await cleaned.text(), payload);
  for (const body of ['bad json', JSON.stringify({ base64: 'aa', path: '/private/file' }),
    JSON.stringify({ base64: 'aa', url: 'https://unapproved.invalid' })])
    await assert.rejects(cleanRequest(request(undefined, { body }), new AbortController().signal));
});

test('bounded stream cancels oversize and stalled uploads', async () => {
  let cancelled = false;
  const large = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedText(large, 10, new AbortController().signal));
  assert.equal(cancelled, true);
  const controller = new AbortController();
  const stalled = boundedText(new ReadableStream({}), 10, controller.signal);
  controller.abort();
  await assert.rejects(stalled);
});

test('proxy never returns native failure details or redirect location', async () => {
  const response = await cleanResponse(new Response('PRIVATE CONTACT', { status: 503 }), new AbortController().signal);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 500, data: 'OCR_UNAVAILABLE' });
  const noText = await cleanResponse(Response.json({ code: 101, data: 'PRIVATE PATH' }), new AbortController().signal);
  assert.deepEqual(await noText.json(), { code: 101, data: [] });
  const redirected = await cleanResponse(new Response(null, { status: 302, headers: { Location: 'https://unapproved.invalid' } }),
    new AbortController().signal);
  assert.equal(redirected.status, 503);
  assert.equal(redirected.headers.get('Location'), null);
});

const ocrCode = await build({ bundle: true, write: false, format: 'esm', platform: 'browser',
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  external: ['cloudflare:workers'] });

test('Workers runtime: public entrypoint cannot start OCR; private named binding reaches isolated DO', async t => {
  let outbound = 0;
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'ocr', modules: true, script: ocrCode.outputFiles[0].text, compatibilityDate: '2026-10-07',
      compatibilityFlags: ['enable_request_signal'],
      durableObjects: { OCR_CONTAINER: { className: 'OcrContainer', useSQLite: true } },
      outboundService: () => { outbound++; throw new Error('NETWORK_MUST_NOT_RUN'); } },
    { name: 'caller', modules: true, compatibilityDate: '2026-10-07',
      script: `export default { fetch(request, env) { return env.OCR.fetch(request); } };`,
      serviceBindings: { OCR: { name: 'ocr', entrypoint: 'OcrService' } } },
  ] }));
  t.after(() => runtime.dispose());
  const publicWorker = await runtime.getWorker('ocr');
  assert.equal((await publicWorker.fetch('https://public.invalid/api/ocr',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })).status, 404);
  const caller = await runtime.getWorker('caller');
  const response = await caller.fetch('https://caller.invalid/api/ocr',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
  assert.equal(response.status, 503); // No Docker/container in this runtime; safe fallback, not fabricated OCR.
  assert.deepEqual(await response.json(), { code: 500, data: 'OCR_UNAVAILABLE' });
  assert.equal((await caller.fetch('https://caller.invalid/api/doc/upload', { method: 'POST' })).status, 404);
  assert.equal(outbound, 0);
});

test('Workers runtime: container lifecycle rejects parallel calls, sends one POST and stops on idle alarm', async t => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser',
    external: ['cloudflare:workers'], stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: `import { OcrContainer } from './src/index.ts';
export default { async fetch() {
 let running = false, posts = 0, alarm = 0, destroyed = 0, internet;
 let finish; const completion = new Promise(resolve => { finish = resolve; });
 const target = {active:false,ctx:{storage:{setAlarm:async time=>{alarm=time;}},waitUntil:()=>{},
 container:{get running(){return running;},start:options=>{running=true;internet=options.enableInternet;},
 monitor:()=>Promise.resolve(),setInactivityTimeout:async()=>{},destroy:async()=>{destroyed++;running=false;},
 getTcpPort:()=>({fetch:async (input)=>{
  if (typeof input==='string') return new Response('ready');
  posts++; await completion; return Response.json({code:101,data:[]});
 }})}}};
 const make=()=>new Request('https://private.invalid/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(payload)}});
 const first=OcrContainer.prototype.fetch.call(target,make());
 while(!posts) await new Promise(resolve=>setTimeout(resolve,1));
 const duplicate=await OcrContainer.prototype.fetch.call(target,make());
 finish(); const result=await first;
 await OcrContainer.prototype.alarm.call(target);
 return Response.json({duplicate:await duplicate.json(),result:await result.json(),posts,alarm,destroyed,internet});
}};` } });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-07' }));
  t.after(() => runtime.dispose());
  const result = await (await runtime.dispatchFetch('https://fixture.invalid')).json();
  assert.equal(result.posts, 1);
  assert.equal(result.duplicate.code, 850);
  assert.equal(result.result.code, 101);
  assert.equal(result.internet, false);
  assert.equal(result.destroyed, 1);
  assert.ok(result.alarm > Date.now());
});
