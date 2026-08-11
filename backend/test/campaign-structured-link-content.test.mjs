import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CAMPAIGN_TRACKED_LINK_MAX_COUNT,
  CAMPAIGN_TRACKED_LINK_TOKEN_MAX_LENGTH,
  publicCampaignTextContent,
  renderCampaignTextContent,
  validateCampaignContent,
} from '../src/campaign/content.ts';

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const link = (token, destinationUrl = `https://example.com/${token}`, label = token) => ({ token, destinationUrl, label });
const structured = (text = 'Open {{link:offer}}', links = [link('offer')]) => ({ contentType: 'TEXT', text, links });

test('1 legacy TEXT content remains accepted', () => {
  const result = validateCampaignContent({ contentType: 'TEXT', text: 'hello' });
  assert.equal(result.payloadJson, '{"text":"hello"}');
});

test('2 a legacy plain URL remains byte-for-byte unchanged', async () => {
  const text = 'Visit https://example.com/path?a=1';
  assert.equal(await renderCampaignTextContent({ contentType: 'TEXT', payloadJson: JSON.stringify({ text }) }), text);
});

test('3 an explicitly declared structured token is accepted', () => {
  assert.deepEqual(JSON.parse(validateCampaignContent(structured()).payloadJson).links[0], link('offer'));
});

test('4 an HTTPS destination is accepted and canonicalized', () => {
  const stored = JSON.parse(validateCampaignContent(structured('Open {{link:offer}}', [link('offer', 'https://example.com')])).payloadJson);
  assert.equal(stored.links[0].destinationUrl, 'https://example.com/');
});

test('5 a javascript destination is rejected', () => {
  assert.throws(() => validateCampaignContent(structured('Open {{link:x}}', [link('x', 'javascript:alert(1)')])), /CAMPAIGN_CONTENT_LINK_DESTINATION_INVALID/);
});

test('6 a data URI destination is rejected', () => {
  assert.throws(() => validateCampaignContent(structured('Open {{link:x}}', [link('x', 'data:text/plain,test')])), /CAMPAIGN_CONTENT_LINK_DESTINATION_INVALID/);
});

test('7 duplicate token declarations are rejected', () => {
  assert.throws(() => validateCampaignContent(structured('A {{link:x}}', [link('x'), link('x')])), /CAMPAIGN_CONTENT_LINK_TOKEN_DUPLICATE/);
});

test('8 malformed tracked-link expressions are rejected', () => {
  assert.throws(() => validateCampaignContent(structured('A {{link:bad token}}', [link('bad-token')])), /CAMPAIGN_CONTENT_LINK_TOKEN_INVALID/);
});

test('9 undeclared tracked-link expressions are rejected', () => {
  assert.throws(() => validateCampaignContent(structured('A {{link:other}}', [link('x')])), /CAMPAIGN_CONTENT_LINK_TOKEN_UNDECLARED/);
  assert.throws(() => validateCampaignContent({ contentType: 'TEXT', text: 'A {{link:other}}' }), /CAMPAIGN_CONTENT_LINK_TOKEN_UNDECLARED/);
});

test('10 unused declarations are rejected', () => {
  assert.throws(() => validateCampaignContent(structured('No placeholder', [link('x')])), /CAMPAIGN_CONTENT_LINK_UNUSED/);
});

test('11 tracked-link count is bounded at ten', () => {
  assert.equal(CAMPAIGN_TRACKED_LINK_MAX_COUNT, 10);
  const links = Array.from({ length: 11 }, (_, index) => link(`t${index}`));
  const text = links.map(item => `{{link:${item.token}}}`).join(' ');
  assert.throws(() => validateCampaignContent(structured(text, links)), /CAMPAIGN_CONTENT_LINKS_INVALID/);
});

test('12 safe read projection returns only token destinationUrl and label', () => {
  const payloadJson = validateCampaignContent(structured()).payloadJson;
  const projected = publicCampaignTextContent('TEXT', payloadJson);
  assert.deepEqual(Object.keys(projected.links[0]).sort(), ['destinationUrl', 'label', 'token']);
});

