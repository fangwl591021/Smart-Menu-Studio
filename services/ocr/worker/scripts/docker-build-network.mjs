// Match Wrangler's existing Cloudflare CI Docker-in-Docker build setting.
// This applies only to image builds; test/native OCR runtime stays offline.
export function dockerBuildNetworkArgs(env = process.env) {
  return env.WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST ? ['--network', 'host'] : [];
}
