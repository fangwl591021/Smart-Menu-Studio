export const AI_FEATURE_CODES = Object.freeze([
  'recommendation_explanation',
  'behavior_recommendation_explanation',
  'proposal_explanation',
  'rich_menu_image_analysis',
  'guide_explanation',
  'operation_plan_assist',
  'line_oa_intelligence',
  'content_generation',
  'unknown_ai_feature',
] as const);

export type AiFeatureCode = typeof AI_FEATURE_CODES[number];
export type AiUsageStatus = 'success' | 'failed' | 'fallback' | 'cached';

export type AiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
};

export type MeteredAiExecution<T> = {
  value: T;
  status: AiUsageStatus;
  usage?: Partial<AiTokenUsage>;
  providerRequestId?: string | null;
  errorCode?: string | null;
};

export type AiPricingSnapshot = {
  id: string;
  version: string;
  inputPrice: number;
  outputPrice: number;
  cachedInputPrice: number;
  billableInputPrice: number;
  billableOutputPrice: number;
  billableCachedInputPrice: number;
};

const clean = (value: unknown, maximum = 120) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, maximum);

const nonNegativeInteger = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

export function normalizeAiUsage(value?: Partial<AiTokenUsage>): AiTokenUsage {
  const inputTokens = nonNegativeInteger(value?.inputTokens);
  const outputTokens = nonNegativeInteger(value?.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: nonNegativeInteger(value?.totalTokens) || inputTokens + outputTokens,
    cachedInputTokens: nonNegativeInteger(value?.cachedInputTokens),
    reasoningTokens: nonNegativeInteger(value?.reasoningTokens),
  };
}

export function extractGeminiUsageMetadata(payload: unknown): Partial<AiTokenUsage> {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const usage = root.usageMetadata && typeof root.usageMetadata === 'object'
    ? root.usageMetadata as Record<string, unknown>
    : {};
  const candidates = nonNegativeInteger(usage.candidatesTokenCount);
  const thoughts = nonNegativeInteger(usage.thoughtsTokenCount);
  return {
    inputTokens: nonNegativeInteger(usage.promptTokenCount),
    outputTokens: candidates,
    totalTokens: nonNegativeInteger(usage.totalTokenCount),
    cachedInputTokens: nonNegativeInteger(usage.cachedContentTokenCount),
    reasoningTokens: thoughts,
  };
}

export function calculateCostMicros(
  usage: AiTokenUsage,
  prices: { input: number; output: number; cachedInput: number },
): number {
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const numerator = BigInt(uncachedInput) * BigInt(nonNegativeInteger(prices.input))
    + BigInt(usage.outputTokens) * BigInt(nonNegativeInteger(prices.output))
    + BigInt(usage.cachedInputTokens) * BigInt(nonNegativeInteger(prices.cachedInput));
  return Number((numerator + 500000n) / 1000000n);
}

async function activePricing(
  db: D1Database,
  provider: string,
  model: string,
  at: string,
): Promise<AiPricingSnapshot | null> {
  const row = await db.prepare(`
    SELECT id, version,
      input_price_micros_per_million, output_price_micros_per_million,
      cached_input_price_micros_per_million,
      billable_input_price_micros_per_million, billable_output_price_micros_per_million,
      billable_cached_input_price_micros_per_million
    FROM ai_pricing_versions
    WHERE provider = ? AND model = ? AND enabled = 1
      AND datetime(effective_from) <= datetime(?)
      AND (effective_to IS NULL OR datetime(effective_to) > datetime(?))
    ORDER BY datetime(effective_from) DESC, created_at DESC
    LIMIT 1
  `).bind(provider, model, at, at).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: clean(row.id),
    version: clean(row.version),
    inputPrice: nonNegativeInteger(row.input_price_micros_per_million),
    outputPrice: nonNegativeInteger(row.output_price_micros_per_million),
    cachedInputPrice: nonNegativeInteger(row.cached_input_price_micros_per_million),
    billableInputPrice: nonNegativeInteger(row.billable_input_price_micros_per_million),
    billableOutputPrice: nonNegativeInteger(row.billable_output_price_micros_per_million),
    billableCachedInputPrice: nonNegativeInteger(row.billable_cached_input_price_micros_per_million),
  };
}

