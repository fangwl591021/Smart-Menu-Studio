import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CAMPAIGN_DELIVERY_MAX_ATTEMPTS,
  campaignDeliveryCanResume,
  campaignExecutionRetryAuthority,
} from '../src/campaign/executions.ts';

const executionSource = await readFile(
  fileURLToPath(new URL('../src/campaign/executions.ts', import.meta.url)),
  'utf8',
);
const atMs = Date.parse('2026-08-11T12:00:00.000Z');
const recent = '2026-08-11T11:00:00.000Z';
const old = '2026-08-10T11:00:00.000Z';
const delivery = (overrides = {}) => ({
  status: 'FAILED',
  attempt_count: 1,
  retryable: 1,
  created_at: recent,
  ...overrides,
});
const authority = (executionStatus, deliveries, campaignStatus = 'PREPARED') => campaignExecutionRetryAuthority({
  executionStatus,
  campaignStatus,
  deliveries,
  atMs,
});

test('retryable FAILED delivery enables resume', () => {
  assert.deepEqual(authority('FAILED', [delivery()]), { canResume: true, retryableRemaining: 1 });
});

test('retryableRemaining counts logical recipients, not attempts', () => {
  assert.deepEqual(authority('PARTIAL_FAILED', [
    delivery({ attempt_count: 1 }),
    delivery({ attempt_count: 2 }),
  ]), { canResume: true, retryableRemaining: 2 });
});

test('SENT-only execution cannot resume', () => {
  assert.deepEqual(authority('COMPLETED', [delivery({ status: 'SENT', retryable: 0 })]), { canResume: false, retryableRemaining: 0 });
});

test('permanently FAILED delivery cannot resume', () => {
  assert.deepEqual(authority('FAILED', [delivery({ retryable: 0 })]), { canResume: false, retryableRemaining: 0 });
});

test('retryable failure at maximum attempts cannot resume', () => {
  const exhausted = delivery({ attempt_count: CAMPAIGN_DELIVERY_MAX_ATTEMPTS });
  assert.equal(campaignDeliveryCanResume(exhausted, atMs), false);
  assert.deepEqual(authority('FAILED', [exhausted]), { canResume: false, retryableRemaining: 0 });
});

test('CANCELLED is blocked while RUNNING follows current recovery policy', () => {
  assert.deepEqual(authority('CANCELLED', [delivery()]), { canResume: false, retryableRemaining: 0 });
  assert.deepEqual(authority('RUNNING', [delivery()]), { canResume: true, retryableRemaining: 1 });
});

test('recent uncertain SENDING follows existing recovery semantics', () => {
  assert.deepEqual(authority('FAILED', [delivery({ status: 'SENDING', retryable: 0 })]), { canResume: true, retryableRemaining: 1 });
  assert.equal(campaignDeliveryCanResume(delivery({ status: 'SENDING', created_at: old }), atMs), false);
});

test('mixed SENT and retryable FAILED counts only retryable recipient', () => {
  assert.deepEqual(authority('PARTIAL_FAILED', [
    delivery({ status: 'SENT', retryable: 0 }),
    delivery(),
  ]), { canResume: true, retryableRemaining: 1 });
});

test('read authority is pure and does not mutate attempts', () => {
  const row = delivery({ attempt_count: 2 });
  const before = structuredClone(row);
  authority('FAILED', [row]);
  assert.deepEqual(row, before);
});

test('read projection and resume mutation share the same authority', () => {
  assert.match(executionSource, /projectExecutions[\s\S]*campaignExecutionRetryAuthority/);
  assert.match(executionSource, /resumeWorkRows[\s\S]*campaignExecutionRetryAuthority/);
  assert.match(executionSource, /resumeCampaignExecution[\s\S]*resumeWorkRows/);
  assert.match(executionSource, /CAMPAIGN_EXECUTION_NOT_RESUMABLE/);
});

test('execution read contract exposes only minimal retry authority', () => {
  const projection = executionSource.match(/function publicExecution[\s\S]*?(?=\nasync function executionRowByAction)/)?.[0] || '';
  assert.match(projection, /canResume: authority\.canResume/);
  assert.match(projection, /retryableRemaining: authority\.retryableRemaining/);
  assert.doesNotMatch(projection, /provider_retry_key|provider_request_hash|provider_recipient_id/);
});

test('retry authority exposes no provider or identity internals', () => {
  const safe = JSON.stringify(authority('FAILED', [delivery()]));
  assert.doesNotMatch(safe, /retry.?key|provider|request.?hash|line.?uid|identity|execution_id|delivery_id/i);
});

test('archived campaign cannot advertise resume capability', () => {
  assert.deepEqual(authority('FAILED', [delivery()], 'ARCHIVED'), { canResume: false, retryableRemaining: 0 });
});