test('13 content payload freezes the token destination mapping in JSON', () => {
  const payload = JSON.parse(validateCampaignContent(structured()).payloadJson);
  assert.equal(payload.links[0].token, 'offer');
  assert.equal(payload.links[0].destinationUrl, 'https://example.com/offer');
});

test('14 link declaration order canonicalizes deterministically', () => {
  const text = '{{link:a}} and {{link:b}}';
  const first = validateCampaignContent(structured(text, [link('b'), link('a')])).payloadJson;
  const second = validateCampaignContent(structured(text, [link('a'), link('b')])).payloadJson;
  assert.equal(first, second);
});

test('15 destination changes produce a different immutable version payload', () => {
  const v1 = validateCampaignContent(structured()).payloadJson;
  const v2 = validateCampaignContent(structured('Open {{link:offer}}', [link('offer', 'https://example.com/new')])).payloadJson;
  assert.notEqual(v1, v2);
});

test('16 legacy storage shape is not reinterpreted as structured content', () => {
  assert.deepEqual(JSON.parse(validateCampaignContent({ contentType: 'TEXT', text: 'https://example.com' }).payloadJson), { text: 'https://example.com' });
});

test('17 execution remains bound to the prepared frozen content version', async () => {
  const source = await read('../src/campaign/executions.ts');
  assert.match(source, /prepared_content_version_no/);
  assert.match(source, /campaign_content_versions[\s\S]*version_no=\?/);
  assert.match(source, /recipientTrackedContent/);
});

test('18 renderer never scans or rewrites arbitrary URLs', async () => {
  const text = 'A https://example.com and B https://example.net';
  let calls = 0;
  const rendered = await renderCampaignTextContent({ contentType: 'TEXT', payloadJson: JSON.stringify({ text }), resolveTrackedLink: () => { calls += 1; return 'https://track.example/o'; } });
  assert.equal(rendered, text);
  assert.equal(calls, 0);
});

test('19 registered token replacement requires the explicit resolver', async () => {
  const payloadJson = validateCampaignContent(structured()).payloadJson;
  assert.equal(await renderCampaignTextContent({ contentType: 'TEXT', payloadJson, resolveTrackedLink: () => 'https://track.example/o' }), 'Open https://track.example/o');
});

test('20 multiple declared tokens resolve in canonical token order', async () => {
  const payloadJson = validateCampaignContent(structured('{{link:b}} then {{link:a}}', [link('b'), link('a')])).payloadJson;
  const calls = [];
  const rendered = await renderCampaignTextContent({ contentType: 'TEXT', payloadJson, resolveTrackedLink: definition => { calls.push(definition.token); return `https://track.example/${definition.token}`; } });
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(rendered, 'https://track.example/b then https://track.example/a');
});

test('21 resolver receives no raw execution delivery Person or LINE identity contract', async () => {
  const payloadJson = validateCampaignContent(structured()).payloadJson;
  await renderCampaignTextContent({ contentType: 'TEXT', payloadJson, resolveTrackedLink: definition => {
    assert.deepEqual(Object.keys(definition).sort(), ['destinationUrl', 'label', 'token']);
    assert.equal(Object.isFrozen(definition), true);
    return 'https://track.example/opaque-reference';
  } });
});

test('22 unresolved required token fails closed', async () => {
  const payloadJson = validateCampaignContent(structured()).payloadJson;
  await assert.rejects(renderCampaignTextContent({ contentType: 'TEXT', payloadJson }), /CAMPAIGN_TRACKED_LINK_RESOLVER_REQUIRED/);
});

test('23 final rendered LINE text length is enforced after expansion', async () => {
  const payloadJson = validateCampaignContent(structured(`${'a'.repeat(4985)}{{link:x}}`, [link('x')])).payloadJson;
  await assert.rejects(renderCampaignTextContent({ contentType: 'TEXT', payloadJson, resolveTrackedLink: () => `https://track.example/${'z'.repeat(100)}` }), /CAMPAIGN_RENDERED_TEXT_TOO_LONG/);
});

