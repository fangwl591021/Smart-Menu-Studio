import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPredeploy } from '../scripts/predeploy.mjs';
import { runBuild } from '../scripts/build-ci.mjs';
import bootstrap from '../src/bootstrap.ts';
import { dockerBuildNetworkArgs } from '../scripts/docker-build-network.mjs';
import { dockerRuntimeLimitArgs } from '../scripts/docker-runtime-limits.mjs';

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
    const result = runPredeploy({ env: {}, read: reviewed, report: quiet, spawn: (command, args, options) => {
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
  assert.equal(runBuild({ env: {}, report: quiet, spawn: (command, args, options) => {
    calls.push({ command, args, options }); return { status: 0 };
  } }), 0);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.slice(0, 3).map(call => call.args), [['run', 'types'], ['run', 'check'], ['test']]);
  assert.ok(calls[3].args.includes('unit-tests'));
  assert.ok(calls[4].args.includes('none'));
  assert.ok(calls.every(call => !call.args.includes('deploy') && !call.args.includes('preflight')));
  assert.equal(runBuild({ env: {}, report: quiet, spawn: () => ({ status: 1 }) }), 1);
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

test('Cloudflare CI network override applies to builds only, never test/native runtime', () => {
  assert.deepEqual(dockerBuildNetworkArgs({}), []);
  assert.deepEqual(dockerBuildNetworkArgs({ WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST: 'true' }), ['--network', 'host']);
  const env = { WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST: 'true' };
  const calls = [];
  assert.equal(runBuild({ env, report: quiet, spawn: (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: 'true|false|true\n' };
  } }), 0);
  assert.deepEqual(calls[4].args.slice(0, 3), ['build', '--network', 'host']);
  assert.equal(calls[5].args[calls[5].args.indexOf('--network') + 1], 'none');
  assert.ok(!calls[5].args.includes('--cpus'));
  assert.ok(calls[5].args.includes('--memory'));
  const nativeCalls = [];
  assert.equal(runPredeploy({ env, read: reviewed, report: quiet, spawn: (command, args) => {
    nativeCalls.push({ command, args });
    return { status: 0, stdout: args[1] === '--format' && args[2].includes('MemoryLimit')
      ? 'true|false|true\n' : 'linux\n' };
  } }), 0);
  assert.deepEqual(nativeCalls[2].args.slice(0, 3), ['build', '--network', 'host']);
  assert.equal(nativeCalls[3].args[nativeCalls[3].args.indexOf('--network') + 1], 'none');
});

test('CI controller capabilities are explicit; unknown or failed probe blocks', () => {
  const env = { WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST: 'true' };
  assert.deepEqual(dockerRuntimeLimitArgs({ env: {}, spawn: () => { throw new Error('unexpected probe'); },
    report: quiet, memory: '1g', cpus: '1' }), ['--memory', '1g', '--cpus', '1', '--pids-limit', '64']);
  assert.deepEqual(dockerRuntimeLimitArgs({ env, spawn: () => ({ status: 0, stdout: 'false|false|false\n' }),
    report: quiet, memory: '1g', cpus: '1' }), []);
  for (const result of [{ status: 1, stdout: '' }, { status: 0, stdout: 'invalid' }, { status: 0, stdout: '{}' }]) {
    const spawn = () => result;
    assert.equal(dockerRuntimeLimitArgs({ env, spawn, report: quiet, memory: '1g', cpus: '1' }), null);
    assert.equal(runBuild({ env, spawn, report: quiet }), 1);
    let nativeProbeCalls = 0;
    assert.equal(runPredeploy({ env, read: reviewed, spawn: () => {
      nativeProbeCalls++;
      return nativeProbeCalls === 1 ? { status: 0, stdout: 'linux\n' } : result;
    }, report: quiet }), 1);
    assert.equal(nativeProbeCalls, 2);
  }
});
