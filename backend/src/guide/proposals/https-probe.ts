export type HttpsProbeStatus = 'SAFE' | 'UNSAFE' | 'UNKNOWN';
export type HttpsProbeEligibility = 'NEEDS_PROBE' | 'SAFE' | 'UNSAFE' | 'UNKNOWN' | 'EXPIRED';

export type HttpsProbeChecks = {
  originalSchemeHttp: boolean;
  candidateSchemeHttps: boolean;
  requestCompleted: boolean;
  tlsReachable: boolean;
  finalSchemeHttps: boolean;
  sameRegistrableHost: boolean;
  redirectCountWithinLimit: boolean;
  statusAcceptable: boolean;
};

export type HttpsProbeResult = {
  status: HttpsProbeStatus;
  candidateUrl: string;
  checks: HttpsProbeChecks;
  httpStatus: number | null;
  finalUrlHost: string | null;
  redirectCount: number;
  reasonCode: string;
  originalUrlFingerprint: string;
};

export type StoredHttpsProbe = HttpsProbeResult & {
  id: string;
  workspaceId: string;
  proposalId: string;
  projectId: string;
  projectAreaId: string;
  probedByUserId: string;
  probedByName: string | null;
  probedAt: string;
  expiresAt: string;
};

export type PublicHttpsProbe = Omit<StoredHttpsProbe, 'originalUrlFingerprint'> & {
  eligibility: HttpsProbeEligibility;
};

type ProbeFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_TTL_MS = 30 * 60 * 1_000;
const MAX_REDIRECTS = 3;
const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
const recordId = (prefix: string) =>
  `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const emptyChecks = (): HttpsProbeChecks => ({
  originalSchemeHttp: false,
  candidateSchemeHttps: false,
  requestCompleted: false,
  tlsReachable: false,
  finalSchemeHttps: false,
  sameRegistrableHost: false,
  redirectCountWithinLimit: true,
  statusAcceptable: false,
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalUrl(value: string): string | null {
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export async function fingerprintUrl(value: string): Promise<string> {
  const canonical = canonicalUrl(value);
  return canonical ? sha256(canonical) : '';
}

export function sanitizeUrlForAudit(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function ipv4Octets(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const octets = hostname.split('.').map(Number);
  return octets.every(value => value >= 0 && value <= 255) ? octets : null;
}

function privateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224;
}

function hostSafetyReason(hostnameValue: string): string | null {
  const hostname = hostnameValue.toLowerCase().replace(/^\[|\]$/g, '');
  const octets = ipv4Octets(hostname);
  if (octets) return privateIpv4(octets) ? 'PRIVATE_TARGET_BLOCKED' : 'IP_LITERAL_NOT_SUPPORTED';
  if (hostname.includes(':')) {
    return hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8')
      ? 'PRIVATE_TARGET_BLOCKED'
      : 'IP_LITERAL_NOT_SUPPORTED';
  }
  if (
    !hostname.includes('.')
    || hostname === 'localhost'
    || /(?:^|\.)(?:localhost|local|internal|lan|home|intranet|test|invalid|onion)$/.test(hostname)
  ) return 'PRIVATE_TARGET_BLOCKED';
  return null;
}

export type HttpsCandidate = {
  originalUrl: string;
  candidateUrl: string;
  candidateUrlSanitized: string;
  originalHostname: string;
};

export function buildHttpsCandidate(originalUrl: string): HttpsCandidate {
  let original: URL;
  try {
    original = new URL(originalUrl);
  } catch {
    throw new Error('HTTPS_PROBE_REQUIRED');
  }
  if (original.protocol !== 'http:') throw new Error('HTTPS_PROBE_REQUIRED');
  if (original.username || original.password) throw new Error('URL_CONTAINS_CREDENTIALS');
  const hostReason = hostSafetyReason(original.hostname);
  if (hostReason) throw new Error(hostReason);
  if (original.port) throw new Error('NON_STANDARD_PORT_NOT_SUPPORTED');

  const candidate = new URL(original.toString());
  candidate.protocol = 'https:';
  candidate.port = '';
  return {
    originalUrl: original.toString(),
    candidateUrl: candidate.toString(),
    candidateUrlSanitized: sanitizeUrlForAudit(candidate.toString()),
    originalHostname: original.hostname.toLowerCase(),
  };
}

export function buildHttpRestoreUrl(currentHttpsUrl: string): string | null {
  try {
    const current = new URL(currentHttpsUrl);
    if (current.protocol !== 'https:' || current.username || current.password || current.port) return null;
    current.protocol = 'http:';
    current.port = '';
    return current.toString();
  } catch {
    return null;
  }
}

function blockedResult(
  reasonCode: string,
  checks: HttpsProbeChecks,
  originalUrlFingerprint = '',
  candidateUrl = '',
  status: HttpsProbeStatus = 'UNSAFE',
): HttpsProbeResult {
  return {
    status,
    candidateUrl,
    checks,
    httpStatus: null,
    finalUrlHost: null,
    redirectCount: 0,
    reasonCode,
    originalUrlFingerprint,
  };
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The probe never consumes response content. Cancellation is best-effort only.
  }
}

export async function probeHttpsUpgradeCandidate(input: {
  originalUrl: string;
  fetcher?: ProbeFetcher;
  timeoutMs?: number;
  maxRedirects?: number;
}): Promise<HttpsProbeResult> {
  const checks = emptyChecks();
  const fingerprint = await fingerprintUrl(input.originalUrl);
  let candidate: HttpsCandidate;
  try {
    candidate = buildHttpsCandidate(input.originalUrl);
    checks.originalSchemeHttp = true;
    checks.candidateSchemeHttps = true;
  } catch (error) {
    return blockedResult(clean((error as Error).message) || 'HTTPS_PROBE_REQUIRED', checks, fingerprint);
  }

  const fetcher = input.fetcher || fetch;
  const timeoutMs = Math.min(8_000, Math.max(1, input.timeoutMs || PROBE_TIMEOUT_MS));
  const maxRedirects = Math.min(5, Math.max(0, input.maxRedirects ?? MAX_REDIRECTS));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('PROBE_TIMEOUT'), timeoutMs);
  let current = new URL(candidate.candidateUrl);
  let redirectCount = 0;
  let httpStatus: number | null = null;

  try {
    while (true) {
      const response = await fetcher(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'Smart-Menu-Studio-HTTPS-Probe/1.0' },
      });
      checks.requestCompleted = true;
      checks.tlsReachable = current.protocol === 'https:';
      httpStatus = response.status;

      const location = response.headers.get('Location');
      if (response.status >= 300 && response.status <= 399 && location) {
        await cancelBody(response);
        if (redirectCount >= maxRedirects) {
          checks.redirectCountWithinLimit = false;
          return {
            ...blockedResult('HTTPS_REDIRECT_LIMIT_EXCEEDED', checks, fingerprint, candidate.candidateUrlSanitized, 'UNKNOWN'),
            httpStatus,
            finalUrlHost: current.hostname,
            redirectCount,
          };
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return {
            ...blockedResult('HTTPS_REDIRECT_INVALID', checks, fingerprint, candidate.candidateUrlSanitized, 'UNKNOWN'),
            httpStatus,
            finalUrlHost: current.hostname,
            redirectCount,
          };
        }
        if (next.protocol !== 'https:') {
          return {
            ...blockedResult('HTTPS_REDIRECT_DOWNGRADE', checks, fingerprint, candidate.candidateUrlSanitized),
            httpStatus,
            finalUrlHost: next.hostname || null,
            redirectCount: redirectCount + 1,
          };
        }
        if (next.username || next.password) {
          return blockedResult('URL_CONTAINS_CREDENTIALS', checks, fingerprint, candidate.candidateUrlSanitized);
        }
        const nextHostReason = hostSafetyReason(next.hostname);
        if (nextHostReason) return blockedResult(nextHostReason, checks, fingerprint, candidate.candidateUrlSanitized);
        if (next.port) return blockedResult('NON_STANDARD_PORT_NOT_SUPPORTED', checks, fingerprint, candidate.candidateUrlSanitized);
        if (next.hostname.toLowerCase() !== candidate.originalHostname) {
          return {
            ...blockedResult('HTTPS_REDIRECT_HOST_CHANGED', checks, fingerprint, candidate.candidateUrlSanitized),
            httpStatus,
            finalUrlHost: next.hostname,
            redirectCount: redirectCount + 1,
          };
        }
        redirectCount += 1;
        current = next;
        continue;
      }

      await cancelBody(response);
      checks.finalSchemeHttps = current.protocol === 'https:';
      checks.sameRegistrableHost = current.hostname.toLowerCase() === candidate.originalHostname;
      checks.redirectCountWithinLimit = redirectCount <= maxRedirects;
      checks.statusAcceptable = response.status >= 200 && response.status <= 399;
      const common = {
        candidateUrl: candidate.candidateUrlSanitized,
        checks,
        httpStatus,
        finalUrlHost: current.hostname,
        redirectCount,
        originalUrlFingerprint: fingerprint,
      };
      if ([401, 403].includes(response.status)) {
        return { ...common, status: 'UNKNOWN', reasonCode: 'HTTPS_STATUS_RESTRICTED' };
      }
      if (
        checks.tlsReachable
        && checks.finalSchemeHttps
        && checks.sameRegistrableHost
        && checks.redirectCountWithinLimit
        && checks.statusAcceptable
      ) return { ...common, status: 'SAFE', reasonCode: 'HTTPS_REACHABLE' };
      return { ...common, status: 'UNKNOWN', reasonCode: 'HTTPS_STATUS_NOT_ACCEPTABLE' };
    }
  } catch {
    return {
      ...blockedResult(
        controller.signal.aborted ? 'PROBE_TIMEOUT' : 'HTTPS_FETCH_FAILED',
        checks,
        fingerprint,
        candidate.candidateUrlSanitized,
        'UNKNOWN',
      ),
      redirectCount,
      httpStatus,
      finalUrlHost: current.hostname || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function checksFromJson(value: unknown): HttpsProbeChecks {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const source = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const defaults = emptyChecks();
    return Object.fromEntries(
      Object.keys(defaults).map(key => [key, source[key] === true]),
    ) as HttpsProbeChecks;
  } catch {
    return emptyChecks();
  }
}

function fromRow(row: Record<string, unknown> | null): StoredHttpsProbe | null {
  if (!row) return null;
  return {
    id: clean(row.id),
    workspaceId: clean(row.workspace_id),
    proposalId: clean(row.proposal_id),
    projectId: clean(row.project_id),
    projectAreaId: clean(row.project_area_id),
    status: clean(row.status) as HttpsProbeStatus,
    candidateUrl: clean(row.candidate_url_sanitized),
    checks: checksFromJson(row.checks_json),
    httpStatus: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
    finalUrlHost: clean(row.final_host) || null,
    redirectCount: Number(row.redirect_count || 0),
    reasonCode: clean(row.reason_code),
    originalUrlFingerprint: clean(row.original_url_fingerprint),
    probedByUserId: clean(row.probed_by_user_id),
    probedByName: clean(row.probed_by_name) || null,
    probedAt: clean(row.probed_at),
    expiresAt: clean(row.expires_at),
  };
}

export async function saveHttpsProbeResult(db: D1Database, input: {
  workspaceId: string;
  proposalId: string;
  projectId: string;
  projectAreaId: string;
  actorUserId: string;
  result: HttpsProbeResult;
  now?: Date;
}): Promise<StoredHttpsProbe> {
  const id = recordId('aihp');
  const probedAt = (input.now || new Date()).toISOString();
  const expiresAt = new Date(Date.parse(probedAt) + PROBE_TTL_MS).toISOString();
  await db.prepare(`
    INSERT INTO ai_https_probe_results (
      id, workspace_id, proposal_id, project_id, project_area_id,
      original_url_fingerprint, candidate_url_sanitized, status, reason_code,
      checks_json, http_status, final_host, redirect_count,
      probed_by_user_id, probed_at, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.workspaceId,
    input.proposalId,
    input.projectId,
    input.projectAreaId,
    input.result.originalUrlFingerprint,
    input.result.candidateUrl,
    input.result.status,
    input.result.reasonCode,
    JSON.stringify(input.result.checks),
    input.result.httpStatus,
    input.result.finalUrlHost,
    input.result.redirectCount,
    input.actorUserId,
    probedAt,
    expiresAt,
    probedAt,
  ).run();
  const saved = await getHttpsProbeById(db, input.workspaceId, input.projectId, input.proposalId, id);
  if (!saved) throw new Error('HTTPS_PROBE_PERSISTENCE_FAILED');
  return saved;
}

