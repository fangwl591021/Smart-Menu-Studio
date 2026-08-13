import assert from 'node:assert/strict';
import test from 'node:test';
import { requestOpenAiResponses } from '../src/openai-responses.ts';

test('MLM service binding is the primary Responses API path', async () => {
  let requestedUrl = '';
  let requestedInit;
  const service = {
    async fetch(url, init) {
      requestedUrl = String(url);
      requestedInit = init;
      return Response.json({ output_text: '{}' });
    },
  };
  const response = await requestOpenAiResponses({
    service,
    apiKey: 'must-not-be-used',
    body: { model: 'gpt-5.6-terra', input: [] },
  });
  assert.equal(response.ok, true);
  assert.equal(requestedUrl, 'https://mlm.internal/api/internal/ai/responses');
  assert.deepEqual(JSON.parse(requestedInit.body), { request: { model: 'gpt-5.6-terra', input: [] } });
  assert.equal(requestedInit.headers.Authorization, undefined);
});

test('direct OpenAI is the second mode when the service binding is unavailable', async () => {
  let requestedUrl = '';
  let requestedInit;
  const response = await requestOpenAiResponses({
    apiKey: 'server-secret',
    body: { model: 'gpt-5.6-terra', input: [] },
    fetcher: async (url, init) => {
      requestedUrl = String(url);
      requestedInit = init;
      return Response.json({ output_text: '{}' });
    },
  });
  assert.equal(response.ok, true);
  assert.equal(requestedUrl, 'https://api.openai.com/v1/responses');
  assert.equal(requestedInit.headers.Authorization, 'Bearer server-secret');
  assert.deepEqual(JSON.parse(requestedInit.body), { model: 'gpt-5.6-terra', input: [] });
});

test('missing both provider modes fails closed', async () => {
  await assert.rejects(
    requestOpenAiResponses({ body: { model: 'gpt-5.6-terra' } }),
    /AI_PROVIDER_NOT_CONFIGURED/,
  );
});
