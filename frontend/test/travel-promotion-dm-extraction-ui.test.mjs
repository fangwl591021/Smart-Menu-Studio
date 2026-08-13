import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [workspace, editor] = await Promise.all([
  read('../src/components/TravelPromotionWorkspace.jsx'),
  read('../src/components/TravelPromotionExtractionEditor.jsx'),
]);

test('DM extraction review keeps original image beside structured manual correction', () => {
  assert.match(workspace, /alt="原始 DM"/);
  assert.match(workspace, /max-h-\[70vh\][^"']*object-contain/);
  assert.match(workspace, /<TravelPromotionExtractionEditor extraction=\{extraction\}/);
  for (const label of ['標題', '副標題', '品牌', '出發地', '價格原文', '航空公司', '去程', '回程', '電話', 'LINE ID', 'Instagram', 'Facebook']) {
    assert.ok(editor.includes(label), `missing ${label}`);
  }
});

test('AI response automatically fills structured fields and save retains draft extraction', () => {
  assert.match(workspace, /setExtraction\(promotion\.extraction \|\| null\)/);
  assert.match(workspace, /onChanged\(body\.promotion\)/);
  assert.match(workspace, /\.\.\.fromForm\(form\), extraction, expectedVersionNo/);
  assert.match(editor, /onChange\(path, value\)/);
  assert.match(editor, /OCR 原文/);
  assert.match(editor, /Warnings/);
  assert.match(editor, /Confidence/);
});

test('AI extraction remains separate from explicit activation', () => {
  assert.match(workspace, /if \(kind === 'ai'\)[^;]*\/extract/);
  assert.match(workspace, /if \(kind === 'activate'\)[^;]*\/activate/);
  assert.doesNotMatch(workspace, /if \(kind === 'ai'\)[^;]*\/activate/);
});
