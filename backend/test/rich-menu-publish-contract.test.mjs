import test from 'node:test';
import assert from 'node:assert/strict';
import { publishRichMenuToLine } from '../src/line-rich-menu.mjs';

const response = (status, body = '') => new Response(body, {
  status,
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
});

const publishInput = fetcher => ({
  fetcher,
  channelAccessToken: 'workspace-token',
  richMenuObject: { name: 'Menu', size: { width: 2500, height: 843 }, areas: [] },
  imageBody: new Uint8Array([1, 2, 3]),
  imageContentType: 'image/png',
  richMenuAliasId: 'project-a',
});

const lineFetcher = ({ failAt = '', mismatch = false, providerBody = '' } = {}) => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://api.line.me/v2/bot/richmenu' && options.method === 'POST') {
      return failAt === 'create' ? response(500, providerBody) : response(200, JSON.stringify({ richMenuId: 'richmenu-new' }));
    }
    if (url.endsWith('/richmenu/richmenu-new/content')) {
      return failAt === 'upload' ? response(500, providerBody) : response(200);
    }
    if (url.endsWith('/richmenu/alias/project-a') && !options.method) return response(404);
    if (url.endsWith('/richmenu/alias') && options.method === 'POST') {
      return failAt === 'alias' ? response(500, providerBody) : response(200, '{}');
    }
    if (url.endsWith('/user/all/richmenu/richmenu-new') && options.method === 'POST') {
      return failAt === 'default' ? response(403, providerBody) : response(200);
    }
    if (url.endsWith('/user/all/richmenu') && !options.method) {
      if (failAt === 'verify') return response(500, providerBody);
      return response(200, JSON.stringify({ richMenuId: mismatch ? 'richmenu-other' : 'richmenu-new' }));
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };
  return { fetcher, calls };
};

const expectFailure = async (options, expectedCode, expectedProgress) => {
  const mock = lineFetcher(options);
  await assert.rejects(
    publishRichMenuToLine(publishInput(mock.fetcher)),
    error => {
      assert.equal(error.code, expectedCode);
      assert.deepEqual(error.progress, expectedProgress);
      assert.doesNotMatch(error.message, /provider-secret-detail/);
      return true;
    },
  );
};

test('draft publish executes create, upload, alias, default, and verification in order', async () => {
  const mock = lineFetcher();
  const result = await publishRichMenuToLine(publishInput(mock.fetcher));

  assert.deepEqual({
    created: result.created,
    imageUploaded: result.imageUploaded,
    aliasAssigned: result.aliasAssigned,
    defaultAssigned: result.defaultAssigned,
  }, { created: true, imageUploaded: true, aliasAssigned: true, defaultAssigned: true });
  assert.deepEqual(mock.calls.map(call => `${call.options.method || 'GET'} ${call.url}`), [
    'POST https://api.line.me/v2/bot/richmenu',
    'POST https://api-data.line.me/v2/bot/richmenu/richmenu-new/content',
    'GET https://api.line.me/v2/bot/richmenu/alias/project-a',
    'POST https://api.line.me/v2/bot/richmenu/alias',
    'POST https://api.line.me/v2/bot/user/all/richmenu/richmenu-new',
    'GET https://api.line.me/v2/bot/user/all/richmenu',
  ]);
  assert.ok(mock.calls.every(call => call.options.headers.Authorization === 'Bearer workspace-token'));
});

test('published project uses the same unconditional publish orchestration', async () => {
  const mock = lineFetcher();
  const result = await publishRichMenuToLine(publishInput(mock.fetcher));
  assert.equal(result.defaultAssigned, true);
  assert.equal(mock.calls.filter(call => call.url.includes('/user/all/richmenu')).length, 2);
});

test('create failure exposes no completed publish stage', async () => {
  await expectFailure(
    { failAt: 'create', providerBody: 'provider-secret-detail' },
    'LINE_RICH_MENU_CREATE_FAILED',
    { created: false, imageUploaded: false, aliasAssigned: false, defaultAssigned: false },
  );
});

test('upload failure preserves created-only progress', async () => {
  await expectFailure(
    { failAt: 'upload', providerBody: 'provider-secret-detail' },
    'LINE_RICH_MENU_UPLOAD_FAILED',
    { created: true, imageUploaded: false, aliasAssigned: false, defaultAssigned: false },
  );
});

test('alias failure preserves create and upload progress', async () => {
  await expectFailure(
    { failAt: 'alias', providerBody: 'provider-secret-detail' },
    'LINE_ALIAS_ASSIGN_FAILED',
    { created: true, imageUploaded: true, aliasAssigned: false, defaultAssigned: false },
  );
});

test('default failure is partial and never reports defaultAssigned', async () => {
  await expectFailure(
    { failAt: 'default', providerBody: 'provider-secret-detail' },
    'LINE_DEFAULT_ASSIGN_FAILED',
    { created: true, imageUploaded: true, aliasAssigned: true, defaultAssigned: false },
  );
});

test('default read failure is an inconsistent provider failure', async () => {
  await expectFailure(
    { failAt: 'verify', providerBody: 'provider-secret-detail' },
    'LINE_DEFAULT_VERIFY_FAILED',
    { created: true, imageUploaded: true, aliasAssigned: true, defaultAssigned: false },
  );
});

test('default verification mismatch fails closed', async () => {
  await expectFailure(
    { mismatch: true },
    'LINE_DEFAULT_VERIFY_FAILED',
    { created: true, imageUploaded: true, aliasAssigned: true, defaultAssigned: false },
  );
});