export async function executeMeteredAiCall<T>(input: {
  db: D1Database;
  workspaceId: string;
  userId?: string | null;
  featureCode: AiFeatureCode;
  operationCode?: string | null;
  provider: string;
  model: string;
  execute: () => Promise<MeteredAiExecution<T>>;
  now?: () => Date;
  createId?: () => string;
  logger?: (event: Record<string, unknown>) => void;
}): Promise<T> {
  const started = Date.now();
  const at = (input.now || (() => new Date()))().toISOString();
  let execution: MeteredAiExecution<T>;
  try {
    execution = await input.execute();
  } catch (error) {
    execution = {
      value: undefined as T,
      status: 'failed',
      errorCode: clean((error as { code?: unknown; name?: unknown })?.code
        || (error as { name?: unknown })?.name || 'AI_CALL_FAILED'),
    };
    await writeUsageSafely(input, execution, at, Date.now() - started);
    throw error;
  }
  await writeUsageSafely(input, execution, at, Date.now() - started);
  return execution.value;
}

async function writeUsageSafely<T>(
  input: Parameters<typeof executeMeteredAiCall<T>>[0],
  execution: MeteredAiExecution<T>,
  at: string,
  latencyMs: number,
): Promise<void> {
  try {
    const provider = clean(input.provider, 60);
    const model = clean(input.model, 120);
    const usage = normalizeAiUsage(execution.usage);
    const pricing = await activePricing(input.db, provider, model, at);
    const providerCost = execution.status === 'cached' || !pricing ? 0 : calculateCostMicros(usage, {
      input: pricing.inputPrice,
      output: pricing.outputPrice,
      cachedInput: pricing.cachedInputPrice,
    });
    const billableCost = ['failed', 'fallback', 'cached'].includes(execution.status) || !pricing ? 0 : calculateCostMicros(usage, {
      input: pricing.billableInputPrice,
      output: pricing.billableOutputPrice,
      cachedInput: pricing.billableCachedInputPrice,
    });
    const usageId = input.createId?.()
      || `aiu_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await input.db.prepare(`
      INSERT INTO ai_usage_ledger (
        id, workspace_id, user_id, feature_code, operation_code, provider, model,
        provider_request_id, status, input_tokens, output_tokens, total_tokens,
        cached_input_tokens, reasoning_tokens, provider_cost_micros,
        billable_cost_micros, currency, input_unit_price_snapshot,
        output_unit_price_snapshot, cached_unit_price_snapshot,
        billable_input_unit_price_snapshot, billable_output_unit_price_snapshot,
        billable_cached_unit_price_snapshot, pricing_version, latency_ms,
        error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      usageId, clean(input.workspaceId), clean(input.userId) || null,
      AI_FEATURE_CODES.includes(input.featureCode) ? input.featureCode : 'unknown_ai_feature',
      clean(input.operationCode) || null, provider, model,
      clean(execution.providerRequestId) || null, execution.status,
      usage.inputTokens, usage.outputTokens, usage.totalTokens,
      usage.cachedInputTokens, usage.reasoningTokens, providerCost, billableCost,
      pricing ? String(pricing.inputPrice) : null,
      pricing ? String(pricing.outputPrice) : null,
      pricing ? String(pricing.cachedInputPrice) : null,
      pricing ? String(pricing.billableInputPrice) : null,
      pricing ? String(pricing.billableOutputPrice) : null,
      pricing ? String(pricing.billableCachedInputPrice) : null,
      pricing?.version || null, Math.max(0, Math.floor(latencyMs)),
      clean(execution.errorCode) || null, at,
    ).run();
  } catch (error) {
    input.logger?.({ message: 'ai usage metering write failed', featureCode: input.featureCode });
    console.error(JSON.stringify({ message: 'ai usage metering write failed', featureCode: input.featureCode }));
  }
}

export type AiUsageSummary = {
  period: { from: string; to: string };
  scope: 'workspace' | 'self' | 'system';
  total: Record<string, number>;
  byUser: Array<Record<string, unknown>>;
  byFeature: Array<Record<string, unknown>>;
  byModel: Array<Record<string, unknown>>;
  byWorkspace?: Array<Record<string, unknown>>;
};

const aggregateColumns = `
  COUNT(*) AS requests,
  COALESCE(SUM(input_tokens), 0) AS input_tokens,
  COALESCE(SUM(output_tokens), 0) AS output_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(provider_cost_micros), 0) AS provider_cost_micros,
  COALESCE(SUM(billable_cost_micros), 0) AS billable_cost_micros,
  COALESCE(SUM(billable_cost_micros - provider_cost_micros), 0) AS estimated_margin_micros
`;

const numericAggregate = (row: Record<string, unknown> | null) => ({
  requests: nonNegativeInteger(row?.requests),
  inputTokens: nonNegativeInteger(row?.input_tokens),
  outputTokens: nonNegativeInteger(row?.output_tokens),
  totalTokens: nonNegativeInteger(row?.total_tokens),
  providerCostMicros: nonNegativeInteger(row?.provider_cost_micros),
  billableCostMicros: nonNegativeInteger(row?.billable_cost_micros),
  estimatedMarginMicros: Number(row?.estimated_margin_micros || 0),
});

