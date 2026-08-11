import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [appSource, moduleSource] = await Promise.all([
  readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SystemWorkspaceModules.jsx', import.meta.url), 'utf8'),
]);

const accountStart = appSource.indexOf('const WorkspaceAccountView =');
const accountEnd = appSource.indexOf('\nconst ', accountStart + 10);
const accountSource = appSource.slice(accountStart, accountEnd);

test('8A-B module page operates entirely with workspace slug', () => {
  assert.match(moduleSource, /encodeURIComponent\(workspace\.slug\)/);
  assert.match(moduleSource, /encodeURIComponent\(selectedWorkspace\.slug\)/);
  assert.doesNotMatch(moduleSource, /workspace\.id|workspace_id|workspaceId/);
});

test('8A-B manage modules action retains only the safe workspace object', () => {
  assert.match(moduleSource, /onClick=\{\(\) => openWorkspace\(workspace\)\}/);
  assert.match(moduleSource, /key=\{workspace\.slug\}/);
  assert.doesNotMatch(moduleSource, /key=\{workspace\.id\}/);
});

test('8A-B module read request uses safe workspace reference', () => {
  assert.match(moduleSource, /safeReference = encodeURIComponent\(workspace\.slug\)[\s\S]*\/api\/system\/workspaces\/\$\{safeReference\}\/modules/);
});

test('8A-B enable and disable share the safe workspace mutation route', () => {
  assert.match(moduleSource, /safeReference = encodeURIComponent\(selectedWorkspace\.slug\)[\s\S]*\/api\/system\/workspaces\/\$\{safeReference\}\/modules\/\$\{encodeURIComponent\(module\.moduleKey\)\}\/status/);
  assert.match(moduleSource, /body: JSON\.stringify\(\{ enabled: nextEnabled \}\)/);
});

test('8A-B existing System Admin workspace management no longer depends on raw workspace id', () => {
  assert.match(accountSource, /safeWorkspaceReference = encodeURIComponent\(workspace\.slug\)/);
  assert.doesNotMatch(accountSource, /workspace\.id|workspace_id|workspaceId/);
  assert.doesNotMatch(appSource, /key=\{row\.id\}[\s\S]{0,300}onOpenWorkspace/);
});

test('8A-B no raw workspace id is browser-persisted by module management', () => {
  assert.doesNotMatch(moduleSource, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(moduleSource, /workspace\.id|workspace_id|workspaceId/);
});