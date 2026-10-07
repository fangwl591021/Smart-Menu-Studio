import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const digest = /^[a-f0-9]{64}$/;

export function validateNoticeInventory({ read = readFileSync, artifact } = {}) {
  try {
    artifact ??= JSON.parse(read(new URL('native-artifacts.json', root), 'utf8'));
    const review = JSON.parse(read(new URL('licenses/native-review.json', root), 'utf8'));
    if (review.format !== 1 || !digest.test(review.engineSha256)
      || review.engineSha256 !== artifact.engine?.sha256
      || typeof review.completed !== 'boolean' || !Array.isArray(review.unresolved)
      || !Array.isArray(review.notices) || review.notices.length < 1
      || review.notices.length > 200 || (review.completed && review.unresolved.length))
      throw new Error('OCR_NOTICE_INVENTORY_INVALID');
    if (review.unresolved.some(item => !item || !/^[a-z0-9-]{1,80}$/.test(item.id)
      || typeof item.reason !== 'string' || !item.reason.length || item.reason.length > 2000))
      throw new Error('OCR_NOTICE_INVENTORY_INVALID');
    const paths = new Set();
    for (const entry of review.notices) {
      if (!/^licenses\/[A-Za-z0-9_.-]+\.txt$/.test(entry.file)
        || !digest.test(entry.sha256) || paths.has(entry.file))
        throw new Error('OCR_NOTICE_INVENTORY_INVALID');
      const origin = new URL(entry.source);
      if (origin.protocol !== 'https:' || origin.username || origin.password)
        throw new Error('OCR_NOTICE_INVENTORY_INVALID');
      paths.add(entry.file);
      const value = read(new URL(entry.file, root));
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (!bytes.length || bytes.length > 512 * 1024
        || createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
        throw new Error('OCR_NOTICE_HASH_MISMATCH');
    }
    return { completed: review.completed, noticeCount: review.notices.length,
      unresolved: review.unresolved.map(item => item.id) };
  } catch (error) {
    if (error?.message === 'OCR_NOTICE_HASH_MISMATCH') throw error;
    throw new Error('OCR_NOTICE_INVENTORY_INVALID');
  }
}