export async function getHttpsProbeById(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  proposalId: string,
  probeId: string,
): Promise<StoredHttpsProbe | null> {
  const row = await db.prepare(`
    SELECT probe.*, actor.display_name AS probed_by_name
    FROM ai_https_probe_results probe
    LEFT JOIN users actor ON actor.id = probe.probed_by_user_id
    WHERE probe.id = ? AND probe.workspace_id = ? AND probe.project_id = ? AND probe.proposal_id = ?
    LIMIT 1
  `).bind(probeId, workspaceId, projectId, proposalId).first<Record<string, unknown>>();
  return fromRow(row);
}

export async function getLatestHttpsProbe(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  proposalId: string,
  projectAreaId?: string | null,
): Promise<StoredHttpsProbe | null> {
  const row = await db.prepare(`
    SELECT probe.*, actor.display_name AS probed_by_name
    FROM ai_https_probe_results probe
    LEFT JOIN users actor ON actor.id = probe.probed_by_user_id
    WHERE probe.workspace_id = ? AND probe.project_id = ? AND probe.proposal_id = ?
      AND (? IS NULL OR probe.project_area_id = ?)
    ORDER BY probe.probed_at DESC, probe.id DESC
    LIMIT 1
  `).bind(workspaceId, projectId, proposalId, projectAreaId || null, projectAreaId || null)
    .first<Record<string, unknown>>();
  return fromRow(row);
}

export async function httpsProbeEligibility(
  probe: StoredHttpsProbe | null,
  currentUrl: string,
  now = new Date(),
): Promise<HttpsProbeEligibility> {
  if (!probe) return 'NEEDS_PROBE';
  if (Date.parse(probe.expiresAt) <= now.getTime()) return 'EXPIRED';
  if (!probe.originalUrlFingerprint || probe.originalUrlFingerprint !== await fingerprintUrl(currentUrl)) {
    return 'NEEDS_PROBE';
  }
  if (probe.status === 'SAFE') return 'SAFE';
  if (probe.status === 'UNSAFE') return 'UNSAFE';
  return 'UNKNOWN';
}

export async function toPublicHttpsProbe(
  probe: StoredHttpsProbe,
  currentUrl: string,
  now = new Date(),
): Promise<PublicHttpsProbe> {
  const { originalUrlFingerprint: _privateFingerprint, ...safe } = probe;
  return { ...safe, eligibility: await httpsProbeEligibility(probe, currentUrl, now) };
}
