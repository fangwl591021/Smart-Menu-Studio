import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  classifyRichMenuLayout,
  normalizeDetectedRichMenuAreas,
  readImageDimensions,
  resolveRichMenuDimensions,
  richMenuAreaStyle,
  validateRichMenuAreas,
  validateRichMenuImageDimensions,
} from '../src/rich-menu-layout.ts';

const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

test('accepts the legacy 2500x1686 rich menu size', () => {
  assert.deepEqual(validateRichMenuImageDimensions(2500, 1686), {
    width: 2500,
    height: 1686,
    layoutType: 'TALL',
  });
});

test('accepts the compact 2500x843 rich menu size', () => {
  assert.deepEqual(validateRichMenuImageDimensions(2500, 843), {
    width: 2500,
    height: 843,
    layoutType: 'COMPACT',
  });
});

test('preserves another valid LINE rich menu size', () => {
  assert.equal(validateRichMenuImageDimensions(1200, 600).width, 1200);
});

test('classifies compact and tall layouts deterministically', () => {
  assert.equal(classifyRichMenuLayout(2500, 843), 'COMPACT');
  assert.equal(classifyRichMenuLayout(2500, 1686), 'TALL');
});

test('uses legacy dimensions only when stored dimensions are absent', () => {
  assert.deepEqual(resolveRichMenuDimensions(null, null), { width: 2500, height: 1686 });
  assert.deepEqual(resolveRichMenuDimensions(2500, 843), { width: 2500, height: 843 });
});

test('reads actual compact dimensions from the uploaded PNG bytes', () => {
  assert.deepEqual(readImageDimensions(pngHeader(2500, 843), 'image/png'), {
    width: 2500,
    height: 843,
  });
});

test('normalizes a three-column compact layout without forcing height 1686', () => {
  const areas = normalizeDetectedRichMenuAreas([
    { id: 1, label: 'A', x: 0, y: 0, width: 834, height: 843 },
    { id: 2, label: 'B', x: 834, y: 0, width: 833, height: 843 },
    { id: 3, label: 'C', x: 1667, y: 0, width: 833, height: 843 },
  ], 2500, 843);
  assert.equal(areas.length, 3);
  assert.equal(areas[2].x + areas[2].width, 2500);
  assert.equal(areas[0].height, 843);
});

test('clamps detected coordinates to the actual compact image bounds', () => {
  const [area] = normalizeDetectedRichMenuAreas([
    { x: -20, y: 900, width: 4000, height: 4000 },
  ], 2500, 843);
  assert.deepEqual({ x: area.x, y: area.y, width: area.width, height: area.height }, {
    x: 0,
    y: 842,
    width: 2500,
    height: 1,
  });
});

test('compact overlay percentages use height 843', () => {
  const style = richMenuAreaStyle({ x: 0, y: 421.5, width: 1250, height: 421.5 }, 2500, 843);
  assert.equal(style.top, '50%');
  assert.equal(style.height, '50%');
  assert.equal(style.width, '50%');
});

test('legacy overlay percentages remain unchanged', () => {
  const style = richMenuAreaStyle({ x: 1250, y: 843, width: 1250, height: 843 }, 2500, 1686);
  assert.deepEqual(style, { left: '50%', top: '50%', width: '50%', height: '50%' });
});

test('rejects more than 20 saved areas', () => {
  assert.throws(
    () => validateRichMenuAreas(Array.from({ length: 21 }, (_, x) => ({ x, y: 0, width: 1, height: 1 })), 2500, 843),
    /RICH_MENU_AREA_COUNT_INVALID/,
  );
});

test('rejects a saved area outside compact bounds', () => {
  assert.throws(
    () => validateRichMenuAreas([{ x: 0, y: 842, width: 100, height: 2 }], 2500, 843),
    /RICH_MENU_AREA_OUT_OF_BOUNDS/,
  );
});

test('AI prompt is based on actual upload dimensions and caps output at 20', () => {
  assert.match(source, /這張圖片的實際尺寸是[\s\S]*imageWidth[\s\S]*imageHeight/);
  assert.match(source, /不要推測、縮放或改用其他畫布尺寸/);
  assert.match(source, /maxItems:\s*20/);
});

test('asset upload persists actual width and height without a migration backfill', () => {
  assert.match(source, /size_bytes, width, height, status/);
  assert.match(source, /readImageDimensions\(imageBuffer, image\.type/);
  assert.equal(source.includes("['image/png', 'image/jpeg', 'image/webp']"), false);
  assert.equal(source.includes("if (image.size > 1024 * 1024)"), true);
});

test('LINE publish payload uses project image dimensions', () => {
  assert.match(source, /size:\s*\{\s*width:\s*dimensions\.width,\s*height:\s*dimensions\.height/);
  assert.doesNotMatch(source, /size:\s*\{\s*width:\s*2500,\s*height:\s*1686/);
});

test('frontend preview, detection, save and reload share dimension metadata', () => {
  assert.match(frontend, /richMenuAspectStyle\(imageDimensions\)/);
  assert.match(frontend, /setImageDimensions\(dimensions\)/);
  assert.match(frontend, /style:\s*richMenuOverlayStyle\(area, dimensions\)/);
  assert.match(frontend, /\.\.\.finalDimensions/);
});
