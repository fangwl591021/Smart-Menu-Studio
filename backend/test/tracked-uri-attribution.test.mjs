import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appendAttributionToken, createAttributionToken, destinationFingerprint, safeDestination, trackedTokenHash } from '../src/journey/tracked-uri.ts';

test('4F-4A redirect token and destination helpers are opaque and safe', async()=>{
 const token=createAttributionToken(); assert.match(token,/^smat_[A-Za-z0-9_-]{40,}$/); assert.notEqual(await trackedTokenHash(token),token);
 assert.equal(safeDestination('javascript:alert(1)'),null); assert.equal(safeDestination('data:text/plain,x'),null); assert.equal(safeDestination('file:///x'),null); assert.equal(safeDestination('https://u:p@example.com/'),null);
 assert.equal(appendAttributionToken('https://example.com/a?x=1',token).includes('x=1'),true); assert.equal(appendAttributionToken('https://example.com/?sm_at=already',token),null);
 assert.notEqual(await destinationFingerprint('https://example.com/?x=one'),await destinationFingerprint('https://example.com/?x=two'));
});
test('4F-4A uses hash-only redirect, token precedence, and safe aggregate metrics', async()=>{
 const [source,migration,ui,editor]=await Promise.all([readFile(new URL('../src/index.ts',import.meta.url),'utf8'),readFile(new URL('../migrations/0020_tracked_uri_attribution.sql',import.meta.url),'utf8'),readFile(new URL('../../frontend/src/components/JourneyIntelligencePanel.jsx',import.meta.url),'utf8'),readFile(new URL('../../frontend/src/components/TrackedUriTool.jsx',import.meta.url),'utf8')]);
 for(const x of ['tracked_uri_attributions','attribution_token_hash','conversion_event_id','CREATE TABLE','CREATE INDEX']) assert.ok(migration.includes(x),x); assert.equal(/ALTER|DROP|DELETE|UPDATE\s+line_conversion_events/i.test(migration),false);
 for(const x of ["app.get('/r/:trackingToken'","TRACKED_URI_DESTINATION_INVALID","INVALID_ATTRIBUTION_TOKEN","trackedUriClicks","aggregateLineClicks","trackedObservedConversionRate","attributionCoverage"]) assert.ok(source.includes(x),x);
 assert.equal(source.includes('uri_redirect_click'),false); assert.match(source,/const mapped = tracked[\s\S]*?: touch/);
 for(const x of ['LINE aggregate','Tracked URI','trackedObservedConversionRate','URI_TRACKING_NOT_ENABLED','—']) assert.ok(ui.includes(x),x);
 for(const x of ['建立追蹤連結','複製追蹤連結','localStorage','sessionStorage']) assert.ok(x==='localStorage'||x==='sessionStorage'? !editor.includes(x):editor.includes(x),x); assert.match(editor,/\['owner','admin','editor'\]/); assert.match(editor,/不會自動修改/);
});