test('24 7C-A migrations remain free of click tracking tables', async () => {
  const files = await read('../../.gitignore').then(() => Promise.all([read('../migrations/0043_campaign_content_prepare_contract.sql'), read('../migrations/0044_campaign_execution_delivery.sql')]));
  assert.doesNotMatch(files.join('\n'), /CREATE TABLE IF NOT EXISTS campaign_(?:tracked_links|click_events)/i);
});

test('25 7C introduces only the explicit campaign click route registration', async () => {
  const source = await read('../src/index.ts');
  assert.match(source, /registerCampaignClickRoutes/);
  assert.doesNotMatch(source, /campaign.*(?:open|pixel)|(?:open|pixel).*campaign/i);
});

test('26 known-Person click semantics are locked to engagement without acquisition writes', async () => {
  const source = await read('../src/campaign/content.ts');
  assert.match(source, /already-known CRM Person is engagement, never acquisition/);
  assert.doesNotMatch(source, /(INSERT INTO|UPDATE|DELETE FROM)[^\n]*crm_acquisition_events/i);
});

test('27 structured content performs no Referral mutation', async () => {
  const source = await read('../src/campaign/content.ts');
  assert.doesNotMatch(source, /(INSERT INTO|UPDATE|DELETE FROM)[^\n]*referral/i);
});

test('28 structured content performs no Points Commission or Stage mutation', async () => {
  const source = await read('../src/campaign/content.ts');
  assert.doesNotMatch(source, /(INSERT INTO|UPDATE|DELETE FROM)[^\n]*(points?|commission|crm_person_stage)/i);
});

test('29 raw identity query keys and provider payload fields are rejected', () => {
  assert.throws(() => validateCampaignContent(structured('A {{link:x}}', [link('x', 'https://example.com/?line_user_id=U123')])), /CAMPAIGN_CONTENT_LINK_DESTINATION_INVALID/);
  assert.throws(() => validateCampaignContent({ ...structured(), executionId: 'raw' }), /CAMPAIGN_CONTENT_INVALID/);
  assert.throws(() => validateCampaignContent(structured('A {{link:x}}', [{ ...link('x'), providerPayload: {} }])), /CAMPAIGN_CONTENT_INVALID/);
});

test('30 frontend has no 7C-A tracked-link UI contract', async () => {
  const frontend = await read('../../frontend/src/App.jsx');
  assert.doesNotMatch(frontend, /\{\{link:|destinationUrl|resolveTrackedLink/);
});

test('token names are bounded and reused placeholders are rejected', () => {
  assert.equal(CAMPAIGN_TRACKED_LINK_TOKEN_MAX_LENGTH, 40);
  const token = 'x'.repeat(41);
  assert.throws(() => validateCampaignContent(structured(`{{link:${token}}}`, [link(token)])), /CAMPAIGN_CONTENT_LINK_TOKEN_INVALID/);
  assert.throws(() => validateCampaignContent(structured('{{link:x}} {{link:x}}', [link('x')])), /CAMPAIGN_CONTENT_LINK_TOKEN_REUSED/);
});

test('resolver output must remain HTTPS and cannot inject raw identity query keys', async () => {
  const payloadJson = validateCampaignContent(structured()).payloadJson;
  await assert.rejects(renderCampaignTextContent({ contentType: 'TEXT', payloadJson, resolveTrackedLink: () => 'http://track.example/x' }), /CAMPAIGN_TRACKED_LINK_RESOLUTION_INVALID/);
  await assert.rejects(renderCampaignTextContent({ contentType: 'TEXT', payloadJson, resolveTrackedLink: () => 'https://track.example/x?delivery_id=raw' }), /CAMPAIGN_TRACKED_LINK_RESOLUTION_INVALID/);
});
