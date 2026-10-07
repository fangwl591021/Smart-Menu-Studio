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

test('real retained notices match all hashes; native publication remains blocked', () => {
  const result = validateNoticeInventory();
  assert.equal(result.noticeCount, 51);
  assert.equal(result.completed, false);
  assert.deepEqual(result.unresolved, ['pocketfft-source', 'eigen-compiled-scope', 'bundled-gcc-runtime']);
  const pinned = JSON.parse(readFileSync(new URL('../../native-artifacts.json', import.meta.url)));
  assert.equal(pinned.nativeThirdPartyNoticesReviewed, false);
});
