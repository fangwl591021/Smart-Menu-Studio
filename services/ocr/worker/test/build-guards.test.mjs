import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPredeploy } from '../scripts/predeploy.mjs';
import { runBuild } from '../scripts/build-ci.mjs';
import bootstrap from '../src/bootstrap.ts';

const reviewed = () => JSON.stringify({ nativeThirdPartyNoticesReviewed: true });
const quiet = () => {};

test('unreviewed native notices block before Docker or any deployment', () => {
  let calls = 0;
  assert.equal(runPredeploy({ read: () => '{"nativeThirdPartyNoticesReviewed":false}',
    spawn: () => { calls++; }, report: quiet }), 1);
  assert.equal(calls, 0);
});

test('missing, stopped or non-Linux Docker blocks image build', () => {
  for (const result of [{ status: null }, { status: 1, stdout: '' }, { status: 0, stdout: 'windows' }]) {
    let calls = 0;
    assert.equal(runPredeploy({ read: reviewed, spawn: () => { calls++; return result; }, report: quiet }), 1);
    assert.equal(calls, 1);
  }
});

test('predeploy build and smoke failures stop; smoke is offline and nonprivileged', () => {
  for (const failAt of [1, 2, -1]) {
    const calls = [];
    const result = runPredeploy({ read: reviewed, report: quiet, spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: calls.length - 1 === failAt ? 1 : 0, stdout: 'linux\n' };
    } });
    assert.equal(result, failAt === -1 ? 0 : 1);
    assert.equal(calls.length, failAt === 1 ? 2 : 3);
    if (calls.length === 3) {
      const args = calls[2].args;
      assert.equal(args[args.indexOf('--network') + 1], 'none');
      assert.ok(args.includes('--read-only'));
      assert.ok(args.includes('no-new-privileges'));
    }
    assert.ok(calls.every(call => call.command === 'docker'));
  }
});

test('CI source checks never run deploy, native assets or production tests', () => {
  const calls = [];
  assert.equal(runBuild({ report: quiet, spawn: (command, args, options) => {
    calls.push({ command, args, options }); return { status: 0 };
  } }), 0);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.slice(0, 3).map(call => call.args), [['run', 'types'], ['run', 'check'], ['test']]);
  assert.ok(calls[3].args.includes('unit-tests'));
  assert.ok(calls[4].args.includes('none'));
  assert.ok(calls.every(call => !call.args.includes('deploy') && !call.args.includes('preflight')));
  assert.equal(runBuild({ report: quiet, spawn: () => ({ status: 1 }) }), 1);
});

test('bootstrap is private, closed and has no resources or secrets', async () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.bootstrap.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'smart-menu-ocr');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  for (const key of ['services', 'containers', 'durable_objects', 'd1_databases', 'r2_buckets', 'vars'])
    assert.equal(config[key], undefined);
  assert.equal(bootstrap.fetch().status, 404);
});
