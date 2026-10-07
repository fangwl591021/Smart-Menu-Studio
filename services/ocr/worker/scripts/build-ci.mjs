import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { dockerBuildNetworkArgs } from './docker-build-network.mjs';

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const serviceRoot = fileURLToPath(new URL('../../', import.meta.url));

export function runBuild({ spawn = spawnSync, report = console.error, env = process.env } = {}) {
  // Source validation only: no deployment, native asset download or customer file.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  report(`OCR_BUILD_NETWORK_MODE=${dockerBuildNetworkArgs(env).length ? 'cloudflare-ci-host' : 'default'}`);
  const steps = [
    [npm, ['run', 'types'], workerRoot],
    [npm, ['run', 'check'], workerRoot],
    [npm, ['test'], workerRoot],
    ['docker', ['build', ...dockerBuildNetworkArgs(env), '--platform', 'linux/amd64', '--target', 'unit-tests',
      '-t', 'smart-menu-ocr:unit-tests', '.'], serviceRoot],
  ];
  for (const [command, args, cwd] of steps) {
    const result = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) {
      report(`OCR_BUILD_FAILED: ${command}`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runBuild();
