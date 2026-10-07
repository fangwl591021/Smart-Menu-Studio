import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateNoticeInventory } from '../scripts/notice-inventory.mjs';

const body = Buffer.from('Synthetic notice, not a legal conclusion.\n');
const engineSha256 = '1'.repeat(64);
const artifact = { engine: { sha256: engineSha256 } };
const fixture = () => ({ format: 1, engineSha256, completed: false,
  unresolved: [{ id: 'source-review', reason: 'Synthetic pending source review.' }],
  notices: [{ file: 'licenses/Synthetic.txt', source: 'https://example.invalid/LICENSE',
    sha256: createHash('sha256').update(body).digest('hex') }] });
const readFor = (review, value = body) => url =>
  url.pathname.endsWith('/native-review.json') ? JSON.stringify(review) : value;

test('inventory checks notice integrity without falsely completing a pending review', () => {
  assert.deepEqual(validateNoticeInventory({ artifact, read: readFor(fixture()) }), {
    completed: false, noticeCount: 1, unresolved: ['source-review'] });
});

test('review completion requires an empty unresolved list', () => {
  assert.throws(() => validateNoticeInventory({ artifact,
    read: readFor({ ...fixture(), completed: true }) }), /OCR_NOTICE_INVENTORY_INVALID/);
});

test('changed or empty notice bytes fail their pinned hash', () => {
  for (const value of [Buffer.from('changed'), Buffer.alloc(0), Buffer.alloc(512 * 1024 + 1)])
    assert.throws(() => validateNoticeInventory({ artifact,
      read: readFor(fixture(), value) }), /OCR_NOTICE_HASH_MISMATCH/);
});

test('engine substitution, path traversal and duplicate notices are rejected', () => {
  for (const alter of [
    review => { review.engineSha256 = '2'.repeat(64); },
    review => { review.notices[0].file = 'licenses/../../.env'; },
    review => { review.notices.push(review.notices[0]); },
    review => { review.notices[0].source = 'https://name:secret@example.invalid/LICENSE'; },
  ]) {
    const review = fixture(); alter(review);
    assert.throws(() => validateNoticeInventory({ artifact,
      read: readFor(review) }), /OCR_NOTICE_INVENTORY_INVALID/);
  }
});

test('missing notice files fail with a sanitized diagnostic', () => {
  assert.throws(() => validateNoticeInventory({ artifact, read: () => {
    throw new Error('A filename, contents or credential must not be exposed');
  } }), error => error.message === 'OCR_NOTICE_INVENTORY_INVALID');
});

test('retained source archive bytes are pinned and cannot escape their directory', () => {
  const review = fixture();
  review.sources = [{ file: 'licenses/sources/Synthetic.zip', bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex') }];
  validateNoticeInventory({ artifact, read: readFor(review) });
  for (const change of [
    item => { item.file = 'licenses/sources/../../secret.zip'; },
    item => { item.bytes++; },
    item => { item.sha256 = '0'.repeat(64); },
  ]) {
    const changed = structuredClone(review); change(changed.sources[0]);
    assert.throws(() => validateNoticeInventory({ artifact,
      read: readFor(changed) }), /OCR_NOTICE_(INVENTORY_INVALID|HASH_MISMATCH)/);
  }
});

test('changed build-time source plan cannot reuse the completed review', () => {
  const entry = { name: 'Source.tar.gz', url: 'https://codeload.github.com/official/repository/tar.gz/pin',
    bytes: 123, sha256: '3'.repeat(64) };
  const review = { ...fixture(), sourceArchives: [entry] };
  const planned = { ...artifact, sourceArchives: [entry] };
  validateNoticeInventory({ artifact: planned, read: readFor(review) });
  for (const alter of [
    item => { item.sha256 = '4'.repeat(64); },
    item => { item.url = 'https://unreviewed.invalid/source'; },
    item => { item.name = '../Source.tar.gz'; },
    item => { item.bytes = 101 * 1024 * 1024; },
  ]) {
    const changed = structuredClone(review); alter(changed.sourceArchives[0]);
    assert.throws(() => validateNoticeInventory({ artifact: planned,
      read: readFor(changed) }), /OCR_NOTICE_INVENTORY_INVALID/);
  }
});

test('real completed review pins notices, retained sources and the build-time source plan', () => {
  const result = validateNoticeInventory();
  assert.equal(result.noticeCount, 58);
  assert.equal(result.completed, true);
  assert.deepEqual(result.unresolved, []);
  const pinned = JSON.parse(readFileSync(new URL('../../native-artifacts.json', import.meta.url)));
  assert.equal(pinned.nativeThirdPartyNoticesReviewed, true);
});
