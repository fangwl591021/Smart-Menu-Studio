import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function runPredeploy({ spawn = spawnSync, read = readFileSync,
  docker = process.env.WRANGLER_DOCKER_BIN || 'docker', report = console.error } = {}) {
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
  // Wrangler deployment is non-transactional: build and smoke-test first.
  const built = spawn(docker, ['build', '--platform', 'linux/amd64', '-t', 'smart-menu-ocr:preflight', '.'],
    { cwd: root, stdio: 'inherit', windowsHide: true });
  if (built.status !== 0) return 1;
  const smoke = spawn(docker, ['run', '--rm', '--network', 'none', '--memory', '4g', '--cpus', '0.5',
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--cap-drop', 'ALL', '--pids-limit', '64',
    '--security-opt', 'no-new-privileges', 'smart-menu-ocr:preflight', 'python', '/app/tests/native_smoke.py'],
    { stdio: 'inherit', windowsHide: true });
  return smoke.status === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runPredeploy();
