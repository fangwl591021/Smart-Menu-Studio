import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { dockerBuildNetworkArgs } from './docker-build-network.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function runPredeploy({ spawn = spawnSync, read = readFileSync,
  docker = process.env.WRANGLER_DOCKER_BIN || 'docker', report = console.error, env = process.env } = {}) {
  // An incomplete notice review cannot publish an image or activate native OCR.
  const manifest = JSON.parse(read(new URL('../../native-artifacts.json', import.meta.url), 'utf8'));
  if (manifest.nativeThirdPartyNoticesReviewed !== true) {
    report('OCR_DEPLOY_BLOCKED: native third-party redistribution notices must be reviewed before publishing.');
    return 1;
  }
  const checked = spawn(docker, ['info', '--format', '{{.OSType}}'],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (checked.status !== 0 || checked.stdout?.trim() !== 'linux') {
    report('OCR_DEPLOY_BLOCKED: a working Linux Docker engine is required. No deployment was started.');
    return 1;
  }
  // Wrangler deployment is non-transactional. The final Docker build stage runs
  // the real native smoke test as non-root with RUN --network=none before publish.
  // Workers Builds supports building images, not inner docker run/cgroup setup.
  const built = spawn(docker, ['build', ...dockerBuildNetworkArgs(env), '--platform', 'linux/amd64', '-t', 'smart-menu-ocr:preflight', '.'],
    { cwd: root, stdio: 'inherit', windowsHide: true });
  return built.status === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runPredeploy();
