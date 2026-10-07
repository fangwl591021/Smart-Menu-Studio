import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPredeploy } from '../scripts/predeploy.mjs';
import { runBuild } from '../scripts/build-ci.mjs';
import bootstrap from '../src/bootstrap.ts';
import { dockerBuildNetworkArgs } from '../scripts/docker-build-network.mjs';

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

test('predeploy image build failure stops; native validation occurs inside the build', () => {
  for (const failAt of [1, -1]) {
    const calls = [];
    const result = runPredeploy({ env: {}, read: reviewed, report: quiet, spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: calls.length - 1 === failAt ? 1 : 0, stdout: 'linux\n' };
    } });
    assert.equal(result, failAt === -1 ? 0 : 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args[0], 'build');
    assert.ok(calls.every(call => call.command === 'docker'));
  }
});

test('CI source checks never run deploy, native assets or production tests', () => {
  const calls = [];
  assert.equal(runBuild({ env: {}, report: quiet, spawn: (command, args, options) => {
    calls.push({ command, args, options }); return { status: 0 };
  } }), 0);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.slice(0, 3).map(call => call.args), [['run', 'types'], ['run', 'check'], ['test']]);
  assert.ok(calls[3].args.includes('unit-tests'));
  assert.ok(calls.every(call => !call.args.includes('deploy') && !call.args.includes('preflight')
    && !(call.command === 'docker' && call.args[0] === 'run')));
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

test('Cloudflare CI network override applies to builds; no unsupported docker run', () => {
  assert.deepEqual(dockerBuildNetworkArgs({}), []);
  assert.deepEqual(dockerBuildNetworkArgs({ WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST: 'true' }), ['--network', 'host']);
  const env = { WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST: 'true' };
  const calls = [];
  assert.equal(runBuild({ env, report: quiet, spawn: (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: 'true|false|true\n' };
  } }), 0);
  assert.deepEqual(calls[3].args.slice(0, 3), ['build', '--network', 'host']);
  assert.equal(calls.length, 4);
  const nativeCalls = [];
  assert.equal(runPredeploy({ env, read: reviewed, report: quiet, spawn: (command, args) => {
    nativeCalls.push({ command, args });
    return { status: 0, stdout: 'linux\n' };
  } }), 0);
  assert.deepEqual(nativeCalls[1].args.slice(0, 3), ['build', '--network', 'host']);
  assert.equal(nativeCalls.length, 2);
});

test('Python unit and native smoke checks are non-root offline image build steps', () => {
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const unitStage = dockerfile.split(' AS unit-tests')[1].split(' AS assets')[0];
  assert.match(unitStage, /USER 10001:10001\s+RUN --network=none python -m unittest discover -s tests -v/);
  assert.match(dockerfile, /USER 10001:10001\s+RUN --network=none python \/app\/tests\/native_smoke\.py/);
  assert.match(dockerfile, /PYTHONPATH=\/app/);
  assert.ok(!dockerfile.includes('--privileged'));
});