export function normalizeUsagePeriod(fromValue: unknown, toValue: unknown, now = new Date()): { from: string; to: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const parse = (value: unknown, fallback: string) => {
    const date = new Date(String(value || ''));
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
  };
  const from = parse(fromValue, first);
  const to = parse(toValue, next);
  if (Date.parse(from) >= Date.parse(to)) throw new Error('INVALID_USAGE_PERIOD');
  return { from, to };
}

export async function getWorkspaceAiUsageSummary(input: {
  db: D1Database;
  workspaceId: string;
  requestingUserId: string;
  role: string;
  from: string;
  to: string;
}): Promise<AiUsageSummary> {
  const fullWorkspace = ['owner', 'admin'].includes(clean(input.role).toLowerCase());
  const ownClause = fullWorkspace ? '' : ' AND l.user_id = ?';
  const bindings = fullWorkspace
    ? [input.workspaceId, input.from, input.to]
    : [input.workspaceId, input.from, input.to, input.requestingUserId];
  const [total, users, features, models] = await Promise.all([
    input.db.prepare(`SELECT ${aggregateColumns} FROM ai_usage_ledger l WHERE l.workspace_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?)${ownClause}`)
      .bind(...bindings).first<Record<string, unknown>>(),
    input.db.prepare(`SELECT l.user_id AS userId, COALESCE(u.display_name, '已刪除使用者') AS userName, ${aggregateColumns} FROM ai_usage_ledger l LEFT JOIN users u ON u.id = l.user_id WHERE l.workspace_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?)${ownClause} GROUP BY l.user_id, u.display_name ORDER BY total_tokens DESC`)
      .bind(...bindings).all<Record<string, unknown>>(),
    input.db.prepare(`SELECT feature_code AS featureCode, ${aggregateColumns} FROM ai_usage_ledger l WHERE l.workspace_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?)${ownClause} GROUP BY feature_code ORDER BY total_tokens DESC`)
      .bind(...bindings).all<Record<string, unknown>>(),
    input.db.prepare(`SELECT provider, model, ${aggregateColumns} FROM ai_usage_ledger l WHERE l.workspace_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?)${ownClause} GROUP BY provider, model ORDER BY total_tokens DESC`)
      .bind(...bindings).all<Record<string, unknown>>(),
  ]);
  return {
    period: { from: input.from, to: input.to },
    scope: fullWorkspace ? 'workspace' : 'self',
    total: numericAggregate(total),
    byUser: users.results || [],
    byFeature: features.results || [],
    byModel: models.results || [],
  };
}

export async function getSystemAiUsageSummary(input: {
  db: D1Database;
  from: string;
  to: string;
}): Promise<AiUsageSummary> {
  const base = [input.from, input.to];
  const [total, workspaces, users, features, models] = await Promise.all([
    input.db.prepare(`SELECT ${aggregateColumns} FROM ai_usage_ledger l WHERE datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?)`).bind(...base).first<Record<string, unknown>>(),
    input.db.prepare(`SELECT l.workspace_id AS workspaceId, w.name AS workspaceName, ${aggregateColumns} FROM ai_usage_ledger l JOIN workspaces w ON w.id = l.workspace_id WHERE datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?) GROUP BY l.workspace_id, w.name ORDER BY billable_cost_micros DESC, total_tokens DESC`).bind(...base).all<Record<string, unknown>>(),
    input.db.prepare(`SELECT l.workspace_id AS workspaceId, l.user_id AS userId, COALESCE(u.display_name, '已刪除使用者') AS userName, ${aggregateColumns} FROM ai_usage_ledger l LEFT JOIN users u ON u.id = l.user_id WHERE datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?) GROUP BY l.workspace_id, l.user_id, u.display_name ORDER BY total_tokens DESC`).bind(...base).all<Record<string, unknown>>(),
    input.db.prepare(`SELECT feature_code AS featureCode, ${aggregateColumns} FROM ai_usage_ledger l WHERE datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?) GROUP BY feature_code ORDER BY total_tokens DESC`).bind(...base).all<Record<string, unknown>>(),
    input.db.prepare(`SELECT provider, model, ${aggregateColumns} FROM ai_usage_ledger l WHERE datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?) GROUP BY provider, model ORDER BY total_tokens DESC`).bind(...base).all<Record<string, unknown>>(),
  ]);
  return {
    period: { from: input.from, to: input.to }, scope: 'system',
    total: numericAggregate(total),
    byWorkspace: workspaces.results || [], byUser: users.results || [],
    byFeature: features.results || [], byModel: models.results || [],
  };
}
