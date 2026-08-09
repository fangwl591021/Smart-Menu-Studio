import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { funnel, rebuildJourneyDaily } from '../src/journey/core.ts';

class FakeD1 {
  constructor(events, conversions) { this.events = events; this.conversions = conversions; this.rows = []; }
  prepare(sql) {
    let args = [];
    const statement = {
      bind: (...values) => { args = values; return statement; },
      all: async () => {
        if (sql.includes('FROM line_journey_events')) return { results: this.events };
        if (sql.includes('FROM line_conversion_events')) return { results: this.conversions };
        return { results: [] };
      },
      run: async () => {
        if (sql.startsWith('DELETE FROM line_journey_daily')) {
          const [workspaceId, projectId, from, to] = args;
          this.rows = this.rows.filter((row) => !(row.workspace_id === workspaceId && row.project_id === projectId && row.metric_date >= from && row.metric_date <= to));
        }
        if (sql.startsWith('INSERT INTO line_journey_daily')) {
          const [workspace_id, project_id, project_area_id, metric_date, observed_sessions, message_actions, postback_actions, switch_actions, keyword_matches, webhook_routes, webhook_successes, webhook_failures, conversions, conversion_value_minor] = args;
          this.rows.push({ workspace_id, project_id, project_area_id, metric_date, observed_sessions, message_actions, postback_actions, switch_actions, keyword_matches, webhook_routes, webhook_successes, webhook_failures, conversions, conversion_value_minor });
        }
        return { success: true };
      },
    };
    return statement;
  }
}

const events = [
  ['message_action', 's1', 'a'], ['message_action', null, 'a'], ['postback_action', 's1', 'a'],
  ['richmenu_switch', 's2', 'b'], ['keyword_match', 's1', 'a'], ['webhook_route', 's1', 'a'],
  ['webhook_success', 's1', 'a'], ['webhook_failure', 's1', 'a'],
].map(([event_type, journey_session_id, project_area_id]) => ({ d: '2026-08-01', event_type, journey_session_id, project_area_id }));
const conversions = [
  { d: '2026-08-01', attributed_project_area_id: 'a', value_minor: 101 },
  { d: '2026-08-01', attributed_project_area_id: 'b', value_minor: 99 },
  { d: '2026-08-01', attributed_project_area_id: 'b', value_minor: 1.5 },
];

test('daily aggregation is a deterministic delete-and-recompute with safe sessions and integer money', async () => {
  const db = new FakeD1(events, conversions);
  await rebuildJourneyDaily(db, 'ws-a', 'project-a', '2026-08-01', '2026-08-01');
  const first = structuredClone(db.rows);
  await rebuildJourneyDaily(db, 'ws-a', 'project-a', '2026-08-01', '2026-08-01');
  assert.deepEqual(db.rows, first, 'rerun must replace rather than double count');
  const summary = db.rows.find((row) => row.project_area_id === '');
  const areaA = db.rows.find((row) => row.project_area_id === 'a');
  const areaB = db.rows.find((row) => row.project_area_id === 'b');
  assert.deepEqual(summary && { observed_sessions: summary.observed_sessions, message_actions: summary.message_actions, postback_actions: summary.postback_actions, switch_actions: summary.switch_actions, keyword_matches: summary.keyword_matches, webhook_routes: summary.webhook_routes, webhook_successes: summary.webhook_successes, webhook_failures: summary.webhook_failures, conversions: summary.conversions, conversion_value_minor: summary.conversion_value_minor }, { observed_sessions: 2, message_actions: 2, postback_actions: 1, switch_actions: 1, keyword_matches: 1, webhook_routes: 1, webhook_successes: 1, webhook_failures: 1, conversions: 3, conversion_value_minor: 200 });
  assert.equal(areaA.observed_sessions, 1, 'null session is excluded');
  assert.equal(areaB.observed_sessions, 1);
});

test('funnel derives counts and rates, with null for zero denominators', () => {
  const result = funnel([{ message_actions: 2, postback_actions: 1, switch_actions: 1, keyword_matches: 2, webhook_routes: 1, webhook_successes: 1, conversions: 1 }]);
  assert.deepEqual(result.funnel, { observedActions: 4, keywordMatches: 2, webhookRoutes: 1, webhookSuccesses: 1, conversions: 1 });
  assert.deepEqual(result.rates, { actionToKeyword: 0.5, keywordToWebhook: 0.5, webhookSuccessRate: 1, webhookToConversion: 1 });
  assert.deepEqual(funnel([]).rates, { actionToKeyword: null, keywordToWebhook: null, webhookSuccessRate: null, webhookToConversion: null });
});

test('journey endpoints are workspace scoped, date validated, and derive availability from active keys', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  for (const expected of [
    "app.get('/api/projects/:projectId/intelligence/journey'",
    "app.post('/api/projects/:projectId/intelligence/journey/rebuild'",
    "SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL",
    "workspace_conversion_api_keys WHERE workspace_id=? AND status='active'",
    "project_area_id='' AND metric_date>=? AND metric_date<=?",
    'INVALID_DATE_RANGE',
    'rebuildJourneyDaily(c.env.smart_menu_db, workspaceId, projectId, from, to)',
  ]) assert.ok(source.includes(expected), expected);
});

