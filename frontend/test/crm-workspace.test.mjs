import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = await readFile(
  fileURLToPath(new URL('../src/components/CrmWorkspace.jsx', import.meta.url)),
  'utf8',
);

test('CRM workspace uses only opaque transient assignee references', () => {
  assert.match(source, /\/api\/crm\/assignees/);
  assert.match(source, /assignedUserReference/);
  assert.match(source, /\/assignment/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /users\.id|memberId|line_identity_hash|source_ref|revokeHandle|token_hash/i);
});

test('CRM workspace keeps CRM owner separate from the referral system relationship', () => {
  assert.match(source, /推薦人（系統歸屬）/);
  assert.match(source, /CRM 負責人/);
  assert.match(source, /referrerLabel/);
  assert.match(source, /assignedOwner/);
});

test('CRM workspace exposes read-only CRM 360 safe sections and capability truth', () => {
  for (const value of ['取得來源', '推薦關係（唯讀）', '個人卡片', '歷史商務名片', 'CSV：可使用', 'XLSX：待提供', 'OCR：待提供', '未來功能：Timeline']) {
    assert.match(source, new RegExp(value));
  }
  assert.match(source, /api\(request,/);
});
