import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGuideContext } from '../src/guide/context.ts';
import {
  explainRecommendation,
  findRecommendationById,
  parseExplanation,
} from '../src/guide/explanations/engine.ts';
import { evaluateRecommendations } from '../src/guide/recommendations/engine.ts';
import { evaluateGuide } from '../src/guide/rules.ts';
import { buildGuideWorkflow } from '../src/guide/workflow.ts';

const recommendation = (overrides = {}) => ({
  id: 'rec:R001:project-a:12345678',
  ruleCode: 'R001',
  category: 'engagement',
  priority: 'medium',
  title: '互動形式較單一',
  message: '目前所有區域都使用連結。',
  reason: '缺少可直接互動的動作。',
  evidence: [{ key: 'uriCount', value: 3 }],
  canGenerateProposal: false,
  explanationSource: 'rule',
  suggestedAction: { type: 'review', target: 'project-actions' },
  ...overrides,
});

const geminiResponse = output => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: typeof output === 'string' ? output : JSON.stringify(output) }] } }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const validOutput = {
  summary: '連結功能完整，但互動方式可以更多元。',
  whyItMatters: '不同互動類型能讓使用者更快完成常見操作。',
  suggestedApproach: '檢視是否有適合改成訊息或頁面切換的區域。',
};

test('valid Gemini JSON matches the strict explanation schema', async () => {
  assert.deepEqual(parseExplanation(validOutput), validOutput);
  const result = await explainRecommendation(recommendation(), {
    apiKey: 'test-key',
    fetcher: async () => geminiResponse(validOutput),
  });
  assert.deepEqual(result, { source: 'gemini', status: 'generated', ...validOutput });
});

test('timeout returns the deterministic rule fallback', async () => {
  const result = await explainRecommendation(recommendation(), {
    apiKey: 'test-key',
    timeoutMs: 5,
    fetcher: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  });
  assert.deepEqual(result, {
    source: 'rule',
    status: 'fallback',
    summary: '目前所有區域都使用連結。',
    whyItMatters: '缺少可直接互動的動作。',
    suggestedApproach: '',
  });
});

test('invalid JSON, missing fields, oversized text, and missing key use fallback', async () => {
  for (const output of ['not-json', { summary: '只有摘要' }, { ...validOutput, summary: '長'.repeat(81) }]) {
    const result = await explainRecommendation(recommendation(), {
      apiKey: 'test-key',
      fetcher: async () => geminiResponse(output),
    });
    assert.equal(result.status, 'fallback');
    assert.equal(result.source, 'rule');
  }

  let called = false;
  const missingKey = await explainRecommendation(recommendation(), {
    fetcher: async () => {
      called = true;
      return geminiResponse(validOutput);
    },
  });
  assert.equal(missingKey.status, 'fallback');
  assert.equal(called, false);
});

test('Gemini receives only the seven allowed recommendation fields', async () => {
  let requestBody = '';
  const sensitive = recommendation({
    rawQuery: 'token=query-secret',
    rawPostback: 'private=postback-secret',
    rawMessage: 'private message',
    password: 'password-secret',
    tenantSecret: 'other-tenant',
  });
  await explainRecommendation(sensitive, {
    apiKey: 'api-key-secret',
    fetcher: async (_url, init) => {
      requestBody = String(init.body);
      return geminiResponse(validOutput);
    },
  });

  const parsedBody = JSON.parse(requestBody);
  const prompt = JSON.parse(parsedBody.contents[0].parts[0].text);
  assert.deepEqual(Object.keys(prompt.recommendation).sort(), [
    'category', 'evidence', 'message', 'priority', 'reason', 'ruleCode', 'title',
  ]);
  for (const secret of ['query-secret', 'postback-secret', 'private message', 'password-secret', 'other-tenant', 'api-key-secret']) {
    assert.equal(requestBody.includes(secret), false);
  }
});

test('all R001-R012 recommendations use the same explanation engine', async () => {
  for (let number = 1; number <= 12; number += 1) {
    const ruleCode = `R${String(number).padStart(3, '0')}`;
    const result = await explainRecommendation(recommendation({ ruleCode }), {
      apiKey: 'test-key',
      fetcher: async () => geminiResponse(validOutput),
    });
    assert.equal(result.status, 'generated');
  }
});

test('explanation cannot mutate recommendation priority, rule code, Guide, or Workflow', async () => {
  const context = {
    workspaceId: 'workspace-a', userId: 'user-a', route: '/projects/project-a',
    page: { key: 'project_detail', title: 'Project Detail' },
    workspace: { id: 'workspace-a', name: 'A' },
    project: { id: 'project-a', name: '首頁', status: 'draft', templateId: 't', assetId: 'a', areaCount: 3 },
    selectedArea: null,
    areas: [1, 2, 3].map(id => ({ id: String(id), label: `區域 ${id}`, actionType: 'uri', uri: `https://example.com/${id}`, text: '', data: '', displayText: '', targetPageId: '' })),
    lineAccount: { exists: true, hasBotToken: true, hasBotSecret: true, webhookEnabled: true },
    completeness: { projectHasImage: true, allAreasConfigured: true, lineAccountReady: true, hasInvalidActions: false },
  };
  const guideBefore = evaluateGuide(context);
  const workflowBefore = buildGuideWorkflow(context, guideBefore);
  const item = evaluateRecommendations(context).recommendations[0];
  const itemBefore = structuredClone(item);

  await explainRecommendation(item, { apiKey: 'test-key', fetcher: async () => geminiResponse(validOutput) });

  assert.deepEqual(item, itemBefore);
  assert.equal(item.priority, itemBefore.priority);
  assert.equal(item.ruleCode, itemBefore.ruleCode);
  assert.deepEqual(evaluateGuide(context), guideBefore);
  assert.deepEqual(buildGuideWorkflow(context, guideBefore), workflowBefore);
});

test('unknown recommendation IDs resolve to null and the API contract returns 404', async () => {
  assert.equal(findRecommendationById([recommendation()], 'rec:missing'), null);
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const route = source.match(/app\.post\('\/api\/projects\/:projectId\/guide\/recommendations\/:recommendationId\/explain'[\s\S]*?\n}\);/);
  assert.ok(route);
  assert.match(route[0], /workspaceIdOf\(c\)/);
  assert.match(route[0], /evaluateRecommendations\(context\)/);
  assert.match(route[0], /findRecommendationById/);
  assert.match(route[0], /404/);
});

test('Guide context tenant isolation prevents cross-workspace project lookup', async () => {
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes('FROM projects')) {
                return values[1] === 'workspace-a'
                  ? { id: 'project-a', name: '首頁', status: 'draft', template_id: null, asset_id: null }
                  : null;
              }
              return null;
            },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const input = { db, userId: 'user-a', route: '/projects/project-a', entityType: 'project', entityId: 'project-a' };
  assert.ok(await buildGuideContext({ ...input, workspaceId: 'workspace-a' }));
  assert.equal(await buildGuideContext({ ...input, workspaceId: 'workspace-b' }), null);
});

test('frontend exposes lazy idle/loading/success/fallback/error states', async () => {
  const source = await readFile(new URL('../../frontend/src/components/RecommendationSection.jsx', import.meta.url), 'utf8');
  for (const status of ['idle', 'loading', 'success', 'fallback', 'error']) assert.match(source, new RegExp(`'${status}'`));
  assert.match(source, /onClick=\{\(\) => loadExplanation\(recommendation\)\}/);
  assert.match(source, /AI 說明/);
});
