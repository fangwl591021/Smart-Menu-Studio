import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [workspace, editor] = await Promise.all([
  read('../src/components/TravelPromotionWorkspace.jsx'),
  read('../src/components/TravelPromotionExtractionEditor.jsx'),
]);

test('new DM requires an image, creates without a manual label, and immediately enters AI review', () => {
  const start = workspace.indexOf('function CreateDm');
  const end = workspace.indexOf('function FormalLink', start);
  const createFlow = workspace.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(createFlow, /素材名稱|displayLabel/);
  assert.match(createFlow, /貼上 DM 文字（選填）/);
  assert.match(createFlow, /請先上傳 DM 圖片。/);
  const createAt = createFlow.indexOf("requestJson(request, '/api/travel/promotions'");
  const extractAt = createFlow.indexOf('/extract');
  assert.ok(createAt >= 0 && extractAt > createAt);
  assert.ok(createFlow.includes('const created = createdBody.promotion'));
  assert.ok(createFlow.includes('onCreated(extractedBody.promotion)'));
});
test('DM create and extract preserve backend error code and readable error', () => {
  const requestStart = workspace.indexOf('async function requestJson');
  const requestEnd = workspace.indexOf('const localDateTime', requestStart);
  const requestFlow = workspace.slice(requestStart, requestEnd);
  assert.ok(requestFlow.includes("error.errorCode = body?.errorCode || 'REQUEST_FAILED'"));
  assert.ok(requestFlow.includes("error.backendError = body?.error || '操作失敗'"));
  assert.ok(requestFlow.includes("(cause.errorCode || 'REQUEST_FAILED') + '：' + (cause.backendError || cause.message || '操作失敗')"));

  const createStart = workspace.indexOf('function CreateDm');
  const createEnd = workspace.indexOf('function FormalLink', createStart);
  const createFlow = workspace.slice(createStart, createEnd);
  assert.ok(createFlow.includes("requestJson(request, '/api/travel/promotions'"));
  assert.ok(createFlow.includes('/extract'));
  assert.ok(createFlow.includes('setError(requestErrorDetail(cause))'));
  assert.doesNotMatch(createFlow, /setError\(travelPromotionErrorMessage\(cause\.message\)\)/);
});
test('DM image upload uses the backend contract, updates the selected count, and exposes backend errors', () => {
  const start = workspace.indexOf('function CreateDm');
  const end = workspace.indexOf('function FormalLink', start);
  const createFlow = workspace.slice(start, end);
  for (const expected of [
    "data.append('image', file)",
    "data.append('purpose', 'travel-promotion-dm')",
    "['image/jpeg', 'image/png'].includes(file.type)",
    'file.size < 1 || file.size > 1024 * 1024',
    'body.asset.id].slice(0, 8)',
    'body?.errorCode',
    'setError(cause instanceof Error ? cause.message',
  ]) assert.ok(createFlow.includes(expected), `missing ${expected}`);
  assert.doesNotMatch(createFlow, /travelPromotionErrorMessage(cause.message)/);
});
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
