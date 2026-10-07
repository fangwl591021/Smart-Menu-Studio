// Cloudflare's nested CI daemon may not expose inner cgroup controllers.
// The outer Workers Builds job still controls resources. Never infer support
// from a failed run or relax network/read-only/capability isolation here.
export function dockerRuntimeLimitArgs({ env, spawn, report, memory, cpus, docker = 'docker' }) {
  if (!env.WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST)
    return ['--memory', memory, '--cpus', cpus, '--pids-limit', '64'];
  // Ask for explicit false values: Docker's whole-info JSON may omit them.
  const result = spawn(docker, ['info', '--format', '{{.MemoryLimit}}|{{.CPUCfsQuota}}|{{.PidsLimit}}'],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  const flags = typeof result.stdout === 'string' && result.stdout.trim();
  if (result.status !== 0 || !/^(true|false)\|(true|false)\|(true|false)$/.test(flags)) return null;
  const [MemoryLimit, CPUCfsQuota, PidsLimit] = flags.split('|').map(flag => flag === 'true');
  const capabilities = { MemoryLimit, CPUCfsQuota, PidsLimit };
  report(`OCR_CI_INNER_LIMITS: memory=${capabilities.MemoryLimit}, cpu=${capabilities.CPUCfsQuota}, pids=${capabilities.PidsLimit}; outer job limits remain.`);
  return [
    ...(capabilities.MemoryLimit ? ['--memory', memory] : []),
    ...(capabilities.CPUCfsQuota ? ['--cpus', cpus] : []),
    ...(capabilities.PidsLimit ? ['--pids-limit', '64'] : []),
  ];
}
