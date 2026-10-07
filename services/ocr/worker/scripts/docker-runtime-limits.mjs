// Cloudflare's nested CI daemon may not expose inner cgroup controllers.
// The outer Workers Builds job still controls resources. Never infer support
// from a failed run or relax network/read-only/capability isolation here.
export function dockerRuntimeLimitArgs({ env, spawn, report, memory, cpus, docker = 'docker' }) {
  if (!env.WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST)
    return ['--memory', memory, '--cpus', cpus, '--pids-limit', '64'];
  const result = spawn(docker, ['info', '--format', '{{json .}}'],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  let capabilities;
  try { capabilities = JSON.parse(result.stdout); } catch { return null; }
  if (result.status !== 0 || ['MemoryLimit', 'CPUCfsQuota', 'PidsLimit']
    .some(key => typeof capabilities[key] !== 'boolean')) return null;
  report(`OCR_CI_INNER_LIMITS: memory=${capabilities.MemoryLimit}, cpu=${capabilities.CPUCfsQuota}, pids=${capabilities.PidsLimit}; outer job limits remain.`);
  return [
    ...(capabilities.MemoryLimit ? ['--memory', memory] : []),
    ...(capabilities.CPUCfsQuota ? ['--cpus', cpus] : []),
    ...(capabilities.PidsLimit ? ['--pids-limit', '64'] : []),
  ];
}
