import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteRichMenuAlias,
  getDefaultRichMenu,
  getRichMenuAlias,
  setDefaultRichMenu,
  upsertRichMenuAlias,
  verifyDefaultRichMenu,
} from '../src/line-rich-menu.mjs';

const response = (status, body = '') => new Response(body, {
  status,
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
});

test('creates an alias after confirming it does not exist', async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    return calls.length === 1 ? response(404) : response(200, '{}');
  };

  const result = await upsertRichMenuAlias(fetcher, 'token', 'project-a', 'richmenu-a');
  assert.equal(result.operation, 'created');
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[1].url, 'https://api.line.me/v2/bot/richmenu/alias');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    richMenuAliasId: 'project-a',
    richMenuId: 'richmenu-a',
  });
});

test('updates an existing alias to the newly published rich menu', async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    return calls.length === 1
      ? response(200, JSON.stringify({ richMenuAliasId: 'project-a', richMenuId: 'old-menu' }))
      : response(200, '{}');
  };

  const result = await upsertRichMenuAlias(fetcher, 'token', 'project-a', 'new-menu');
  assert.equal(result.operation, 'updated');
  assert.equal(calls[1].url, 'https://api.line.me/v2/bot/richmenu/alias/project-a');
  assert.deepEqual(JSON.parse(calls[1].options.body), { richMenuId: 'new-menu' });
});

test('gets alias mapping for setting the default homepage', async () => {
  const alias = await getRichMenuAlias(
    async () => response(200, JSON.stringify({ richMenuAliasId: 'home', richMenuId: 'richmenu-home' })),
    'token',
    'home',
  );
  assert.equal(alias.richMenuId, 'richmenu-home');
});

test('deleting a missing alias is idempotent for disabled projects', async () => {
  const result = await deleteRichMenuAlias(async () => response(404), 'token', 'project-a');
  assert.deepEqual(result, { deleted: false, aliasId: 'project-a' });
});

test('sets default homepage through the official LINE endpoint', async () => {
  let request;
  await setDefaultRichMenu(async (url, options) => {
    request = { url, options };
    return response(200, '{}');
  }, 'token', 'richmenu-home');

  assert.equal(request.url, 'https://api.line.me/v2/bot/user/all/richmenu/richmenu-home');
  assert.equal(request.options.method, 'POST');
});

test('reads and verifies the current default through the official LINE endpoint', async () => {
  let request;
  const fetcher = async (url, options = {}) => {
    request = { url, options };
    return response(200, JSON.stringify({ richMenuId: 'richmenu-home' }));
  };

  const current = await getDefaultRichMenu(fetcher, 'token');
  assert.deepEqual(current, { richMenuId: 'richmenu-home' });
  assert.equal(request.url, 'https://api.line.me/v2/bot/user/all/richmenu');
  assert.equal(request.options.headers.Authorization, 'Bearer token');
  assert.equal(await verifyDefaultRichMenu(fetcher, 'token', 'richmenu-home'), true);
  assert.equal(await verifyDefaultRichMenu(fetcher, 'token', 'richmenu-other'), false);
});

test('LINE helper errors do not include raw provider response bodies', async () => {
  await assert.rejects(
    setDefaultRichMenu(
      async () => response(403, JSON.stringify({ message: 'provider-secret-detail' })),
      'token',
      'richmenu-home',
    ),
    error => {
      assert.equal(error.code, 'LINE_DEFAULT_ASSIGN_FAILED');
      assert.doesNotMatch(error.message, /provider-secret-detail/);
      return true;
    },
  );
});
