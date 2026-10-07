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
    // Retained source bytes and the exact build-time source download plan are
    // part of this review. Changing a dependency cannot reuse an old approval.
    const sources = review.sources ?? [];
    if (!Array.isArray(sources) || sources.length > 20)
      throw new Error('OCR_NOTICE_INVENTORY_INVALID');
    for (const source of sources) {
      if (!/^licenses\/sources\/[A-Za-z0-9_.-]+\.zip$/.test(source.file)
        || paths.has(source.file) || !digest.test(source.sha256)
        || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > 10 * 1024 * 1024)
        throw new Error('OCR_NOTICE_INVENTORY_INVALID');
      paths.add(source.file);
      const value = read(new URL(source.file, root));
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (bytes.length !== source.bytes
        || createHash('sha256').update(bytes).digest('hex') !== source.sha256)
        throw new Error('OCR_NOTICE_HASH_MISMATCH');
    }
    const downloads = review.sourceArchives ?? [];
    const expectedDownloads = artifact.sourceArchives ?? [];
    if (!Array.isArray(downloads) || !Array.isArray(expectedDownloads)
      || downloads.length > 10 || downloads.length !== expectedDownloads.length)
      throw new Error('OCR_NOTICE_INVENTORY_INVALID');
    let sourceBytes = 0;
    const names = new Set();
    for (let i = 0; i < downloads.length; i++) {
      const entry = downloads[i];
      const expected = expectedDownloads[i];
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(tar\.gz|tar\.xz|dsc)$/.test(entry.name)
        || entry.name.length > 128 || names.has(entry.name) || !digest.test(entry.sha256)
        || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 100 * 1024 * 1024
        || ['name', 'url', 'bytes', 'sha256'].some(key => entry[key] !== expected?.[key]))
        throw new Error('OCR_NOTICE_INVENTORY_INVALID');
      const origin = new URL(entry.url);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port
        || origin.hash || origin.search || !['deb.debian.org', 'codeload.github.com'].includes(origin.hostname))
        throw new Error('OCR_NOTICE_INVENTORY_INVALID');
      sourceBytes += entry.bytes;
      names.add(entry.name);
    }
    if (sourceBytes > 128 * 1024 * 1024)
      throw new Error('OCR_NOTICE_INVENTORY_INVALID');
    return { completed: review.completed, noticeCount: review.notices.length,
      unresolved: review.unresolved.map(item => item.id) };
  } catch (error) {
    if (error?.message === 'OCR_NOTICE_HASH_MISMATCH') throw error;
    throw new Error('OCR_NOTICE_INVENTORY_INVALID');
  }
}
