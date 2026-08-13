import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/components/TravelPromotionWorkspace.jsx', import.meta.url), 'utf8');

test('promotion workspace uses the approved workbench hierarchy and responsive card library', () => {
  for (const label of ['Promotion Workspace', '推廣素材工作台', 'Promotion DM', 'DM Library', '推廣素材池', '兩種資料不要混用', '使用原則']) assert.ok(source.includes(label), `missing ${label}`);
  assert.match(source, /xl:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.match(source, /sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4/);
  assert.match(source, /xl:sticky xl:top-5/);
});

test('new DM is image-first with safe preview, optional text, progress, and manual review handoff', () => {
  for (const label of ['上傳 DM 圖片', '貼上 DM 文字（選填）', '有效期限（選填）', 'AI 處理進度', '正在判斷素材類型並進行 AI 解析', '抽取並進入人工校正', '清空', '移除']) assert.ok(source.includes(label), `missing ${label}`);
  assert.match(source, /body\.asset\.imageUrl/);
  assert.match(source, /removePreview\(item\.reference\)/);
  assert.doesNotMatch(source.slice(source.indexOf('function CreateDm'), source.indexOf('function FormalLink')), /素材名稱|displayLabel/);
});

test('card actions preserve review reanalysis and archive without hard delete', () => {
  for (const label of ['查看素材確認', '重算／封存', '重新 AI 解析', '封存素材']) assert.ok(source.includes(label), `missing ${label}`);
  assert.doesNotMatch(source, /method:\s*'DELETE'|原始 Flex JSON|立即群發|直接推播|直接發送 LINE/);
});
test('promotion composer mirrors the image-selection workbench without adding send authority', () => {
  for (const label of ['Promotion Composer', '選擇推廣素材', '全選可用素材', '清除勾選', '設定呈現格式', 'Server Preview', 'Campaign Handoff']) assert.ok(source.includes(label), `missing ${label}`);
  assert.match(source, /grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6/);
  assert.match(source, /active\.slice\(0, 10\)\.map\(item => item\.safePromotionReference\)/);
  assert.match(source, /state\.composition && <section/);
  assert.doesNotMatch(source, /method:\s*'POST'[^]*\/v2\/bot|立即群發|直接推播|直接發送 LINE/);
});
