import { timingSafeEqual } from 'node:crypto';
import { pbkdf2 } from 'hash-wasm';
import type { IHasher } from 'hash-wasm/dist/lib/WASMInterface';
import sha256Wasm from './sha256.wasm';
import {
  normalizeProjectAreaAction,
  projectAreaActionFromRow,
  richMenuAliasIdForProject,
} from './project-actions.mjs';
import {
  deleteRichMenuAlias,
  getRichMenuAlias,
  publishRichMenuToLine,
  setDefaultRichMenu,
  verifyDefaultRichMenu,
} from './line-rich-menu.mjs';
import { resolveProjectLinePublishCredential } from './project-line-publish-credential';
import { buildGuideContext, toPublicGuideContext } from './guide/context';
import { evaluateGuide } from './guide/rules';
import { buildGuideWorkflow } from './guide/workflow';
import { emptyRecommendationResult, evaluateRecommendations } from './guide/recommendations/engine';
import { explainRecommendation, findRecommendationById } from './guide/explanations/engine';
import { buildProposal, sanitizeProposal } from './guide/proposals/engine';
import {
  createProposalDraft,
  fingerprintProposal,
  getStoredProposal,
  listProposalEvents,
  listStoredProposals,
  proposalPermissions,
  transitionStoredProposal,
} from './guide/proposals/persistence';
import type { StoredProposal } from './guide/proposals/persistence';
import {
  buildOperationPlan,
  executeOperationPlan,
  listOperationLogs,
  operationErrorMessage,
  operationLogEvents,
  OperationExecutionError,
  publicOperationLog,
  publicOperationLogs,
  publicOperationPlan,
  proposalExecutionContract,
} from './guide/proposals/execution';
import {
  buildRollbackContext,
  buildRollbackPlan,
  executeRollbackPlan,
  publicRollbackPlan,
  rollbackErrorMessage,
  RollbackExecutionError,
} from './guide/proposals/rollback';
import {
  getLatestHttpsProbe,
  httpsProbeEligibility,
  probeHttpsUpgradeCandidate,
  saveHttpsProbeResult,
  toPublicHttpsProbe,
  type HttpsProbeEligibility,
  type PublicHttpsProbe,
  type StoredHttpsProbe,
} from './guide/proposals/https-probe';
import {
  assertPolicyAllowed,
  buildExecutionPreflight,
  evaluateOperationPolicy,
  OperationPolicyError,
  policyAuditMetadata,
  policyReasonMessage,
  publicPolicySummary,
} from './guide/proposals/policy';
import {
  compositePlanPolicyMessage,
  evaluateCompositePlanPolicy,
} from './guide/proposals/policy';
import {
  buildCompositeOperationPlan,
  CompositePlanError,
  compositeRiskReason,
  type CompositeOperationPlan,
} from './guide/proposals/composite-plan';
import {
  createStoredCompositePlan,
  getStoredCompositePlan,
  listCompositePlanEvents,
  listStoredCompositePlans,
  transitionStoredCompositePlan,
  updateCompositePlanPreflight,
} from './guide/proposals/composite-plan-persistence';
import {
  executeMeteredAiCall,
  extractGeminiUsageMetadata,
  getSystemAiUsageSummary,
  getWorkspaceAiUsageSummary,
  normalizeUsagePeriod,
} from './ai/usage';
import {
  CompositeExecutionError,
  executeCompositeOperationPlan,
  listPlanExecutionRuns,
  type PreparedPlanStep,
} from './guide/proposals/composite-execution';
import type { OperationPlanStep } from './guide/proposals/composite-plan';
import { syncLineRichMenuInsights, recordLineActionEvent } from './line-intelligence/service';
import { GEMINI_MODEL, geminiProviderNotConfiguredResponse, requestGeminiContent } from './gemini';
import {
  classifyRichMenuLayout,
  normalizeDetectedRichMenuAreas,
  readImageDimensions,
  resolveRichMenuDimensions,
  richMenuAreaStyle,
  validateRichMenuAreas,
  validateRichMenuImageDimensions,
} from './rich-menu-layout';
import { authenticateConversionApiKey, conversionKeyHash, conversionMetadata, createConversionApiKey } from './journey/conversion-keys';
import { writeGatewayJourneyEvent } from './journey/engine';
import { funnel, lastObservedTouch, rebuildJourneyDaily } from './journey/core';
import { appendAttributionToken, createAttributionToken, destinationFingerprint, safeDestination, trackedTokenHash } from './journey/tracked-uri';
import { conversionSource, sanitizeConversionMetadata, conversionSourceHealthRows } from './journey/conversion-sources';
import { backendFriendship, establishMember, memberIdentityHash, parseReferralLanding, referralCode, referralUrl, safeReturnTo, verifyLiffAccessToken } from './referral/core';
import { createReferralFlowToken, recordReferralAnalyticsEvent, referralEventKeys, verifyReferralFlowToken, REFERRAL_GROWTH_THRESHOLDS } from './referral/growth';
import { referralGrowthPeriod, referralGrowthSnapshot } from './referral/growth-api';
import { establishConversionReferralEvidence, issueConversionReferralContext, resolveConversionReferralContext } from './commission/evidence-bridge';
import { establishCommissionAttribution } from './commission/attribution';
import { createCommissionRuleVersion, listCommissionRuleVersions } from './commission/calculation-ledger';
import { commissionAttributionPeriod, commissionAttributionSnapshot } from './commission/read-api';
import { commissionLedgerPeriod, commissionLedgerSnapshot } from './commission/ledger-read-api';
import { canTransitionCommissionProgramStatus, isAttributionWindowDays, isCommissionProgramStatus, isDealerEligibilityStatus, publicCommissionProgramDealerRow, publicCommissionProgramRow } from './commission/program-foundation';
import { SETTLEMENT_ELIGIBLE_LEDGER_SQL, canTransitionSettlementStatus, isSettlementStatus, isValidSettlementPeriod, publicSettlementItem, publicSettlementRow } from './commission/settlement-foundation';
import { canTransitionPayoutRequestStatus, isPayoutRejectionReasonCode, isPayoutRequestStatus, publicDealerPayoutRequestRow, publicPayoutRequestRow } from './commission/payout-foundation';
import { canTransitionPaymentAttemptStatus, internalTestPaymentProvider, isPaymentFailureReasonCode, paymentIdempotencyKeyHash, publicDealerPaymentStatusRow, publicPaymentAttemptRow } from './commission/payment-execution';
import { createDealerSettlementHandle, dealerFinalizedSettlementRows, dealerSettlementHandleReference, publicDealerSettlementRow, verifyDealerSettlementHandle } from './commission/dealer-settlement-read';
import { createDealerPayoutRequestHandle, dealerPayoutRequestHandleReference, verifyDealerPayoutRequestHandle } from './commission/dealer-payout-request-handle';
import { canTenantTransitionDealerStatus, dealerApplyDecision, isDealerStatus, publicDealerRow } from './dealers/foundation';
import { createPointRuleVersion, getMemberPoints, getTenantPointsSummary } from './points';
import { crmPersonByReference, ensureCrmPersonForVerifiedMember, listCrmPeople, publicCrmPerson, updateCrmProfile } from './crm';
import { createCsvImport, importCapability, importRows, listCrmImports, resolveCrmImportRow } from './crm/imports';
import { collectShare, createBusinessCard, createOrVersion, createShare, ownCard, ownCollection, ownPerson, publicCard, publicShare, revokeShare, setCardStatus } from './crm/cards';
import { registerCrmInsightRoutes } from './crm/insight-routes';
import { registerCrmPipelineRoutes } from './crm/pipeline-routes';
import { registerCrmTimelineRoutes } from './crm/timeline-routes';
import { registerCrmSegmentRoutes } from './crm/segment-routes';
import { registerCampaignAudienceRoutes } from './campaign/audience-routes';
import { registerCampaignExecutionRoutes } from './campaign/execution-routes';
import { registerCampaignRoutes } from './campaign/campaign-routes';
import { registerCommerceRoutes } from './commerce/routes';
import { acquisitionSummary, assignCrmOwner, assignmentSummary, referralSummary } from './crm/acquisition';
import { assigneeReference, createAssigneeHandle, verifyAssigneeHandle } from './crm/assignee-handle';


import { createReward, createRewardVersion, isRewardStatus, listMemberRedemptions, listMemberRewards, listTenantRewards, redeemReward, tenantRedemptionSummary, transitionRewardStatus } from './points/rewards';
import { createContributionRuleVersion, createTierRuleVersion, isContributionEventType, isTierCode, memberContributionRead, recordContributionForTrustedSource, tenantContributionSummary } from './contribution';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  GEMINI_API_KEY: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  TENANT_MODE?: string;
  DEV_WORKSPACE_ID?: string;
  AUTH_DEV_TOKEN?: string;
  MEMBER_IDENTITY_HMAC_SECRET?: string;
  NEWEBPAY_MERCHANT_ID?: string;
  NEWEBPAY_HASH_KEY?: string;
  NEWEBPAY_HASH_IV?: string;
  NEWEBPAY_MODE?: string;
  NEWEBPAY_RETURN_URL?: string;
  smart_menu_assets: R2Bucket;
  smart_menu_db: D1Database;
};

type Variables = {
  workspaceId: string;
  userId: string;
  userRole: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

const text = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const id = (prefix: string) => `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;


function normalizeKeyword(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function keywordRulesConflict(aKeyword: string, aType: string, bKeyword: string, bType: string) {
  const a = normalizeKeyword(aKeyword);
  const b = normalizeKeyword(bKeyword);

  if (!a || !b) return false;
  if (a === b) return true;

  const aMatch = (text: string) => {
    if (aType === 'exact') return text === a;
    if (aType === 'prefix') return text.startsWith(a);
    if (aType === 'contains') return text.includes(a);
    return false;
  };

  const bMatch = (text: string) => {
    if (bType === 'exact') return text === b;
    if (bType === 'prefix') return text.startsWith(b);
    if (bType === 'contains') return text.includes(b);
    return false;
  };

  // 以兩個規則本身與常見拼接情境測試交集。
  const samples = new Set<string>([
    a,
    b,
    `${a} 測試`,
    `${b} 測試`,
    `我要${a}`,
    `我要${b}`,
    `${a}${b}`,
    `${b}${a}`,
  ]);

  for (const sample of samples) {
    if (aMatch(sample) && bMatch(sample)) return true;
  }

  // 更直接的 prefix / contains 交集判斷。
  if (aType === 'prefix' && bType === 'prefix') {
    return a.startsWith(b) || b.startsWith(a);
  }

  if (aType === 'contains' && bType === 'contains') {
    return a.includes(b) || b.includes(a);
  }

  if (aType === 'prefix' && bType === 'contains') {
    return a.includes(b) || b.startsWith(a) || a.startsWith(b);
  }

  if (aType === 'contains' && bType === 'prefix') {
    return b.includes(a) || a.startsWith(b) || b.startsWith(a);
  }

  if (aType === 'exact' && bType === 'prefix') return a.startsWith(b);
  if (bType === 'exact' && aType === 'prefix') return b.startsWith(a);

  if (aType === 'exact' && bType === 'contains') return a.includes(b);
  if (bType === 'exact' && aType === 'contains') return b.includes(a);

  return false;
}

async function findKeywordConflict(
  env: Bindings,
  workspaceId: string,
  keyword: string,
  matchType: string,
  excludeRouteId = ''
) {
  const result = await env.smart_menu_db.prepare(`
    SELECT
      r.id,
      r.keyword,
      r.keyword_normalized,
      r.match_type,
      r.target_id,
      t.name AS target_name
    FROM workspace_keyword_routes r
    JOIN workspace_webhook_targets t ON t.id = r.target_id
    WHERE r.workspace_id = ?
      AND r.enabled = 1
    ORDER BY r.priority ASC, r.created_at ASC
  `).bind(workspaceId).all();

  for (const row of (result.results || []) as any[]) {
    if (excludeRouteId && row.id === excludeRouteId) continue;

    if (keywordRulesConflict(keyword, matchType, row.keyword, row.match_type)) {
      return row;
    }
  }

  return null;
}

function generateWebhookToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}


async function verifyLineSignature(
  rawBody: string,
  signature: string,
  channelSecret: string
): Promise<boolean> {
  if (!signature || !channelSecret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(rawBody)
  );

  return bytesToBase64(new Uint8Array(digest)) === signature;
}

function keywordMatches(textValue: string, keyword: string, matchType: string) {
  const value = normalizeKeyword(textValue);
  const rule = normalizeKeyword(keyword);

  if (!value || !rule) return false;
  if (matchType === 'exact') return value === rule;
  if (matchType === 'prefix') return value.startsWith(rule);
  if (matchType === 'contains') return value.includes(rule);
  return false;
}

async function replyToLine(
  accessToken: string,
  replyPayload: any
) {
  if (!accessToken || !replyPayload) return;

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(replyPayload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`LINE Reply API 失敗：${res.status} ${detail}`);
  }
}

// =====================================================
// SaaS Tenant Layer V1
// production 模式不接受前端直接指定 workspace_id。
// 目前登入/LIFF Auth 尚未接入，因此 production 會拒絕未驗證請求。
// local/dev 模式可使用 DEV_WORKSPACE_ID（預設 default）維持既有開發流程。
// =====================================================

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const SHA256_WASM_BUFFER_SIZE = 0x4000;

type Sha256WasmExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  Hash_GetBuffer: () => number;
  Hash_Init: (bits: number) => void;
  Hash_Update: (length: number) => void;
  Hash_Final: (padding: number) => void;
};

function passwordHashInputBytes(data: string | ArrayBufferView): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function createCloudflareSha256(): Promise<IHasher> {
  const instance = await WebAssembly.instantiate(sha256Wasm, {});
  const wasm = instance.exports as Sha256WasmExports;
  let initialized = false;

  const memory = () => new Uint8Array(
    wasm.memory.buffer,
    wasm.Hash_GetBuffer(),
    SHA256_WASM_BUFFER_SIZE
  );

  function digest(outputType: 'binary'): Uint8Array;
  function digest(outputType?: 'hex'): string;
  function digest(outputType: 'hex' | 'binary' = 'hex'): string | Uint8Array {
    if (!initialized) throw new Error('SHA-256 digest called before init');
    wasm.Hash_Final(0);
    initialized = false;
    const result = memory().slice(0, PBKDF2_KEY_LENGTH_BYTES);
    if (outputType === 'binary') return result;
    return Array.from(result).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  const hasher: IHasher = {
    init: () => {
      wasm.Hash_Init(256);
      initialized = true;
      return hasher;
    },
    update: (data) => {
      if (!initialized) throw new Error('SHA-256 update called before init');
      const bytes = passwordHashInputBytes(data);
      for (let offset = 0; offset < bytes.length; offset += SHA256_WASM_BUFFER_SIZE) {
        const chunk = bytes.subarray(offset, offset + SHA256_WASM_BUFFER_SIZE);
        memory().set(chunk);
        wasm.Hash_Update(chunk.length);
      }
      return hasher;
    },
    digest,
    save: () => {
      throw new Error('SHA-256 save is not supported');
    },
    load: () => {
      throw new Error('SHA-256 load is not supported');
    },
    blockSize: 64,
    digestSize: PBKDF2_KEY_LENGTH_BYTES,
  };

  return hasher.init();
}

const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEY_LENGTH_BYTES = 32;

async function derivePasswordHash(
  password: string,
  saltBase64: string,
  iterations = PBKDF2_ITERATIONS
): Promise<string> {
  const derivedKey = await pbkdf2({
    password,
    salt: base64ToBytes(saltBase64),
    iterations,
    hashLength: PBKDF2_KEY_LENGTH_BYTES,
    hashFunction: createCloudflareSha256(),
    outputType: 'binary',
  });
  return bytesToBase64(derivedKey);
}

async function createPasswordRecord(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltBase64 = bytesToBase64(salt);
  const hash = await derivePasswordHash(password, saltBase64);
  return { hash, salt: saltBase64, iterations: PBKDF2_ITERATIONS };
}

async function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
  iterations: number
) {
  const actualBytes = base64ToBytes(await derivePasswordHash(password, salt, iterations));
  const expectedBytes = base64ToBytes(expectedHash);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}


function slugifyWorkspace(value: string): string {
  const base = value.trim().toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `workspace-${crypto.randomUUID().slice(0, 8)}`;
}

async function uniqueWorkspaceSlug(env: Bindings, desired: string): Promise<string> {
  const base = slugifyWorkspace(desired);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await env.smart_menu_db.prepare(`
      SELECT id FROM workspaces
      WHERE slug = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(candidate).first();
    if (!exists) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function issueSession(env: Bindings, userId: string) {
  const token = createSessionToken();
  const tokenHash = await sha256Hex(token);
  const sessionId = id('ses');

  await env.smart_menu_db.prepare(`
    INSERT INTO auth_sessions (
      id, user_id, token_hash, expires_at, created_at
    )
    VALUES (
      ?, ?, ?,
      datetime('now', '+30 days'),
      CURRENT_TIMESTAMP
    )
  `).bind(sessionId, userId, tokenHash).run();

  return {
    token,
    sessionId,
    expiresInDays: 30,
  };
}

function bearerToken(c: any): string {
  const authorization = text(c.req.header('Authorization'));
  if (!authorization.toLowerCase().startsWith('bearer ')) return '';
  return authorization.slice(7).trim();
}

async function membershipForUser(env: Bindings, userId: string, requestedWorkspaceId = '') {
  if (requestedWorkspaceId) {
    return env.smart_menu_db.prepare(`
      SELECT
        wm.workspace_id,
        wm.role,
        wm.status AS membership_status,
        w.name AS workspace_name,
        w.slug AS workspace_slug,
        w.status AS workspace_status,
        u.id AS user_id,
        u.display_name,
        u.email,
        u.line_user_id
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      JOIN users u ON u.id = wm.user_id
      WHERE wm.user_id = ?
        AND wm.workspace_id = ?
        AND wm.status = 'active'
        AND w.status = 'active'
        AND w.deleted_at IS NULL
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 1
    `).bind(userId, requestedWorkspaceId).first();
  }

  return env.smart_menu_db.prepare(`
    SELECT
      wm.workspace_id,
      wm.role,
      wm.status AS membership_status,
      w.name AS workspace_name,
      w.slug AS workspace_slug,
      w.status AS workspace_status,
      u.id AS user_id,
      u.display_name,
      u.email,
      u.line_user_id
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    JOIN users u ON u.id = wm.user_id
    WHERE wm.user_id = ?
      AND wm.status = 'active'
      AND w.status = 'active'
      AND w.deleted_at IS NULL
      AND u.status = 'active'
      AND u.deleted_at IS NULL
    ORDER BY
      CASE wm.role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'editor' THEN 3
        ELSE 4
      END,
      wm.created_at ASC
    LIMIT 1
  `).bind(userId).first();
}

async function resolveTenantContext(c: any) {
  const mode = text(c.env.TENANT_MODE || 'session').toLowerCase();
  const requestedWorkspaceId = text(c.req.header('X-Workspace-Id'));
  const token = bearerToken(c);

  if (mode === 'development') {
    const devUserId = 'usr_dev_owner';
    const membership: any = await membershipForUser(
      c.env,
      devUserId,
      text(c.env.DEV_WORKSPACE_ID || 'default')
    );

    if (!membership) throw new Error('MEMBERSHIP_REQUIRED');

    return {
      workspaceId: membership.workspace_id,
      userId: membership.user_id,
      userRole: membership.role,
    };
  }

  if (!token) throw new Error('AUTH_REQUIRED');

  const tokenHash = await sha256Hex(token);

  // One D1 round-trip for session + user + membership + workspace.
  const auth: any = await c.env.smart_menu_db.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id,
      s.last_used_at,
      wm.workspace_id,
      wm.role
    FROM auth_sessions s
    JOIN users u
      ON u.id = s.user_id
     AND u.status = 'active'
     AND u.deleted_at IS NULL
    JOIN workspace_members wm
      ON wm.user_id = s.user_id
     AND wm.status = 'active'
    JOIN workspaces w
      ON w.id = wm.workspace_id
     AND w.status = 'active'
     AND w.deleted_at IS NULL
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND datetime(s.expires_at) > datetime('now')
      AND (? = '' OR wm.workspace_id = ?)
    ORDER BY
      CASE wm.role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'editor' THEN 3
        ELSE 4
      END,
      wm.created_at ASC
    LIMIT 1
  `).bind(
    tokenHash,
    requestedWorkspaceId,
    requestedWorkspaceId
  ).first();

  if (!auth) {
    if (requestedWorkspaceId) {
      const sessionOnly = await c.env.smart_menu_db.prepare(`
        SELECT s.id
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND datetime(s.expires_at) > datetime('now')
          AND u.status = 'active'
          AND u.deleted_at IS NULL
        LIMIT 1
      `).bind(tokenHash).first();

      if (sessionOnly) throw new Error('MEMBERSHIP_REQUIRED');
    }

    throw new Error('AUTH_INVALID');
  }

  // Avoid a D1 write on every API read. Touch session at most every 15 minutes.
  const lastUsed = text(auth.last_used_at);
  const lastUsedMs = lastUsed
    ? Date.parse(lastUsed.replace(' ', 'T') + 'Z')
    : 0;

  if (!lastUsedMs || Date.now() - lastUsedMs > 15 * 60 * 1000) {
    c.executionCtx.waitUntil(
      c.env.smart_menu_db.prepare(`
        UPDATE auth_sessions
        SET last_used_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND (
            last_used_at IS NULL
            OR datetime(last_used_at) < datetime('now', '-15 minutes')
          )
      `).bind(auth.session_id).run().catch(() => {})
    );
  }

  return {
    workspaceId: auth.workspace_id,
    userId: auth.user_id,
    userRole: auth.role,
  };
}



app.post('/auth/register', async (c) => {
  try {
    const body: any = await c.req.json();
    const displayName = text(body.displayName);
    const username = text(body.username).toLowerCase();
    const email = text(body.email).toLowerCase();
    const password = String(body.password || '');
    const workspaceName = text(body.workspaceName);

    if (!displayName) return c.json({ success: false, error: '請輸入姓名或顯示名稱。' }, 400);
    if (!username || username.length < 3) return c.json({ success: false, error: '帳號至少需要 3 個字元。' }, 400);
    if (!/^[a-z0-9._-]+$/.test(username)) return c.json({ success: false, error: '帳號只能使用英文字母、數字、點、底線或連字號。' }, 400);
    if (!email || !email.includes('@')) return c.json({ success: false, error: '請輸入有效 Email。' }, 400);
    if (password.length < 8) return c.json({ success: false, error: '密碼至少需要 8 個字元。' }, 400);
    if (!workspaceName) return c.json({ success: false, error: '請輸入 Workspace 名稱。' }, 400);

    const existingUser = await c.env.smart_menu_db.prepare(`
      SELECT id FROM users
      WHERE (lower(username) = ? OR lower(email) = ?)
        AND deleted_at IS NULL
      LIMIT 1
    `).bind(username, email).first();

    if (existingUser) return c.json({ success: false, error: '此帳號或 Email 已被使用。' }, 409);

    const userId = id('usr');
    const workspaceId = id('ws');
    const membershipId = id('wsm');
    const workspaceSlug = await uniqueWorkspaceSlug(c.env, workspaceName);
    const passwordRecord = await createPasswordRecord(password);

    await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        INSERT INTO users (
          id, username, email, display_name,
          password_hash, password_salt, password_iterations,
          password_updated_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(userId, username, email, displayName, passwordRecord.hash, passwordRecord.salt, passwordRecord.iterations),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspaces (
          id, name, slug, status, plan, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', 'starter', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(workspaceId, workspaceName, workspaceSlug),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_members (
          id, workspace_id, user_id, role, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'owner', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(membershipId, workspaceId, userId),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_line_accounts (
          id,
          workspace_id,
          status,
          webhook_token,
          webhook_enabled,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?,
          'disconnected',
          ?,
          1,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `).bind(
        id('lineacct'),
        workspaceId,
        generateWebhookToken()
      ),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_webhook_targets (
          id,
          workspace_id,
          name,
          target_type,
          position,
          enabled,
          can_reply,
          forward_signature,
          timeout_ms
        )
        VALUES (?, ?, 'System A', 'primary', 1, 0, 1, 1, 8000)
      `).bind(
        id('wht'),
        workspaceId
      ),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_webhook_targets (
          id,
          workspace_id,
          name,
          target_type,
          position,
          enabled,
          can_reply,
          forward_signature,
          timeout_ms
        )
        VALUES (?, ?, 'System B', 'secondary', 2, 0, 0, 1, 8000)
      `).bind(
        id('wht'),
        workspaceId
      )
    ]);

    const session = await issueSession(c.env, userId);

    return c.json({
      success: true,
      token: session.token,
      expiresInDays: session.expiresInDays,
      user: { id: userId, username, email, displayName, lineUserId: null },
      workspace: {
        id: workspaceId,
        name: workspaceName,
        slug: workspaceSlug,
        role: 'owner',
        plan: 'starter',
      },
    }, 201);
  } catch (e: any) {
    console.error('register:', e);
    return c.json({ success: false, error: e?.message || '註冊失敗' }, 500);
  }
});

app.post('/auth/login', async (c) => {
  try {
    const body: any = await c.req.json();
    const login = text(body.login).toLowerCase();
    const password = String(body.password || '');

    if (!login || !password) {
      return c.json({ success: false, error: '請輸入帳號與密碼。' }, 400);
    }

    const user: any = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM users
      WHERE (
        lower(username) = ?
        OR lower(email) = ?
      )
        AND status = 'active'
        AND deleted_at IS NULL
      LIMIT 1
    `).bind(login, login).first();

    if (
      !user ||
      !user.password_hash ||
      !user.password_salt
    ) {
      return c.json({ success: false, error: '帳號或密碼錯誤。' }, 401);
    }

    const ok = await verifyPassword(
      password,
      user.password_hash,
      user.password_salt,
      Number(user.password_iterations || 210000)
    );

    if (!ok) {
      return c.json({ success: false, error: '帳號或密碼錯誤。' }, 401);
    }

    const membership: any = await membershipForUser(c.env, user.id);

    if (!membership) {
      return c.json({ success: false, error: '此帳號沒有可使用的 Workspace。' }, 403);
    }

    const session = await issueSession(c.env, user.id);

    await c.env.smart_menu_db.prepare(`
      UPDATE users
      SET last_login_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(user.id).run();

    return c.json({
      success: true,
      token: session.token,
      expiresInDays: session.expiresInDays,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        lineUserId: user.line_user_id,
      },
      workspace: {
        id: membership.workspace_id,
        name: membership.workspace_name,
        role: membership.role,
      },
    });
  } catch (e: any) {
    console.error('login:', e);
    return c.json({ success: false, error: e?.message || '登入失敗' }, 500);
  }
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/intelligence/conversions' || c.req.path === '/api/commerce/payments/newebpay/notify' || c.req.path.startsWith('/api/member/')) return next();
  try {
    const tenant = await resolveTenantContext(c);
    c.set('workspaceId', tenant.workspaceId);
    c.set('userId', tenant.userId);
    c.set('userRole', tenant.userRole);
    await next();
  } catch (e: any) {
    if (e?.message === 'AUTH_REQUIRED') {
      return c.json({ success: false, error: '請先登入。' }, 401);
    }
    if (e?.message === 'AUTH_INVALID') {
      return c.json({ success: false, error: '登入憑證無效或已過期。' }, 401);
    }
    if (e?.message === 'MEMBERSHIP_REQUIRED') {
      return c.json({ success: false, error: '此使用者不屬於可用的 Workspace。' }, 403);
    }
    throw e;
  }
});

function workspaceIdOf(c: any): string {
  const workspaceId = text(c.get('workspaceId'));
  if (!workspaceId) throw new Error('Missing workspace context');
  return workspaceId;
}

const ROLE_LEVEL: Record<string, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

function requireRole(c: any, minimum: 'viewer' | 'editor' | 'admin' | 'owner') {
  const current = text(c.get('userRole') || 'viewer').toLowerCase();
  if ((ROLE_LEVEL[current] || 0) < ROLE_LEVEL[minimum]) {
    throw new Error('FORBIDDEN_ROLE');
  }
}

function publicLiffConfig(row:any, account:any) { const channel=text(account?.line_login_channel_id); const status=!row?'NOT_CONFIGURED':!row.linkage_confirmed_at?'LINKAGE_NOT_CONFIRMED':!row.runtime_verified_at?'NOT_RUNTIME_VERIFIED':channel!==text(row.verified_line_login_channel_id)?'STALE':'READY'; return {liffId:row?text(row.liff_id):null,liffEntryUrl:row?text(row.liff_entry_url):null,verifiedLineLoginChannelId:row?text(row.verified_line_login_channel_id):null,status,linkageConfirmedAt:row?.linkage_confirmed_at||null,runtimeVerifiedAt:row?.runtime_verified_at||null,friendshipVerifiedAt:row?.friendship_verified_at||null}; }
async function referralAccount(db:D1Database,lineAccountId:string) { return await db.prepare('SELECT id,workspace_id,line_login_channel_id FROM workspace_line_accounts WHERE id=? LIMIT 1').bind(lineAccountId).first<any>(); }
async function verifiedReferralMember(c:any, body:any) { const account=await referralAccount(c.env.smart_menu_db,text(body.lineAccountId)); if(!account) throw new Error('CONFIG_NOT_READY'); const config:any=await c.env.smart_menu_db.prepare('SELECT * FROM workspace_liff_configs WHERE workspace_id=? AND line_account_id=? LIMIT 1').bind(account.workspace_id,account.id).first(); const state=publicLiffConfig(config,account); if(state.status==='STALE'||state.status==='NOT_CONFIGURED'||state.status==='LINKAGE_NOT_CONFIRMED') throw new Error('CONFIG_NOT_READY'); const token=text(body.liffAccessToken,4096); if(!token) throw new Error('LIFF_TOKEN_INVALID'); const verified=await verifyLiffAccessToken(token,text(account.line_login_channel_id)); const hash=await memberIdentityHash(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),account.workspace_id,account.id,verified.lineUserId); const memberId=await establishMember(c.env.smart_menu_db,{workspaceId:account.workspace_id,lineAccountId:account.id,identityHash:hash,providerRecipientId:verified.lineUserId}); await c.env.smart_menu_db.prepare('UPDATE workspace_liff_configs SET runtime_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(config.id).run(); return {account,config,memberId,token}; }

async function verifiedDealerLedgerMember(c:any) { const lineAccountId=text(c.req.query('lineAccountId')); const account=await referralAccount(c.env.smart_menu_db,lineAccountId); if(!account) throw new Error('CONFIG_NOT_READY'); const config:any=await c.env.smart_menu_db.prepare('SELECT * FROM workspace_liff_configs WHERE workspace_id=? AND line_account_id=? LIMIT 1').bind(account.workspace_id,account.id).first(); const state=publicLiffConfig(config,account); if(state.status==='STALE'||state.status==='NOT_CONFIGURED'||state.status==='LINKAGE_NOT_CONFIRMED') throw new Error('CONFIG_NOT_READY'); const token=text(c.req.header('Authorization')).replace(/^Bearer\s+/i,''); if(!token) throw new Error('LIFF_TOKEN_INVALID'); const verified=await verifyLiffAccessToken(token,text(account.line_login_channel_id)); const hash=await memberIdentityHash(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),account.workspace_id,account.id,verified.lineUserId); const member:any=await c.env.smart_menu_db.prepare('SELECT id FROM line_oa_members WHERE workspace_id=? AND line_account_id=? AND line_identity_hash=? LIMIT 1').bind(account.workspace_id,account.id,hash).first(); return { account, memberId: member ? String(member.id) : null }; }
app.get('/api/line/account',async c=>{const workspaceId=workspaceIdOf(c);const account:any=await c.env.smart_menu_db.prepare('SELECT id,oa_name,line_login_channel_id FROM workspace_line_accounts WHERE workspace_id=? LIMIT 1').bind(workspaceId).first();return c.json({success:true,account:account?{id:account.id,oaName:account.oa_name||'',lineLoginChannelId:account.line_login_channel_id||null}:null});});
app.get('/api/referral-growth',async c=>{try{const workspaceId=workspaceIdOf(c),days=referralGrowthPeriod(c.req.query('period'));const snapshot=await referralGrowthSnapshot(c.env.smart_menu_db,{workspaceId,days});const contributors:any[]=(await c.env.smart_menu_db.prepare("SELECT inviter_member_id,COUNT(*) qualified_count FROM member_referral_attributions WHERE workspace_id=? AND status='qualified' AND qualified_at>=? GROUP BY inviter_member_id ORDER BY qualified_count DESC LIMIT 10").bind(workspaceId,snapshot.period.from).all()).results||[];return c.json({success:true,...snapshot,topContributors:contributors.map((r,index)=>({rank:index+1,publicSafeLabel:`Member #${index+1}`,qualifiedCount:Number(r.qualified_count||0)}))});}catch{return c.json({success:false,error:'REFERRAL_GROWTH_UNAVAILABLE'},500)}});app.get('/api/member/referral/bootstrap',async c=>{const account=await referralAccount(c.env.smart_menu_db,text(c.req.query('lineAccountId')));if(!account)return c.json({success:false,error:'NOT_FOUND'},404);const config:any=await c.env.smart_menu_db.prepare('SELECT * FROM workspace_liff_configs WHERE workspace_id=? AND line_account_id=? LIMIT 1').bind(account.workspace_id,account.id).first();const state=publicLiffConfig(config,account);const landing=parseReferralLanding(new URL(c.req.url).searchParams);let referralFlowToken:string|undefined;const ref=text(landing.referralCode);let reused=false;if(ref){const identity:any=await c.env.smart_menu_db.prepare('SELECT id,member_id FROM member_referral_identities WHERE workspace_id=? AND line_account_id=? AND referral_code=? AND status=? LIMIT 1').bind(account.workspace_id,account.id,ref,'active').first();if(identity){const supplied=text(c.req.header('X-Smart-Menu-Referral-Flow'),4096);if(supplied){try{const flow=await verifyReferralFlowToken(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),supplied);reused=flow.workspaceId===account.workspace_id&&flow.lineAccountId===account.id&&flow.referralIdentityId===identity.id&&flow.source===landing.source;if(reused)referralFlowToken=supplied;}catch{}}if(!referralFlowToken)referralFlowToken=await createReferralFlowToken(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),{workspaceId:account.workspace_id,lineAccountId:account.id,referralIdentityId:identity.id,source:landing.source});const keys=await referralEventKeys(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),{workspaceId:account.workspace_id,lineAccountId:account.id,eventType:'REFERRAL_LINK_OPENED',flowNonce:referralFlowToken,referralCode:ref});recordReferralAnalyticsEvent(c.env.smart_menu_db,{workspaceId:account.workspace_id,lineAccountId:account.id,referralIdentityId:identity.id,inviterMemberId:identity.member_id,eventType:'REFERRAL_LINK_OPENED',source:landing.source,dedupeKey:keys.dedupeKey,referralCodeFingerprint:keys.referralCodeFingerprint}).catch(()=>{});}}return c.json({success:true,config:{liffId:['NOT_RUNTIME_VERIFIED','READY'].includes(state.status)?state.liffId:null,status:state.status},referralFlowToken,referralFlowReused:reused});});app.get('/api/system/referral-growth-health',async c=>{try{await requireSystemAdmin(c);const db=c.env.smart_menu_db,cutoff=new Date(Date.now()-REFERRAL_GROWTH_THRESHOLDS.maximumFreshnessDays*86400000).toISOString();const liff:any=await db.prepare('SELECT COUNT(DISTINCT workspace_id) count FROM workspace_liff_configs WHERE linkage_confirmed_at IS NOT NULL AND runtime_verified_at IS NOT NULL AND friendship_verified_at IS NOT NULL').first(),land:any=await db.prepare("SELECT COUNT(*) count,MAX(occurred_at) last_at FROM member_referral_events WHERE event_type='REFERRAL_LINK_OPENED'").first(),qualified:any=await db.prepare("SELECT COUNT(*) count,MAX(qualified_at) last_at FROM member_referral_attributions WHERE status='qualified'").first(),active:any=await db.prepare("SELECT COUNT(DISTINCT workspace_id) count FROM (SELECT workspace_id FROM member_referral_events WHERE occurred_at>=? UNION SELECT workspace_id FROM member_referral_attributions WHERE status='qualified' AND qualified_at>=?)").bind(cutoff,cutoff).first(),stale:any=await db.prepare("SELECT COUNT(*) count FROM (SELECT workspace_id,MAX(at) last_at FROM (SELECT workspace_id,occurred_at at FROM member_referral_events UNION ALL SELECT workspace_id,qualified_at at FROM member_referral_attributions WHERE status='qualified') GROUP BY workspace_id HAVING last_at<?)").bind(cutoff).first();const landings=Number(land?.count||0),qualifiedCount=Number(qualified?.count||0),liffReadyTenantCount=Number(liff?.count||0),referralActiveTenantCount=Number(active?.count||0),staleGrowthTenantCount=Number(stale?.count||0),last=[land?.last_at,qualified?.last_at].filter(Boolean).sort().at(-1)||null;const referralGrowthReason=!liffReadyTenantCount?'LIFF_NOT_READY':!landings?'NO_REFERRAL_DATA':!referralActiveTenantCount&&staleGrowthTenantCount?'STALE_DATA':landings<REFERRAL_GROWTH_THRESHOLDS.minimumLandings?'INSUFFICIENT_REFERRAL_ACTIVITY':'READY';return c.json({success:true,referralGrowthReady:referralGrowthReason==='READY',referralGrowthReason,liffReadyTenantCount,referralActiveTenantCount,qualifiedReferralCount:qualifiedCount,funnelHealthSummary:{landings,qualified:qualifiedCount,overallQualificationRate:landings?qualifiedCount/landings:null},staleGrowthTenantCount,lastReferralGrowthActivityAt:last});}catch{return c.json({success:false,error:'REFERRAL_GROWTH_HEALTH_UNAVAILABLE'},500)}});app.get('/api/system/referral-health',async c=>{await requireSystemAdmin(c);const rows:any[]=(await c.env.smart_menu_db.prepare(`SELECT w.id workspace_id,w.name workspace_name,COALESCE(m.end_member_count,0) end_member_count,COALESCE(i.referral_identity_count,0) referral_identity_count,COALESCE(a.qualified_referral_count,0) qualified_referral_count,a.last_qualification_at,CASE WHEN lc.id IS NULL THEN 0 ELSE 1 END liff_configured,CASE WHEN lc.runtime_verified_at IS NULL THEN 0 ELSE 1 END runtime_verified,CASE WHEN lc.linkage_confirmed_at IS NULL THEN 0 ELSE 1 END linkage_confirmed FROM workspaces w LEFT JOIN workspace_liff_configs lc ON lc.workspace_id=w.id LEFT JOIN (SELECT workspace_id,COUNT(*) end_member_count FROM line_oa_members GROUP BY workspace_id) m ON m.workspace_id=w.id LEFT JOIN (SELECT workspace_id,COUNT(*) referral_identity_count FROM member_referral_identities GROUP BY workspace_id) i ON i.workspace_id=w.id LEFT JOIN (SELECT workspace_id,COUNT(*) qualified_referral_count,MAX(qualified_at) last_qualification_at FROM member_referral_attributions WHERE status='qualified' GROUP BY workspace_id) a ON a.workspace_id=w.id WHERE w.deleted_at IS NULL ORDER BY w.created_at DESC`).all()).results||[];return c.json({success:true,workspaces:rows.map((r:any)=>({workspaceId:r.workspace_id,workspaceName:r.workspace_name,referralReady:Boolean(r.liff_configured&&r.linkage_confirmed&&r.runtime_verified),liffConfigured:Boolean(r.liff_configured),liffRuntimeVerified:Boolean(r.runtime_verified),endMemberCount:Number(r.end_member_count||0),referralIdentityCount:Number(r.referral_identity_count||0),qualifiedReferralCount:Number(r.qualified_referral_count||0),lastQualificationAt:r.last_qualification_at||null}))});});app.get('/api/line/accounts/:lineAccountId/liff-config',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),account:any=await c.env.smart_menu_db.prepare('SELECT id,workspace_id,line_login_channel_id FROM workspace_line_accounts WHERE id=? AND workspace_id=? LIMIT 1').bind(c.req.param('lineAccountId'),workspaceId).first();if(!account)return c.json({success:false,error:'NOT_FOUND'},404);const config:any=await c.env.smart_menu_db.prepare('SELECT * FROM workspace_liff_configs WHERE workspace_id=? AND line_account_id=? LIMIT 1').bind(workspaceId,account.id).first();return c.json({success:true,config:publicLiffConfig(config,account),lineLoginChannelId:text(account.line_login_channel_id)||null});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'LIFF_CONFIG_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.put('/api/line/accounts/:lineAccountId/liff-config',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json(),account:any=await c.env.smart_menu_db.prepare('SELECT id,workspace_id,line_login_channel_id FROM workspace_line_accounts WHERE id=? AND workspace_id=? LIMIT 1').bind(c.req.param('lineAccountId'),workspaceId).first();const liffId=text(body.liffId,120),entry=text(body.liffEntryUrl,500);if(!account)return c.json({success:false,error:'NOT_FOUND'},404);if(!text(account.line_login_channel_id))return c.json({success:false,error:'LINE_LOGIN_NOT_CONFIGURED'},409);let url:URL;try{url=new URL(entry)}catch{return c.json({success:false,error:'INVALID_LIFF_ENTRY_URL'},400)}if(url.protocol!=='https:'||!liffId)return c.json({success:false,error:'INVALID_LIFF_CONFIG'},400);const configId=`liff_${crypto.randomUUID()}`;await c.env.smart_menu_db.prepare(`INSERT INTO workspace_liff_configs(id,workspace_id,line_account_id,liff_id,liff_entry_url,verified_line_login_channel_id,status,linkage_confirmed_at,linkage_confirmed_by_user_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,line_account_id) DO UPDATE SET liff_id=excluded.liff_id,liff_entry_url=excluded.liff_entry_url,verified_line_login_channel_id=excluded.verified_line_login_channel_id,status=excluded.status,linkage_confirmed_at=excluded.linkage_confirmed_at,linkage_confirmed_by_user_id=excluded.linkage_confirmed_by_user_id,runtime_verified_at=NULL,friendship_verified_at=NULL,updated_at=CURRENT_TIMESTAMP`).bind(configId,workspaceId,account.id,liffId,url.toString(),text(account.line_login_channel_id),'configured',body.linkageConfirmed===true?new Date().toISOString():null,body.linkageConfirmed===true?text(c.get('userId')):null).run();const config:any=await c.env.smart_menu_db.prepare('SELECT * FROM workspace_liff_configs WHERE workspace_id=? AND line_account_id=?').bind(workspaceId,account.id).first();return c.json({success:true,config:publicLiffConfig(config,account)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'LIFF_CONFIG_UPDATE_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/member/establish',async c=>{try{const body:any=await c.req.json();const verified=await verifiedReferralMember(c,body);let referralFlowInvalid=false;const supplied=text(body.referralFlowToken,4096);if(supplied){try{const flow=await verifyReferralFlowToken(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),supplied);if(flow.workspaceId!==verified.account.workspace_id||flow.lineAccountId!==verified.account.id)throw new Error('REFERRAL_FLOW_INVALID');const keys=await referralEventKeys(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),{workspaceId:flow.workspaceId,lineAccountId:flow.lineAccountId,eventType:'LIFF_AUTHENTICATED',flowNonce:supplied});recordReferralAnalyticsEvent(c.env.smart_menu_db,{workspaceId:flow.workspaceId,lineAccountId:flow.lineAccountId,referralIdentityId:flow.referralIdentityId,inviteeMemberId:verified.memberId,eventType:'LIFF_AUTHENTICATED',source:flow.source,dedupeKey:keys.dedupeKey}).catch(()=>{});const memberKeys=await referralEventKeys(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),{workspaceId:flow.workspaceId,lineAccountId:flow.lineAccountId,eventType:'MEMBER_ESTABLISHED',flowNonce:supplied});recordReferralAnalyticsEvent(c.env.smart_menu_db,{workspaceId:flow.workspaceId,lineAccountId:flow.lineAccountId,referralIdentityId:flow.referralIdentityId,inviteeMemberId:verified.memberId,eventType:'MEMBER_ESTABLISHED',source:flow.source,dedupeKey:memberKeys.dedupeKey}).catch(()=>{});}catch{referralFlowInvalid=true}}return c.json({success:true,memberEstablished:true,lineAccountId:verified.account.id,referralFlowInvalid});}catch(e:any){return c.json({success:false,error:['CONFIG_NOT_READY','LIFF_TOKEN_INVALID','LIFF_CLIENT_ID_MISMATCH','LIFF_PROFILE_SCOPE_REQUIRED'].includes(e?.message)?e.message:'MEMBER_ESTABLISHMENT_FAILED'},401)}});
app.get('/api/member/referral',async c=>{try{const verified=await verifiedReferralMember(c,{lineAccountId:text(c.req.query('lineAccountId')),liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')});let identity:any=await c.env.smart_menu_db.prepare(`SELECT * FROM member_referral_identities WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1`).bind(verified.account.workspace_id,verified.account.id,verified.memberId).first();if(!identity){const identityId=`refi_${crypto.randomUUID()}`;for(let attempts=0;attempts<3&&!identity;attempts+=1){const code=referralCode();try{await c.env.smart_menu_db.prepare('INSERT INTO member_referral_identities(id,workspace_id,line_account_id,member_id,referral_code,status) VALUES(?,?,?,?,?,?)').bind(identityId,verified.account.workspace_id,verified.account.id,verified.memberId,code,'active').run();identity={id:identityId,referral_code:code};}catch{identity=await c.env.smart_menu_db.prepare('SELECT * FROM member_referral_identities WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1').bind(verified.account.workspace_id,verified.account.id,verified.memberId).first();}}}if(!identity)throw new Error('REFERRAL_IDENTITY_CREATE_FAILED');const count:any=await c.env.smart_menu_db.prepare("SELECT COUNT(*) qualified_count FROM member_referral_attributions WHERE workspace_id=? AND line_account_id=? AND inviter_member_id=? AND status='qualified'").bind(verified.account.workspace_id,verified.account.id,verified.memberId).first();const entry=text(verified.config.liff_entry_url);return c.json({success:true,referralCode:text(identity.referral_code),referralUrl:referralUrl(entry,text(identity.referral_code),'web_share','/member/referral'),qrValue:referralUrl(entry,text(identity.referral_code),'qr','/member/referral'),shareSources:['qr','line_share','web_share'],qualifiedReferralCount:Number(count?.qualified_count||0)});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.post('/api/referral-growth/recommendations/:ruleCode/explain',async c=>{try{const workspaceId=workspaceIdOf(c),days=referralGrowthPeriod(c.req.query('period')),snapshot=await referralGrowthSnapshot(c.env.smart_menu_db,{workspaceId,days}),ruleCode=text(c.req.param('ruleCode'));const deterministic:any=snapshot.recommendations.find((item:any)=>item.ruleCode===ruleCode&&item.source==='referral_growth');if(!deterministic)return c.json({success:false,error:'RECOMMENDATION_NOT_FOUND'},404);const evidence=[['periodFrom',snapshot.period.from],['periodTo',snapshot.period.to],['periodDays',snapshot.period.days],...Object.entries(snapshot.funnel),...Object.entries(snapshot.rates)].map(([key,value])=>({key,value}));const recommendation:any={id:`referral_${deterministic.ruleCode}`,ruleCode:deterministic.ruleCode,source:'referral_growth',category:'referral_growth',priority:deterministic.priority,tone:deterministic.tone,title:deterministic.title,message:deterministic.message,reason:deterministic.message,evidence,proposal:deterministic.proposal};let providerUsage=extractGeminiUsageMetadata(null),providerRequestId:string|null=null;const metered=await executeMeteredAiCall({db:c.env.smart_menu_db,workspaceId,userId:text(c.get('userId')),featureCode:'referral_growth_recommendation_explanation',operationCode:recommendation.ruleCode,provider:'google',model:GEMINI_MODEL,logger:event=>console.error(JSON.stringify(event)),execute:async()=>{const value=await explainRecommendation(recommendation,{apiKey:c.env.GEMINI_API_KEY,timeoutMs:8000,fetcher:async(request:RequestInfo|URL,init?:RequestInit)=>{const response=await fetch(request,init);providerRequestId=text(response.headers.get('x-request-id'))||null;try{providerUsage=extractGeminiUsageMetadata(await response.clone().json())}catch{providerUsage=extractGeminiUsageMetadata(null)}return response},logger:event=>console.log(JSON.stringify(event))});return {value,status:value.status==='generated'?'success' as const:'fallback' as const,usage:providerUsage,providerRequestId,errorCode:value.status==='generated'?null:'DETERMINISTIC_FALLBACK'}}});return c.json({success:true,recommendation:{id:recommendation.id,ruleCode:recommendation.ruleCode,priority:recommendation.priority,tone:recommendation.tone,title:recommendation.title,message:recommendation.message,proposal:{available:false,reasonCode:'PROPOSAL_NOT_AVAILABLE'}},explanation:metered.value});}catch{return c.json({success:false,error:'REFERRAL_GROWTH_EXPLANATION_UNAVAILABLE'},500)}});app.get('/api/member/referral-growth',async c=>{try{const verified=await verifiedReferralMember(c,{lineAccountId:text(c.req.query('lineAccountId')),liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')});const identity:any=await c.env.smart_menu_db.prepare('SELECT id FROM member_referral_identities WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1').bind(verified.account.workspace_id,verified.account.id,verified.memberId).first();const days=referralGrowthPeriod(c.req.query('period')),base={workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,inviterMemberId:verified.memberId,referralIdentityId:identity?.id};const selected=await referralGrowthSnapshot(c.env.smart_menu_db,{...base,days}),seven=days===7?selected:await referralGrowthSnapshot(c.env.smart_menu_db,{...base,days:7}),thirty=days===30?selected:await referralGrowthSnapshot(c.env.smart_menu_db,{...base,days:30});return c.json({success:true,period:selected.period,qualifiedReferrals:selected.funnel.qualified,qualified7d:seven.funnel.qualified,qualified30d:thirty.funnel.qualified,sourceBreakdown:Object.entries(selected.sourceBreakdown).map(([source,row]:any)=>({source,qualified:row.qualified,landings:row.landings,qualificationRate:row.qualificationRate})),trend:selected.trend});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});app.post('/api/member/referral/qualify',async c=>{try{const body:any=await c.req.json(),verified=await verifiedReferralMember(c,body),landing=parseReferralLanding(new URLSearchParams({ref:text(body.referralCode),src:text(body.src),returnTo:text(body.returnTo)}));const identity:any=await c.env.smart_menu_db.prepare(`SELECT r.*,m.id inviter_member_id FROM member_referral_identities r JOIN line_oa_members m ON m.id=r.member_id AND m.workspace_id=r.workspace_id AND m.line_account_id=r.line_account_id WHERE r.workspace_id=? AND r.line_account_id=? AND r.referral_code=? AND r.status='active' LIMIT 1`).bind(verified.account.workspace_id,verified.account.id,landing.referralCode).first();if(!identity)return c.json({success:true,status:'INVALID_REFERRAL',returnTo:landing.returnTo});if(text(identity.inviter_member_id)===verified.memberId)return c.json({success:true,status:'SELF_REFERRAL_NOT_ALLOWED',returnTo:landing.returnTo});let verifiedReferralFlow:any=null;const supplied=text(body.referralFlowToken,4096);if(supplied){try{const flow=await verifyReferralFlowToken(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),supplied);if(flow.workspaceId===verified.account.workspace_id&&flow.lineAccountId===verified.account.id&&flow.referralIdentityId===identity.id&&flow.source===landing.source)verifiedReferralFlow=flow;}catch{}}const friendshipConfirmed=await backendFriendship(verified.token);if(!friendshipConfirmed){return c.json({success:true,status:'NOT_FRIEND',returnTo:landing.returnTo})}if(verifiedReferralFlow){const friendshipKeys=await referralEventKeys(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),{workspaceId:verifiedReferralFlow.workspaceId,lineAccountId:verifiedReferralFlow.lineAccountId,eventType:'FRIENDSHIP_CONFIRMED',flowNonce:supplied});recordReferralAnalyticsEvent(c.env.smart_menu_db,{workspaceId:verifiedReferralFlow.workspaceId,lineAccountId:verifiedReferralFlow.lineAccountId,referralIdentityId:verifiedReferralFlow.referralIdentityId,inviteeMemberId:verified.memberId,eventType:'FRIENDSHIP_CONFIRMED',source:verifiedReferralFlow.source,dedupeKey:friendshipKeys.dedupeKey}).catch(()=>{})}await c.env.smart_menu_db.prepare('UPDATE workspace_liff_configs SET friendship_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(verified.config.id).run();const attributionId=`refa_${crypto.randomUUID()}`;try{await c.env.smart_menu_db.prepare('INSERT INTO member_referral_attributions(id,workspace_id,line_account_id,invitee_member_id,inviter_member_id,referral_identity_id,source,status) VALUES(?,?,?,?,?,?,?,?)').bind(attributionId,verified.account.workspace_id,verified.account.id,verified.memberId,identity.inviter_member_id,identity.id,landing.source,'qualified').run();recordContributionForTrustedSource(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,eventType:'QUALIFIED_REFERRAL',sourceRef:attributionId}).catch(()=>{});if(verifiedReferralFlow){const qualifiedKeys=await referralEventKeys(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),{workspaceId:verifiedReferralFlow.workspaceId,lineAccountId:verifiedReferralFlow.lineAccountId,eventType:'REFERRAL_QUALIFIED',flowNonce:supplied});recordReferralAnalyticsEvent(c.env.smart_menu_db,{workspaceId:verifiedReferralFlow.workspaceId,lineAccountId:verifiedReferralFlow.lineAccountId,referralIdentityId:verifiedReferralFlow.referralIdentityId,inviterMemberId:identity.inviter_member_id,inviteeMemberId:verified.memberId,eventType:'REFERRAL_QUALIFIED',source:verifiedReferralFlow.source,dedupeKey:qualifiedKeys.dedupeKey}).catch(()=>{})}return c.json({success:true,status:'QUALIFIED',returnTo:landing.returnTo});}catch{return c.json({success:true,status:'ALREADY_QUALIFIED',returnTo:landing.returnTo})}}catch(e:any){return c.json({success:false,error:e?.message==='CONFIG_NOT_READY'?'CONFIG_NOT_READY':'QUALIFICATION_FAILED'},400)}});
app.get('/api/ai-usage/summary', async (c) => {
  try {
    const period = normalizeUsagePeriod(c.req.query('from'), c.req.query('to'));
    const summary = await getWorkspaceAiUsageSummary({
      db: c.env.smart_menu_db,
      workspaceId: workspaceIdOf(c),
      requestingUserId: text(c.get('userId')),
      role: text(c.get('userRole')),
      ...period,
    });
    return c.json({ success: true, summary });
  } catch (error: any) {
    if (error?.message === 'INVALID_USAGE_PERIOD') {
      return c.json({ success: false, error: 'AI 用量查詢期間無效。' }, 400);
    }
    console.error(JSON.stringify({ message: 'workspace ai usage summary failed' }));
    return c.json({ success: false, error: '目前無法取得 AI 用量。' }, 500);
  }
});

app.get('/api/system/ai-usage/summary', async (c) => {
  try {
    await requireSystemAdmin(c);
    const period = normalizeUsagePeriod(c.req.query('from'), c.req.query('to'));
    const summary = await getSystemAiUsageSummary({ db: c.env.smart_menu_db, ...period });
    return c.json({ success: true, summary });
  } catch (error: any) {
    if (error?.message === 'SYSTEM_ADMIN_REQUIRED') {
      return c.json({ success: false, error: '需要 System Admin 權限。' }, 403);
    }
    if (error?.message === 'INVALID_USAGE_PERIOD') {
      return c.json({ success: false, error: 'AI 用量查詢期間無效。' }, 400);
    }
    console.error(JSON.stringify({ message: 'system ai usage summary failed' }));
    return c.json({ success: false, error: '目前無法取得全平台 AI 用量。' }, 500);
  }
});

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function safeExt(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  return ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png';
}

function normalizeAction(action: any) {
  const type = text(action?.type || 'none').toLowerCase();
  if (type === 'uri') return { type, uri: text(action?.uri) };
  if (type === 'message') return { type, text: text(action?.text) };
  if (type === 'postback') return { type, data: text(action?.data), displayText: text(action?.displayText) };
  if (type === 'richmenuswitch') return { type, data: text(action?.data), targetPageId: text(action?.targetPageId) };
  return { type: 'none' };
}

function areaStyle(x: number, y: number, width: number, height: number, imageWidth = 2500, imageHeight = 1686) {
  return richMenuAreaStyle({ x, y, width, height }, imageWidth, imageHeight);
}

function richMenuProjection(width: unknown, height: unknown) {
  const dimensions = resolveRichMenuDimensions(width, height);
  return {
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
    layoutType: classifyRichMenuLayout(dimensions.width, dimensions.height),
  };
}
function buildLineAction(action: any) {
  const normalizedAction: any = normalizeProjectAreaAction(action);
  const type = normalizedAction.type;

  if (type === 'uri') {
    if (!normalizedAction.uri) throw new Error('URI Action 缺少網址');
    return { type: 'uri', uri: normalizedAction.uri };
  }

  if (type === 'message') {
    if (!normalizedAction.text) throw new Error('Message Action 缺少文字');
    return { type: 'message', text: normalizedAction.text };
  }

  if (type === 'postback') {
    if (!normalizedAction.data) throw new Error('Postback Action 缺少 data');
    const result: any = { type: 'postback', data: normalizedAction.data };
    if (normalizedAction.displayText) result.displayText = normalizedAction.displayText;
    return result;
  }

  if (!normalizedAction.richMenuAliasId) {
    throw new Error('Rich Menu Switch 尚未建立目標 Alias');
  }

  return {
    type: 'richmenuswitch',
    richMenuAliasId: normalizedAction.richMenuAliasId,
    data: normalizedAction.data,
  };
}

async function getProjectForPublish(env: Bindings, workspaceId: string, projectId: string) {
  const project: any = await env.smart_menu_db.prepare(`
    SELECT p.*, a.width AS image_width, a.height AS image_height
    FROM projects p
    LEFT JOIN assets a ON a.id = p.asset_id AND a.workspace_id = p.workspace_id
    WHERE p.id = ? AND p.workspace_id = ? AND p.deleted_at IS NULL
    LIMIT 1
  `).bind(projectId, workspaceId).first();

  if (!project) return null;

  const areasResult = await env.smart_menu_db.prepare(`
    SELECT *
    FROM project_areas
    WHERE project_id = ? AND workspace_id = ?
    ORDER BY area_index ASC
  `).bind(projectId, workspaceId).all();

  const areas = (areasResult.results || []).map((row: any) => ({
    id: row.id,
    label: row.label,
    x: num(row.x),
    y: num(row.y),
    width: num(row.width),
    height: num(row.height),
    action: projectAreaActionFromRow(row),
  }));

  return { ...project, areas };
}

async function getProjectImageObject(env: Bindings, workspaceId: string, assetId: string) {
  const asset: any = await env.smart_menu_db.prepare(`
    SELECT *
    FROM assets
    WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
    LIMIT 1
  `).bind(assetId, workspaceId).first();

  if (!asset) throw new Error('專案圖片 Asset 不存在');

  const object = await env.smart_menu_assets.get(asset.storage_key);
  if (!object) throw new Error('R2 找不到專案圖片');

  return { asset, object };
}

function areaInsertStatement(env: Bindings, workspaceId: string, templateId: string, area: any, index: number) {
  const action: any = normalizeAction(area.action);
  const x = Math.max(0, Math.round(num(area.x)));
  const y = Math.max(0, Math.round(num(area.y)));
  const width = Math.max(1, Math.round(num(area.width, 1)));
  const height = Math.max(1, Math.round(num(area.height, 1)));

  return env.smart_menu_db.prepare(`
    INSERT INTO template_areas (
      id, template_id, workspace_id, area_index, label,
      x, y, width, height,
      action_type, action_uri, action_text, action_data, action_display_text, target_page_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    id('area'), templateId, workspaceId, index + 1, text(area.label || `區塊 ${index + 1}`),
    x, y, width, height,
    action.type,
    action.type === 'uri' ? action.uri : null,
    action.type === 'message' ? action.text : null,
    action.type === 'postback' || action.type === 'richmenuswitch' ? action.data : null,
    action.type === 'postback' ? action.displayText : null,
    action.type === 'richmenuswitch' ? action.targetPageId : null,
  );
}

async function ensureAsset(env: Bindings, workspaceId: string, assetId: string) {
  return env.smart_menu_db.prepare(`
    SELECT id, width, height FROM assets
    WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
    LIMIT 1
  `).bind(assetId, workspaceId).first();
}




app.post('/api/auth/logout', async (c) => {
  try {
    const token = bearerToken(c);
    if (token) {
      const tokenHash = await sha256Hex(token);
      await c.env.smart_menu_db.prepare(`
        UPDATE auth_sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE token_hash = ?
          AND revoked_at IS NULL
      `).bind(tokenHash).run();
    }

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || '登出失敗' }, 500);
  }
});

app.post('/api/auth/change-password', async (c) => {
  try {
    const userId = text(c.get('userId'));
    const body: any = await c.req.json();

    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');

    if (newPassword.length < 8) {
      return c.json({
        success: false,
        error: '新密碼至少需要 8 個字元。',
      }, 400);
    }

    const user: any = await c.env.smart_menu_db.prepare(`
      SELECT password_hash, password_salt, password_iterations
      FROM users
      WHERE id = ? AND status = 'active' AND deleted_at IS NULL
      LIMIT 1
    `).bind(userId).first();

    if (!user) {
      return c.json({ success: false, error: '找不到使用者。' }, 404);
    }

    if (user.password_hash && user.password_salt) {
      const ok = await verifyPassword(
        currentPassword,
        user.password_hash,
        user.password_salt,
        Number(user.password_iterations || 210000)
      );

      if (!ok) {
        return c.json({ success: false, error: '目前密碼不正確。' }, 401);
      }
    }

    const passwordRecord = await createPasswordRecord(newPassword);

    await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        UPDATE users
        SET password_hash = ?,
            password_salt = ?,
            password_iterations = ?,
            password_updated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        passwordRecord.hash,
        passwordRecord.salt,
        passwordRecord.iterations,
        userId
      ),
      c.env.smart_menu_db.prepare(`
        UPDATE auth_sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND revoked_at IS NULL
      `).bind(userId),
    ]);

    const session = await issueSession(c.env, userId);

    return c.json({
      success: true,
      token: session.token,
      expiresInDays: session.expiresInDays,
    });
  } catch (e: any) {
    return c.json({
      success: false,
      error: e?.message || '密碼修改失敗',
    }, 500);
  }
});

app.get('/api/auth/me', async (c) => {
  try {
    const userId = text(c.get('userId'));
    const workspaceId = workspaceIdOf(c);

    const user: any = await c.env.smart_menu_db.prepare(`
      SELECT id, line_user_id, email, display_name, status, is_system_admin, created_at, updated_at
      FROM users
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(userId).first();

    const memberships = await c.env.smart_menu_db.prepare(`
      SELECT
        wm.workspace_id,
        wm.role,
        wm.status,
        w.name AS workspace_name,
        w.slug AS workspace_slug
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
        AND wm.status = 'active'
        AND w.status = 'active'
        AND w.deleted_at IS NULL
      ORDER BY wm.created_at ASC
    `).bind(userId).all();

    return c.json({
      success: true,
      user,
      activeWorkspaceId: workspaceId,
      activeRole: c.get('userRole'),
      memberships: memberships.results || [],
    });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || '使用者資料讀取失敗' }, 500);
  }
});

app.get('/api/members', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);

    const result = await c.env.smart_menu_db.prepare(`
      SELECT
        wm.id AS membership_id,
        wm.role,
        wm.status,
        wm.created_at,
        u.id AS user_id,
        u.line_user_id,
        u.email,
        u.display_name,
        u.status AS user_status
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ?
      ORDER BY
        CASE wm.role
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'editor' THEN 3
          ELSE 4
        END,
        wm.created_at ASC
    `).bind(workspaceId).all();

    return c.json({ success: true, members: result.results || [] });
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '成員查詢失敗' }, 500);
  }
});

app.post('/api/members', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const body: any = await c.req.json();

    const displayName = text(body.displayName);
    const username = text(body.username).toLowerCase();
    const email = text(body.email).toLowerCase();
    const lineUserId = text(body.lineUserId);
    const initialPassword = String(body.password || '');
    const role = text(body.role || 'editor').toLowerCase();

    if (!['viewer', 'editor', 'admin'].includes(role)) {
      return c.json({ success: false, error: '可新增角色僅限 viewer / editor / admin。' }, 400);
    }
    if (!username && !email) {
      return c.json({ success: false, error: '至少需要帳號或 Email。' }, 400);
    }

    let user: any = null;

    if (username) {
      user = await c.env.smart_menu_db.prepare(`
        SELECT * FROM users WHERE lower(username) = ? AND deleted_at IS NULL LIMIT 1
      `).bind(username).first();
    }

    if (!user && lineUserId) {
      user = await c.env.smart_menu_db.prepare(`
        SELECT * FROM users WHERE line_user_id = ? AND deleted_at IS NULL LIMIT 1
      `).bind(lineUserId).first();
    }

    if (!user && email) {
      user = await c.env.smart_menu_db.prepare(`
        SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1
      `).bind(email).first();
    }

    const userId = user?.id || id('usr');

    const statements: D1PreparedStatement[] = [];

    if (!user) {
      if (initialPassword.length < 8) {
        return c.json({
          success: false,
          error: '新成員初始密碼至少需要 8 個字元。',
        }, 400);
      }

      const passwordRecord = await createPasswordRecord(initialPassword);

      statements.push(
        c.env.smart_menu_db.prepare(`
          INSERT INTO users (
            id, username, line_user_id, email, display_name,
            password_hash, password_salt, password_iterations,
            password_updated_at,
            status, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            CURRENT_TIMESTAMP,
            'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `).bind(
          userId,
          username || null,
          lineUserId || null,
          email || null,
          displayName || 'New Member',
          passwordRecord.hash,
          passwordRecord.salt,
          passwordRecord.iterations
        )
      );
    }

    const existingMembership = await c.env.smart_menu_db.prepare(`
      SELECT id
      FROM workspace_members
      WHERE workspace_id = ? AND user_id = ?
      LIMIT 1
    `).bind(workspaceId, userId).first();

    if (existingMembership) {
      return c.json({ success: false, error: '此使用者已是 Workspace 成員。' }, 409);
    }

    const membershipId = id('wsm');

    statements.push(
      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_members (
          id, workspace_id, user_id, role, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(membershipId, workspaceId, userId, role)
    );

    await c.env.smart_menu_db.batch(statements);

    return c.json({
      success: true,
      member: {
        membershipId,
        userId,
        workspaceId,
        role,
      },
    });
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '新增成員失敗' }, 500);
  }
});

app.patch('/api/members/:membershipId', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const membershipId = c.req.param('membershipId');
    const body: any = await c.req.json();
    const role = text(body.role).toLowerCase();
    const status = text(body.status || 'active').toLowerCase();

    if (!['viewer', 'editor', 'admin'].includes(role)) {
      return c.json({ success: false, error: '角色僅限 viewer / editor / admin。' }, 400);
    }
    if (!['active', 'disabled'].includes(status)) {
      return c.json({ success: false, error: 'status 僅限 active / disabled。' }, 400);
    }

    const membership: any = await c.env.smart_menu_db.prepare(`
      SELECT role
      FROM workspace_members
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).bind(membershipId, workspaceId).first();

    if (!membership) {
      return c.json({ success: false, error: '找不到成員。' }, 404);
    }
    if (membership.role === 'owner') {
      return c.json({ success: false, error: 'Owner 不可透過此 API 修改。' }, 400);
    }

    await c.env.smart_menu_db.prepare(`
      UPDATE workspace_members
      SET role = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).bind(role, status, membershipId, workspaceId).run();

    return c.json({ success: true });
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '成員更新失敗' }, 500);
  }
});

app.delete('/api/members/:membershipId', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const membershipId = c.req.param('membershipId');

    const membership: any = await c.env.smart_menu_db.prepare(`
      SELECT role
      FROM workspace_members
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).bind(membershipId, workspaceId).first();

    if (!membership) {
      return c.json({ success: false, error: '找不到成員。' }, 404);
    }
    if (membership.role === 'owner') {
      return c.json({ success: false, error: 'Owner 不可刪除。' }, 400);
    }

    await c.env.smart_menu_db.prepare(`
      DELETE FROM workspace_members
      WHERE id = ? AND workspace_id = ?
    `).bind(membershipId, workspaceId).run();

    return c.json({ success: true, deleted: membershipId });
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '移除成員失敗' }, 500);
  }
});

app.get('/api/workspace', async (c) => {
  try {
    const workspaceId = workspaceIdOf(c);
    const workspace: any = await c.env.smart_menu_db.prepare(`
      SELECT id, name, slug, status, plan, created_at, updated_at
      FROM workspaces
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(workspaceId).first();

    if (!workspace) {
      return c.json({
        success: false,
        error: '目前 workspace 不存在。',
      }, 404);
    }

    return c.json({
      success: true,
      workspace,
      actor: {
        userId: c.get('userId'),
        role: c.get('userRole'),
      },
    });
  } catch (e: any) {
    return c.json({
      success: false,
      error: e?.message || 'Workspace 查詢失敗',
    }, 500);
  }
});

app.get('/', (c) => c.json({
  success: true,
  service: 'Smart Menu API',
  version: '2.6.0',
  aiProvider: 'Gemini',
  storage: 'Cloudflare R2',
  database: 'Cloudflare D1',
}));

app.get('/health', async (c) => {
  try {
    await c.env.smart_menu_db.prepare('SELECT 1').first();
    return c.json({ success: true, status: 'ok', aiProvider: 'Gemini', d1: 'connected', r2: 'bound' });
  } catch (e: any) {
    return c.json({ success: false, status: 'error', error: e?.message || 'Health check failed' }, 500);
  }
});

app.post('/api/detect-layout', async (c) => {
  try {
    const body = await c.req.parseBody();
    const image = body.image;
    if (!image || typeof image === 'string' || !(image instanceof File)) {
      return c.json({ success: false, error: '請提供有效的圖片檔案。' }, 400);
    }
    if (!['image/png', 'image/jpeg'].includes(image.type)) {
      return c.json({ success: false, error: 'LINE Rich Menu 圖片只支援 PNG、JPG。' }, 400);
    }
    if (image.size > 1024 * 1024) {
      return c.json({ success: false, error: 'LINE Rich Menu 圖片不可超過 1MB。' }, 400);
    }
    if (!c.env.GEMINI_API_KEY) {
      return c.json(geminiProviderNotConfiguredResponse(), 503);
    }

    const imageBuffer = await image.arrayBuffer();
    let dimensions;
    try {
      dimensions = readImageDimensions(imageBuffer, image.type || 'image/png');
      validateRichMenuImageDimensions(dimensions.width, dimensions.height);
    } catch {
      return c.json({ success: false, error: '圖片尺寸不符合 LINE Rich Menu 規格，或無法讀取圖片尺寸。' }, 400);
    }
    const { width: imageWidth, height: imageHeight } = dimensions;
    const layoutType = classifyRichMenuLayout(imageWidth, imageHeight);
    const base64Image = arrayBufferToBase64(imageBuffer);
    const mimeType = image.type || 'image/png';
    const prompt = '你是一個 LINE 官方帳號 Rich Menu 專業座標分析器。這張圖片的實際尺寸是 '
      + imageWidth + 'x' + imageHeight + '。請直接在這個像素座標系統中分析可點擊功能區塊：x 範圍 0..'
      + (imageWidth - 1) + '，y 範圍 0..' + (imageHeight - 1)
      + '。每個區塊回傳 id,label,x,y,width,height。座標使用整數，區塊不得超出圖片邊界或互相重疊，最多 20 個區塊，label 使用繁體中文。'
      + '不要推測、縮放或改用其他畫布尺寸。只輸出符合 JSON Schema 的資料。';

    const geminiCall = await executeMeteredAiCall({
      db: c.env.smart_menu_db,
      workspaceId: workspaceIdOf(c),
      userId: text(c.get('userId')),
      featureCode: 'rich_menu_image_analysis',
      operationCode: 'detect_layout',
      provider: 'google',
      model: GEMINI_MODEL,
      execute: async () => {
        const response = await requestGeminiContent({
          apiKey: c.env.GEMINI_API_KEY,
          body: {
            contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  areas: {
                    type: 'ARRAY',
                    maxItems: 20,
                    items: {
                      type: 'OBJECT',
                      properties: {
                        id: { type: 'INTEGER' }, label: { type: 'STRING' },
                        x: { type: 'INTEGER' }, y: { type: 'INTEGER' },
                        width: { type: 'INTEGER' }, height: { type: 'INTEGER' },
                      },
                      required: ['id', 'label', 'x', 'y', 'width', 'height'],
                    },
                  },
                },
                required: ['areas'],
              },
            },
          },
        });
        const result: any = await response.json();
        return {
          value: { ok: response.ok, result },
          status: response.ok ? 'success' as const : 'failed' as const,
          usage: extractGeminiUsageMetadata(result),
          providerRequestId: text(response.headers.get('x-request-id')) || null,
          errorCode: response.ok ? null : text(result?.error?.status || 'GEMINI_REQUEST_FAILED'),
        };
      },
    });
    const result: any = geminiCall.result;
    if (!geminiCall.ok) return c.json({ success: false, error: result?.error?.message || 'Gemini API 呼叫失敗' }, 500);

    const outputText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outputText) throw new Error('Gemini 沒有回傳辨識結果');
    const parsed = JSON.parse(outputText);
    if (!Array.isArray(parsed.areas)) throw new Error('Gemini 回傳資料缺少 areas');

    const areas = normalizeDetectedRichMenuAreas(parsed.areas, imageWidth, imageHeight);
    return c.json({
      success: true,
      provider: 'gemini',
      model: GEMINI_MODEL,
      imageWidth,
      imageHeight,
      layoutType,
      areas,
    });
  } catch (e: any) {
    console.error('detect-layout:', e);
    return c.json({ success: false, error: e?.message || 'Gemini 圖片辨識失敗' }, 500);
  }
});
app.post('/api/templates/upload-image', async (c) => {
  try {
    const body = await c.req.parseBody();
    const image = body.image;
    if (!image || typeof image === 'string' || !(image instanceof File)) {
      return c.json({ success: false, error: '請提供圖片檔案。' }, 400);
    }
    if (!['image/png', 'image/jpeg'].includes(image.type)) {
      return c.json({ success: false, error: 'LINE Rich Menu 圖片只支援 PNG、JPG。' }, 400);
    }
    if (image.size > 1024 * 1024) return c.json({ success: false, error: 'LINE Rich Menu 圖片不可超過 1MB。' }, 400);

    const imageBuffer = await image.arrayBuffer();
    let dimensions;
    try {
      dimensions = readImageDimensions(imageBuffer, image.type);
      validateRichMenuImageDimensions(dimensions.width, dimensions.height);
    } catch {
      return c.json({ success: false, error: '圖片尺寸不符合 LINE Rich Menu 規格，或無法讀取圖片尺寸。' }, 400);
    }

    const assetId = id('asset');
    const storageKey = 'templates/' + workspaceIdOf(c) + '/' + assetId + '/image.' + safeExt(image.name);
    await c.env.smart_menu_assets.put(storageKey, imageBuffer, {
      httpMetadata: { contentType: image.type || 'image/png' },
      customMetadata: { assetId, workspaceId: workspaceIdOf(c) },
    });
    await c.env.smart_menu_db.prepare(
      "INSERT INTO assets (id, workspace_id, storage_key, original_filename, content_type, size_bytes, width, height, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')"
    ).bind(
      assetId,
      workspaceIdOf(c),
      storageKey,
      image.name,
      image.type || 'image/png',
      image.size,
      dimensions.width,
      dimensions.height,
    ).run();

    return c.json({
      success: true,
      asset: {
        id: assetId,
        storageKey,
        imageUrl: '/api/assets/' + assetId,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        layoutType: classifyRichMenuLayout(dimensions.width, dimensions.height),
      },
    });
  } catch (e: any) {
    console.error('upload-image:', e);
    return c.json({ success: false, error: e?.message || '圖片上傳失敗' }, 500);
  }
});
app.get('/api/assets/:assetId', async (c) => {
  try {
    const asset: any = await c.env.smart_menu_db.prepare(`
      SELECT * FROM assets WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1
    `).bind(c.req.param('assetId'), workspaceIdOf(c)).first();
    if (!asset) return c.json({ success: false, error: '找不到圖片。' }, 404);

    const object = await c.env.smart_menu_assets.get(asset.storage_key);
    if (!object) return c.json({ success: false, error: 'R2 找不到圖片。' }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=3600');
    return new Response(object.body, { headers });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || '圖片讀取失敗' }, 500);
  }
});

app.post('/api/templates', async (c) => {
  try {
    const body: any = await c.req.json();
    const name = text(body.name);
    const assetId = text(body.assetId);
    const areas = Array.isArray(body.areas) ? body.areas : [];
    if (!name) return c.json({ success: false, error: '模板名稱不可空白。' }, 400);
    const asset: any = assetId ? await ensureAsset(c.env, workspaceIdOf(c), assetId) : null;
    if (!asset) return c.json({ success: false, error: '模板圖片 Asset 不存在。' }, 400);
    const dimensions = resolveRichMenuDimensions(asset.width, asset.height);
    let validatedAreas;
    try {
      validateRichMenuImageDimensions(dimensions.width, dimensions.height);
      validatedAreas = validateRichMenuAreas(areas, dimensions.width, dimensions.height);
    } catch {
      return c.json({ success: false, error: '模板圖片尺寸或熱區座標不符合 LINE Rich Menu 規格。' }, 400);
    }

    const templateId = id('tpl');
    const statements: D1PreparedStatement[] = [
      c.env.smart_menu_db.prepare(`
        INSERT INTO templates (
          id, workspace_id, name, industry, status, asset_id, area_count, page_count, ai_provider, ai_model, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        templateId, workspaceIdOf(c), name, text(body.industry || '待分類'), text(body.status || 'draft'), assetId,
        validatedAreas.length, Math.max(1, Math.round(num(body.pageCount, 1))), text(body.aiProvider || 'gemini'), text(body.aiModel || 'gemini-3.6-flash')
      ),
      ...validatedAreas.map((area: any, index: number) => areaInsertStatement(c.env, workspaceIdOf(c), templateId, area, index)),
    ];
    await c.env.smart_menu_db.batch(statements);
    return c.json({ success: true, template: { id: templateId, name, assetId, areaCount: validatedAreas.length, imageWidth: dimensions.width, imageHeight: dimensions.height, layoutType: classifyRichMenuLayout(dimensions.width, dimensions.height), imageUrl: `/api/assets/${assetId}` } });
  } catch (e: any) {
    console.error('create-template:', e);
    return c.json({ success: false, error: e?.message || '模板建立失敗' }, 500);
  }
});

app.patch('/api/templates/:templateId', async (c) => {
  try {
    const templateId = c.req.param('templateId');
    const existing = await c.env.smart_menu_db.prepare(`
      SELECT id FROM templates WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1
    `).bind(templateId, workspaceIdOf(c)).first();
    if (!existing) return c.json({ success: false, error: '找不到模板。' }, 404);

    const body: any = await c.req.json();
    const name = text(body.name);
    const assetId = text(body.assetId);
    const areas = Array.isArray(body.areas) ? body.areas : [];
    if (!name) return c.json({ success: false, error: '模板名稱不可空白。' }, 400);
    const asset: any = assetId ? await ensureAsset(c.env, workspaceIdOf(c), assetId) : null;
    if (!asset) return c.json({ success: false, error: '模板圖片 Asset 不存在。' }, 400);
    const dimensions = resolveRichMenuDimensions(asset.width, asset.height);
    let validatedAreas;
    try {
      validateRichMenuImageDimensions(dimensions.width, dimensions.height);
      validatedAreas = validateRichMenuAreas(areas, dimensions.width, dimensions.height);
    } catch {
      return c.json({ success: false, error: '模板圖片尺寸或熱區座標不符合 LINE Rich Menu 規格。' }, 400);
    }

    const statements: D1PreparedStatement[] = [
      c.env.smart_menu_db.prepare(`
        UPDATE templates SET
          name = ?, industry = ?, status = ?, asset_id = ?, area_count = ?, page_count = ?,
          ai_provider = ?, ai_model = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).bind(
        name, text(body.industry || '待分類'), text(body.status || 'draft'), assetId, validatedAreas.length,
        Math.max(1, Math.round(num(body.pageCount, 1))), text(body.aiProvider || 'gemini'), text(body.aiModel || 'gemini-3.6-flash'),
        templateId, workspaceIdOf(c)
      ),
      c.env.smart_menu_db.prepare(`DELETE FROM template_areas WHERE template_id = ? AND workspace_id = ?`).bind(templateId, workspaceIdOf(c)),
      ...validatedAreas.map((area: any, index: number) => areaInsertStatement(c.env, workspaceIdOf(c), templateId, area, index)),
    ];
    await c.env.smart_menu_db.batch(statements);
    return c.json({ success: true, template: { id: templateId, name, assetId, areaCount: validatedAreas.length, imageWidth: dimensions.width, imageHeight: dimensions.height, layoutType: classifyRichMenuLayout(dimensions.width, dimensions.height), imageUrl: `/api/assets/${assetId}` } });
  } catch (e: any) {
    console.error('update-template:', e);
    return c.json({ success: false, error: e?.message || '模板更新失敗' }, 500);
  }
});

app.delete('/api/templates/:templateId', async (c) => {
  try {
    const templateId = c.req.param('templateId');
    const result = await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`UPDATE templates SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).bind(templateId, workspaceIdOf(c)),
      c.env.smart_menu_db.prepare(`DELETE FROM template_areas WHERE template_id = ? AND workspace_id = ?`).bind(templateId, workspaceIdOf(c)),
    ]);
    return c.json({ success: true, deleted: templateId, result: result[0]?.meta ?? null });
  } catch (e: any) {
    console.error('delete-template:', e);
    return c.json({ success: false, error: e?.message || '模板刪除失敗' }, 500);
  }
});


// =====================================================
// System Template Center V2.1
// System Admin can inspect templates across all workspaces.
// Tenant /api/templates remains strictly workspace-scoped.
// =====================================================

app.get('/api/system/templates', async (c) => {
  const startedAt = Date.now();

  try {
    await requireSystemAdmin(c);

    const result = await c.env.smart_menu_db.prepare(`
      SELECT
        t.id,
        t.workspace_id,
        w.name AS workspace_name,
        w.slug AS workspace_slug,
        t.name,
        t.industry,
        t.status,
        t.asset_id,
        t.area_count,
        t.page_count,
        t.ai_provider,
        t.ai_model,
        t.created_at,
        t.updated_at,
        a.width AS image_width,
        a.height AS image_height
      FROM templates t
      LEFT JOIN assets a ON a.id = t.asset_id AND a.workspace_id = t.workspace_id
      JOIN workspaces w
        ON w.id = t.workspace_id
       AND w.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
      ORDER BY t.updated_at DESC, t.created_at DESC
    `).all();

    const templates = (result.results || []).map((row: any) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      workspaceSlug: row.workspace_slug,
      name: row.name,
      industry: row.industry,
      status: row.status,
      assetId: row.asset_id,
      areaCount: row.area_count,
      pageCount: row.page_count,
      aiProvider: row.ai_provider,
      aiModel: row.ai_model,
      ...richMenuProjection(row.image_width, row.image_height),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      imageUrl: row.asset_id ? `/api/system/assets/${row.asset_id}` : null,
    }));

    c.header('Server-Timing', `db;dur=${Date.now() - startedAt}`);
    c.header('Cache-Control', 'private, max-age=5');

    return c.json({
      success: true,
      templates,
      performance: { serverMs: Date.now() - startedAt },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        error: e?.message === 'SYSTEM_ADMIN_REQUIRED'
          ? '需要系統管理員權限。'
          : (e?.message || '全租戶模板查詢失敗'),
      },
      e?.message === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500
    );
  }
});

app.get('/api/system/templates/:templateId', async (c) => {
  try {
    await requireSystemAdmin(c);
    const templateId = text(c.req.param('templateId'));

    const result = await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        SELECT
          t.*,
          w.name AS workspace_name,
          w.slug AS workspace_slug,
          a.width AS image_width,
          a.height AS image_height
        FROM templates t
        LEFT JOIN assets a ON a.id = t.asset_id AND a.workspace_id = t.workspace_id
        JOIN workspaces w
          ON w.id = t.workspace_id
         AND w.deleted_at IS NULL
        WHERE t.id = ?
          AND t.deleted_at IS NULL
        LIMIT 1
      `).bind(templateId),

      c.env.smart_menu_db.prepare(`
        SELECT *
        FROM template_areas
        WHERE template_id = ?
        ORDER BY area_index ASC
      `).bind(templateId),
    ]);

    const template: any = result[0]?.results?.[0] || null;
    if (!template) {
      return c.json({ success: false, error: '找不到模板。' }, 404);
    }

    const areas = (result[1]?.results || []).map((row: any) => ({
      id: row.id,
      areaIndex: row.area_index,
      label: row.label,
      x: num(row.x),
      y: num(row.y),
      width: num(row.width),
      height: num(row.height),
      actionType: row.action_type || 'none',
      actionUri: row.action_uri || '',
      actionText: row.action_text || '',
      actionData: row.action_data || '',
      actionDisplayText: row.action_display_text || '',
      targetPageId: row.target_page_id || '',
    }));

    return c.json({
      success: true,
      template: {
        id: template.id,
        workspaceId: template.workspace_id,
        workspaceName: template.workspace_name,
        workspaceSlug: template.workspace_slug,
        name: template.name,
        industry: template.industry,
        status: template.status,
        assetId: template.asset_id,
        areaCount: template.area_count,
        pageCount: template.page_count,
        aiProvider: template.ai_provider,
        aiModel: template.ai_model,
        ...richMenuProjection(template.image_width, template.image_height),
        createdAt: template.created_at,
        updatedAt: template.updated_at,
        imageUrl: template.asset_id ? `/api/system/assets/${template.asset_id}` : null,
        areas,
      },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        error: e?.message === 'SYSTEM_ADMIN_REQUIRED'
          ? '需要系統管理員權限。'
          : (e?.message || '模板讀取失敗'),
      },
      e?.message === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500
    );
  }
});

app.get('/api/system/assets/:assetId', async (c) => {
  try {
    await requireSystemAdmin(c);

    const asset: any = await c.env.smart_menu_db.prepare(`
      SELECT id, workspace_id, storage_key, mime_type
      FROM assets
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `).bind(text(c.req.param('assetId'))).first();

    if (!asset) {
      return c.json({ success: false, error: '找不到圖片。' }, 404);
    }

    const object = await c.env.smart_menu_assets.get(asset.storage_key);
    if (!object) {
      return c.json({ success: false, error: 'R2 找不到圖片。' }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'private, max-age=3600');

    return new Response(object.body, { headers });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        error: e?.message === 'SYSTEM_ADMIN_REQUIRED'
          ? '需要系統管理員權限。'
          : (e?.message || '圖片讀取失敗'),
      },
      e?.message === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500
    );
  }
});


app.get('/api/templates', async (c) => {
  try {
    const result = await c.env.smart_menu_db.prepare(`
      SELECT t.id, t.name, t.industry, t.status, t.asset_id, t.area_count, t.page_count,
             t.ai_provider, t.ai_model, t.created_at, t.updated_at,
             a.width AS image_width, a.height AS image_height
      FROM templates t
      LEFT JOIN assets a ON a.id = t.asset_id AND a.workspace_id = t.workspace_id
      WHERE t.workspace_id = ? AND t.deleted_at IS NULL
      ORDER BY t.updated_at DESC, t.created_at DESC
    `).bind(workspaceIdOf(c)).all();

    const templates = (result.results || []).map((row: any) => ({
      id: row.id, name: row.name, industry: row.industry, status: row.status,
      assetId: row.asset_id, areaCount: row.area_count, pageCount: row.page_count,
      aiProvider: row.ai_provider, aiModel: row.ai_model,
      ...richMenuProjection(row.image_width, row.image_height),
      createdAt: row.created_at, updatedAt: row.updated_at,
      imageUrl: row.asset_id ? `/api/assets/${row.asset_id}` : null,
    }));
    return c.json({ success: true, templates });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || '模板查詢失敗' }, 500);
  }
});

app.get('/api/templates/:templateId', async (c) => {
  try {
    const templateId = c.req.param('templateId');
    const template: any = await c.env.smart_menu_db.prepare(`
      SELECT t.*, a.width AS image_width, a.height AS image_height FROM templates t
      LEFT JOIN assets a ON a.id = t.asset_id AND a.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ? AND t.deleted_at IS NULL LIMIT 1
    `).bind(templateId, workspaceIdOf(c)).first();
    if (!template) return c.json({ success: false, error: '找不到模板。' }, 404);

    const areaResult = await c.env.smart_menu_db.prepare(`
      SELECT * FROM template_areas WHERE template_id = ? AND workspace_id = ? ORDER BY area_index ASC
    `).bind(templateId, workspaceIdOf(c)).all();

    const dimensions = resolveRichMenuDimensions(template.image_width, template.image_height);
    const areas = (areaResult.results || []).map((row: any) => {
      const action: any = { type: row.action_type || 'none' };
      if (action.type === 'uri') action.uri = row.action_uri || '';
      if (action.type === 'message') action.text = row.action_text || '';
      if (action.type === 'postback') { action.data = row.action_data || ''; action.displayText = row.action_display_text || ''; }
      if (action.type === 'richmenuswitch') { action.data = row.action_data || ''; action.targetPageId = row.target_page_id || ''; }
      const x = num(row.x), y = num(row.y), width = num(row.width), height = num(row.height);
      return { id: row.area_index, areaId: row.id, label: row.label, x, y, width, height, action, style: areaStyle(x, y, width, height, dimensions.width, dimensions.height) };
    });

    return c.json({
      success: true,
      template: {
        id: template.id, name: template.name, industry: template.industry, status: template.status,
        assetId: template.asset_id, areaCount: template.area_count, pageCount: template.page_count,
        aiProvider: template.ai_provider, aiModel: template.ai_model,
        ...richMenuProjection(dimensions.width, dimensions.height),
        imageUrl: template.asset_id ? `/api/assets/${template.asset_id}` : null,
        areas,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || '模板讀取失敗' }, 500);
  }
});



// =====================================================
// Project Builder V1
// 建立專案時複製模板快照，不持續引用母版 areas
// =====================================================

function projectAreaInsertStatement(env: Bindings, workspaceId: string, projectId: string, area: any, index: number) {
  const action: any = normalizeProjectAreaAction(area);
  const x = Math.max(0, Math.round(num(area.x)));
  const y = Math.max(0, Math.round(num(area.y)));
  const width = Math.max(1, Math.round(num(area.width, 1)));
  const height = Math.max(1, Math.round(num(area.height, 1)));

  return env.smart_menu_db.prepare(`
    INSERT INTO project_areas (
      id, project_id, workspace_id, area_index, label,
      x, y, width, height,
      action_type, action_uri, action_text, action_data, action_display_text, target_page_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    id('parea'), projectId, workspaceId, index + 1, text(area.label || `區塊 ${index + 1}`),
    x, y, width, height,
    action.type,
    action.type === 'uri' ? action.uri : null,
    action.type === 'message' ? action.text : null,
    action.type === 'postback' || action.type === 'richmenuswitch' ? action.data : null,
    action.type === 'postback' ? action.displayText : null,
    action.type === 'richmenuswitch' ? action.targetPageId : null,
  );
}

app.post('/api/projects/from-template', async (c) => {
  try {
    const body: any = await c.req.json();
    const templateId = text(body.templateId);
    if (!templateId) {
      return c.json({ success: false, error: 'templateId 不可空白。' }, 400);
    }

    const template: any = await c.env.smart_menu_db.prepare(`
      SELECT t.*, a.width AS image_width, a.height AS image_height
      FROM templates t
      LEFT JOIN assets a ON a.id = t.asset_id AND a.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ? AND t.deleted_at IS NULL
      LIMIT 1
    `).bind(templateId, workspaceIdOf(c)).first();

    if (!template) {
      return c.json({ success: false, error: '找不到指定模板。' }, 404);
    }

    const areaResult = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM template_areas
      WHERE template_id = ? AND workspace_id = ?
      ORDER BY area_index ASC
    `).bind(templateId, workspaceIdOf(c)).all();

    const sourceAreas = (areaResult.results || []).map((row: any) => ({
      label: row.label,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      action: {
        type: row.action_type || 'none',
        uri: row.action_uri || '',
        text: row.action_text || '',
        data: row.action_data || '',
        displayText: row.action_display_text || '',
        targetPageId: row.target_page_id || '',
      },
    }));

    if (!sourceAreas.length) {
      return c.json({ success: false, error: '此模板沒有可複製的熱區。' }, 400);
    }

    const projectId = id('prj');
    const projectName = text(body.name) || `${template.name} - 新專案`;

    const statements: D1PreparedStatement[] = [
      c.env.smart_menu_db.prepare(`
        INSERT INTO projects (
          id, workspace_id, template_id, name, status, asset_id, page_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        projectId,
        workspaceIdOf(c),
        templateId,
        projectName,
        template.asset_id,
        Math.max(1, Math.round(num(template.page_count, 1))),
      ),
      ...sourceAreas.map((area: any, index: number) =>
        projectAreaInsertStatement(c.env, workspaceIdOf(c), projectId, area, index)
      ),
    ];

    await c.env.smart_menu_db.batch(statements);

    return c.json({
      success: true,
      project: {
        id: projectId,
        templateId,
        name: projectName,
        status: 'draft',
        assetId: template.asset_id,
        areaCount: sourceAreas.length,
        pageCount: Math.max(1, Math.round(num(template.page_count, 1))),
        ...richMenuProjection(template.image_width, template.image_height),
        imageUrl: template.asset_id ? `/api/assets/${template.asset_id}` : null,
      },
    });
  } catch (e: any) {
    console.error('create-project-from-template:', e);
    return c.json({ success: false, error: e?.message || '從模板建立專案失敗' }, 500);
  }
});

app.get('/api/projects', async (c) => {
  try {
    const result = await c.env.smart_menu_db.prepare(`
      SELECT
        p.id, p.template_id, p.name, p.status, p.asset_id, p.page_count,
        p.created_at, p.updated_at,
        a.width AS image_width, a.height AS image_height,
        COUNT(pa.id) AS area_count
      FROM projects p
      LEFT JOIN assets a ON a.id = p.asset_id AND a.workspace_id = p.workspace_id
      LEFT JOIN project_areas pa
        ON pa.project_id = p.id AND pa.workspace_id = p.workspace_id
      WHERE p.workspace_id = ? AND p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.created_at DESC
    `).bind(workspaceIdOf(c)).all();

    const projects = (result.results || []).map((row: any) => ({
      id: row.id,
      richMenuAliasId: richMenuAliasIdForProject(row.id),
      templateId: row.template_id,
      name: row.name,
      status: row.status,
      assetId: row.asset_id,
      pageCount: row.page_count,
      areaCount: row.area_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...richMenuProjection(row.image_width, row.image_height),
      imageUrl: row.asset_id ? `/api/assets/${row.asset_id}` : null,
      isDefault: row.status === 'default',
      disabled: row.status === 'disabled',
    }));

    return c.json({ success: true, projects });
  } catch (e: any) {
    console.error('list-projects:', e);
    return c.json({ success: false, error: e?.message || '專案查詢失敗' }, 500);
  }
});



app.post('/api/projects/:projectId/upload-image', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);

    const project: any = await c.env.smart_menu_db.prepare(`
      SELECT id, asset_id
      FROM projects
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(projectId, workspaceId).first();

    if (!project) {
      return c.json({ success: false, error: '找不到專案。' }, 404);
    }

    const body = await c.req.parseBody();
    const image = body.image;

    if (!image || typeof image === 'string' || !(image instanceof File)) {
      return c.json({ success: false, error: '請提供圖片檔案。' }, 400);
    }

    if (!['image/png', 'image/jpeg'].includes(image.type)) {
      return c.json({ success: false, error: 'LINE Rich Menu 圖片只支援 PNG、JPG。' }, 400);
    }

    if (image.size > 1024 * 1024) {
      return c.json({ success: false, error: 'LINE Rich Menu 圖片不可超過 1MB。' }, 400);
    }

    const imageBuffer = await image.arrayBuffer();
    let dimensions;
    try {
      dimensions = readImageDimensions(imageBuffer, image.type);
      validateRichMenuImageDimensions(dimensions.width, dimensions.height);
      const existingAreas = await c.env.smart_menu_db.prepare(
        'SELECT x, y, width, height FROM project_areas WHERE project_id = ? AND workspace_id = ? ORDER BY area_index ASC'
      ).bind(projectId, workspaceId).all();
      if ((existingAreas.results || []).length) {
        validateRichMenuAreas(existingAreas.results || [], dimensions.width, dimensions.height);
      }
    } catch {
      return c.json({ success: false, error: '圖片尺寸不符合 LINE Rich Menu 規格，或既有熱區超出新圖片邊界。' }, 400);
    }
    const assetId = id('asset');
    const storageKey = `projects/${workspaceIdOf(c)}/${projectId}/${assetId}/image.${safeExt(image.name)}`;

    await c.env.smart_menu_assets.put(
      storageKey,
      imageBuffer,
      {
        httpMetadata: { contentType: image.type || 'image/png' },
        customMetadata: {
          assetId,
          workspaceId: workspaceIdOf(c),
          projectId,
        },
      }
    );

    await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        INSERT INTO assets (
          id, workspace_id, storage_key, original_filename, content_type, size_bytes, width, height, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')
      `).bind(
        assetId,
        workspaceIdOf(c),
        storageKey,
        image.name,
        image.type || 'image/png',
        image.size,
        dimensions.width,
        dimensions.height
      ),

      c.env.smart_menu_db.prepare(`
        UPDATE projects
        SET asset_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).bind(assetId, projectId, workspaceIdOf(c)),
    ]);

    return c.json({
      success: true,
      asset: {
        id: assetId,
        storageKey,
        imageUrl: `/api/assets/${assetId}`,
      },
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
      layoutType: classifyRichMenuLayout(dimensions.width, dimensions.height),
      previousAssetId: project.asset_id || null,
    });
  } catch (e: any) {
    console.error('project-upload-image:', e);
    return c.json({ success: false, error: e?.message || '專案圖片更新失敗' }, 500);
  }
});

app.patch('/api/projects/:projectId', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);

    const existing: any = await c.env.smart_menu_db.prepare(`
      SELECT p.id, a.width AS image_width, a.height AS image_height
      FROM projects p
      LEFT JOIN assets a ON a.id = p.asset_id AND a.workspace_id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND p.deleted_at IS NULL
      LIMIT 1
    `).bind(projectId, workspaceId).first();

    if (!existing) {
      return c.json({ success: false, error: '找不到專案。' }, 404);
    }

    const body: any = await c.req.json();
    const name = text(body.name);
    const areas = Array.isArray(body.areas) ? body.areas : [];

    if (!name) {
      return c.json({ success: false, error: '專案名稱不可空白。' }, 400);
    }

    if (!areas.length) {
      return c.json({ success: false, error: '專案至少需要一個熱區。' }, 400);
    }

    const dimensions = resolveRichMenuDimensions(existing.image_width, existing.image_height);
    let validatedAreas;
    try {
      validateRichMenuImageDimensions(dimensions.width, dimensions.height);
      validatedAreas = validateRichMenuAreas(areas, dimensions.width, dimensions.height);
    } catch {
      return c.json({ success: false, error: '專案圖片尺寸或熱區座標不符合 LINE Rich Menu 規格。' }, 400);
    }
    const switchAreas = areas.filter(
      (area: any) => text(area?.action?.type).toLowerCase() === 'richmenuswitch'
    );
    const switchTargetIds = [...new Set(
      switchAreas.map((area: any) => text(area?.action?.targetPageId)).filter(Boolean)
    )] as string[];

    if (switchAreas.some((area: any) => !text(area?.action?.targetPageId))) {
      return c.json({ success: false, error: '切換頁 Action 必須選擇目標頁面。' }, 400);
    }

    if (switchTargetIds.includes(projectId)) {
      return c.json({ success: false, error: '切換頁 Action 不可指向目前專案。' }, 400);
    }

    if (switchTargetIds.length) {
      const placeholders = switchTargetIds.map(() => '?').join(', ');
      const targetResult = await c.env.smart_menu_db.prepare(`
        SELECT id
        FROM projects
        WHERE workspace_id = ?
          AND deleted_at IS NULL
          AND status <> 'disabled'
          AND id IN (${placeholders})
      `).bind(workspaceId, ...switchTargetIds).all();

      const allowedSwitchTargetIds = new Set(
        ((targetResult.results || []) as any[]).map((row: any) => text(row.id))
      );
      if (allowedSwitchTargetIds.size !== switchTargetIds.length) {
        return c.json({ success: false, error: '切換目標不存在或不屬於目前 Workspace。' }, 400);
      }
    }

    const statements: D1PreparedStatement[] = [
      c.env.smart_menu_db.prepare(`
        UPDATE projects
        SET name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).bind(name, projectId, workspaceIdOf(c)),

      c.env.smart_menu_db.prepare(`
        DELETE FROM project_areas
        WHERE project_id = ? AND workspace_id = ?
      `).bind(projectId, workspaceIdOf(c)),

      ...validatedAreas.map((area: any, index: number) =>
        projectAreaInsertStatement(c.env, workspaceIdOf(c), projectId, area, index)
      ),
    ];

    await c.env.smart_menu_db.batch(statements);

    return c.json({
      success: true,
      project: {
        id: projectId,
        name,
        areaCount: validatedAreas.length,
      },
    });
  } catch (e: any) {
    console.error('update-project:', e);
    return c.json({ success: false, error: e?.message || '專案更新失敗' }, 500);
  }
});

app.get('/api/projects/:projectId', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);

    const project: any = await c.env.smart_menu_db.prepare(`
      SELECT p.*, a.width AS image_width, a.height AS image_height
      FROM projects p
      LEFT JOIN assets a ON a.id = p.asset_id AND a.workspace_id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND p.deleted_at IS NULL
      LIMIT 1
    `).bind(projectId, workspaceId).first();

    if (!project) {
      return c.json({ success: false, error: '找不到專案。' }, 404);
    }

    const areaResult = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM project_areas
      WHERE project_id = ? AND workspace_id = ?
      ORDER BY area_index ASC
    `).bind(projectId, workspaceId).all();

    const switchTargetResult = await c.env.smart_menu_db.prepare(`
      SELECT id, name, status
      FROM projects
      WHERE workspace_id = ?
        AND id <> ?
        AND deleted_at IS NULL
        AND status <> 'disabled'
      ORDER BY updated_at DESC, created_at DESC
    `).bind(workspaceId, projectId).all();

    const dimensions = resolveRichMenuDimensions(project.image_width, project.image_height);
    const areas = (areaResult.results || []).map((row: any) => {
      const action: any = projectAreaActionFromRow(row);

      const x = num(row.x);
      const y = num(row.y);
      const width = num(row.width);
      const height = num(row.height);

      return {
        id: row.area_index,
        areaId: row.id,
        label: row.label,
        x, y, width, height,
        action,
        style: areaStyle(x, y, width, height, dimensions.width, dimensions.height),
      };
    });

    return c.json({
      success: true,
      project: {
        id: project.id,
        templateId: project.template_id,
        name: project.name,
        status: project.status,
        assetId: project.asset_id,
        pageCount: project.page_count,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        ...richMenuProjection(dimensions.width, dimensions.height),
        imageUrl: project.asset_id ? `/api/assets/${project.asset_id}` : null,
        areas,
      },
      switchTargets: (switchTargetResult.results || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        richMenuAliasId: richMenuAliasIdForProject(row.id),
      })),
    });
  } catch (e: any) {
    console.error('get-project:', e);
    return c.json({ success: false, error: e?.message || '專案讀取失敗' }, 500);
  }
});




app.post('/api/projects/:projectId/areas/:areaId/tracked-uri', async c => {
  try {
    requireRole(c, 'editor');
    const workspaceId = workspaceIdOf(c), projectId = c.req.param('projectId'), areaId = c.req.param('areaId');
    const row: any = await c.env.smart_menu_db.prepare('SELECT * FROM project_areas WHERE id=? AND project_id=? AND workspace_id=? LIMIT 1').bind(areaId, projectId, workspaceId).first();
    if (!row) return c.json({ success: false, error: 'PROJECT_AREA_NOT_FOUND' }, 404);
    const action = projectAreaActionFromRow(row);
    const destination = action.type === 'uri' ? safeDestination(action.uri) : null;
    if (!destination || destination.searchParams.has('sm_at')) return c.json({ success: false, error: 'TRACKED_URI_DESTINATION_INVALID' }, 400);
    const token = createAttributionToken(), hash = await trackedTokenHash(token), fingerprint = await destinationFingerprint(destination.toString()), expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await c.env.smart_menu_db.prepare("INSERT INTO tracked_uri_attributions (id,workspace_id,project_id,project_area_id,attribution_token_hash,event_fingerprint,expires_at,status) VALUES (?,?,?,?,?,?,?,'issued')").bind(id('tua'), workspaceId, projectId, areaId, hash, fingerprint, expiresAt).run();
    return c.json({ success: true, originalDestination: destination.toString(), trackedUri: new URL(`/r/${encodeURIComponent(token)}`, c.req.url).toString(), expiresAt, trackingStatus: 'issued' });
  } catch (error: any) { return c.json({ success: false, error: error?.message === 'FORBIDDEN_ROLE' ? 'FORBIDDEN' : 'TRACKED_URI_GENERATION_FAILED' }, error?.message === 'FORBIDDEN_ROLE' ? 403 : 500); }
});

app.get('/r/:trackingToken', async c => {
  const token = text(c.req.param('trackingToken'));
  if (!/^smat_[A-Za-z0-9_-]{40,}$/.test(token)) return c.text('Not found', 404);
  try {
    const hash = await trackedTokenHash(token);
    const tracked: any = await c.env.smart_menu_db.prepare("SELECT * FROM tracked_uri_attributions WHERE attribution_token_hash=? AND status='issued' LIMIT 1").bind(hash).first();
    if (!tracked || Date.parse(tracked.expires_at) < Date.now()) return c.text('Not found', 404);
    const area: any = await c.env.smart_menu_db.prepare('SELECT * FROM project_areas WHERE id=? AND project_id=? AND workspace_id=? LIMIT 1').bind(tracked.project_area_id, tracked.project_id, tracked.workspace_id).first();
    const action = area ? projectAreaActionFromRow(area) : null;
    const destination = action?.type === 'uri' ? safeDestination(action.uri) : null;
    if (!destination || await destinationFingerprint(destination.toString()) !== tracked.event_fingerprint) return c.text('Not found', 404);
    const redirectTo = appendAttributionToken(destination.toString(), token);
    if (!redirectTo) return c.text('Not found', 404);
    await c.env.smart_menu_db.prepare("UPDATE tracked_uri_attributions SET status='clicked',occurred_at=? WHERE id=? AND status='issued'").bind(new Date().toISOString(), tracked.id).run();
    return c.redirect(redirectTo, 302);
  } catch { return c.text('Not found', 404); }
});
app.get('/api/workspaces/conversion-api-keys', async c => { try { requireRole(c,'admin'); const rows:any[]=(await c.env.smart_menu_db.prepare('SELECT id,name,key_prefix,status,last_used_at,created_at,revoked_at FROM workspace_conversion_api_keys WHERE workspace_id=? ORDER BY created_at DESC').bind(workspaceIdOf(c)).all()).results||[]; return c.json({success:true,keys:rows.map(x=>({id:x.id,name:x.name,prefix:x.key_prefix,status:x.status,lastUsedAt:x.last_used_at,createdAt:x.created_at,revokedAt:x.revoked_at}))}); } catch { return c.json({success:false,error:'FORBIDDEN'},403); } });
app.post('/api/workspaces/conversion-api-keys', async c => { try { requireRole(c,'admin'); const body:any=await c.req.json().catch(()=>({})); const created=createConversionApiKey(); const id='cak_'+crypto.randomUUID(); await c.env.smart_menu_db.prepare('INSERT INTO workspace_conversion_api_keys (id,workspace_id,name,key_prefix,key_hash,created_by_user_id) VALUES (?,?,?,?,?,?)').bind(id,workspaceIdOf(c),text(body.name||'Conversion integration').slice(0,80),created.prefix,await conversionKeyHash(created.key),text(c.get('userId'))).run(); return c.json({success:true,key:{id,name:text(body.name||'Conversion integration').slice(0,80),prefix:created.prefix,status:'active',secret:created.key}}); } catch { return c.json({success:false,error:'FORBIDDEN'},403); } });
app.post('/api/workspaces/conversion-api-keys/:keyId/revoke', async c => { try { requireRole(c,'admin'); await c.env.smart_menu_db.prepare("UPDATE workspace_conversion_api_keys SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='active'").bind(c.req.param('keyId'),workspaceIdOf(c)).run(); return c.json({success:true}); } catch { return c.json({success:false,error:'FORBIDDEN'},403); } });
app.get('/api/intelligence/conversions/sources/health', async c => {
  const workspaceId = workspaceIdOf(c);
  const rows: any[] = (await c.env.smart_menu_db.prepare("SELECT conversion_source,COUNT(*) event_count,MAX(occurred_at) last_event_at,COUNT(*) conversions,COALESCE(SUM(value_minor),0) conversion_value_minor FROM line_conversion_events WHERE workspace_id=? GROUP BY conversion_source ORDER BY conversion_source").bind(workspaceId).all()).results || [];
  const activeKey = await c.env.smart_menu_db.prepare("SELECT id FROM workspace_conversion_api_keys WHERE workspace_id=? AND status='active' LIMIT 1").bind(workspaceId).first();
  return c.json({ success: true, sources: conversionSourceHealthRows(rows, Date.now(), Boolean(activeKey)) });
});
app.post('/api/intelligence/conversions', async c => {
  const credential = await authenticateConversionApiKey(c.env.smart_menu_db, c.req.header('authorization'));
  if (!credential) return c.json({ success: false, error: 'UNAUTHORIZED' }, 401);
  const body: any = await c.req.json().catch(() => null);
  if (!body || !['lead', 'signup', 'registration', 'booking', 'purchase', 'custom'].includes(text(body.conversionType)) || !text(body.externalEventId)) return c.json({ success: false, error: 'INVALID_CONVERSION' }, 400);
  const source = conversionSource(text(body.sourceCode), text(body.conversionType));
  if (!source) return c.json({ success: false, error: text(body.sourceCode) ? 'INVALID_CONVERSION_SOURCE_TYPE' : 'INVALID_CONVERSION_SOURCE' }, 400);
  const safeMetadata = sanitizeConversionMetadata(body.metadata);
  void safeMetadata;
  const value = body.valueMinor;
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) return c.json({ success: false, error: 'INVALID_VALUE_MINOR' }, 400);
  if (!source.supportsValue && value !== undefined) return c.json({ success: false, error: 'VALUE_NOT_SUPPORTED_FOR_SOURCE' }, 400);
  if (body.currency !== undefined && !/^[A-Za-z]{3}$/.test(text(body.currency, 8))) return c.json({ success: false, error: 'INVALID_CURRENCY' }, 400);
  const workspaceId = credential.workspaceId;
  const occurredAt = new Date().toISOString();
  const suppliedConversionReferralContext = text(c.req.header('X-Smart-Menu-Conversion-Referral-Context'), 512);
  const referralContext = await resolveConversionReferralContext(c.env.smart_menu_db, { secret: text(c.env.MEMBER_IDENTITY_HMAC_SECRET), token: suppliedConversionReferralContext, workspaceId });
  const projectId = text(body.projectId);
  const projectAreaId = text(body.projectAreaId);
  const requestedSessionId = text(body.journeySessionId);
  if (projectId && !(await c.env.smart_menu_db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? LIMIT 1').bind(projectId, workspaceId).first())) return c.json({ success: false, error: 'INVALID_MAPPING' }, 400);
  const area: any = projectAreaId ? await c.env.smart_menu_db.prepare('SELECT id,project_id FROM project_areas WHERE id=? AND workspace_id=? LIMIT 1').bind(projectAreaId, workspaceId).first() : null;
  if (projectAreaId && !area) return c.json({ success: false, error: 'INVALID_MAPPING' }, 400);
  if (projectId && area && area.project_id !== projectId) return c.json({ success: false, error: 'INVALID_MAPPING' }, 400);
  const existing = await c.env.smart_menu_db.prepare('SELECT id FROM line_conversion_events WHERE workspace_id=? AND external_event_id=? LIMIT 1').bind(workspaceId, text(body.externalEventId, 120)).first();
  if (existing && referralContext) establishConversionReferralEvidence(c.env.smart_menu_db,{workspaceId,lineAccountId:referralContext.line_account_id,conversionEventId:(existing as any).id,context:referralContext}).then(evidenceId=>{if(evidenceId)return establishCommissionAttribution(c.env.smart_menu_db,{workspaceId,lineAccountId:referralContext.line_account_id,conversionReferralEvidenceId:evidenceId}).then(()=>recordContributionForTrustedSource(c.env.smart_menu_db,{workspaceId,lineAccountId:referralContext.line_account_id,eventType:'VERIFIED_REFERRAL_CONVERSION',sourceRef:evidenceId})).catch(()=>recordContributionForTrustedSource(c.env.smart_menu_db,{workspaceId,lineAccountId:referralContext.line_account_id,eventType:'VERIFIED_REFERRAL_CONVERSION',sourceRef:evidenceId}));}).catch(()=>{});
  if (existing) return c.json({ success: true, idempotent: true });

  const requestedAttributionToken = text(body.attributionToken, 256);
  const tracked = requestedAttributionToken ? await c.env.smart_menu_db.prepare("SELECT project_id,project_area_id FROM tracked_uri_attributions WHERE workspace_id=? AND attribution_token_hash=? AND status='clicked' AND expires_at>=? LIMIT 1").bind(workspaceId, await trackedTokenHash(requestedAttributionToken), occurredAt).first() : null;
  if (requestedAttributionToken && !tracked) return c.json({ success: false, error: 'INVALID_ATTRIBUTION_TOKEN' }, 400);
  const sessionRows: any[] = requestedSessionId
    ? ((await c.env.smart_menu_db.prepare('SELECT journey_session_id,project_id,project_area_id,event_type,occurred_at FROM line_journey_events WHERE workspace_id=? AND journey_session_id=? ORDER BY occurred_at DESC').bind(workspaceId, requestedSessionId).all()).results || [])
    : [];
  if (requestedSessionId && !sessionRows.length) return c.json({ success: false, error: 'INVALID_JOURNEY_SESSION' }, 400);
  // Server-to-server conversion calls have no pseudonymous actor context without an explicit session.
  // Never infer a user's touch from arbitrary events elsewhere in the workspace.
  const touch = lastObservedTouch(sessionRows, occurredAt);
  const mapped = tracked
    ? { projectId: text((tracked as any).project_id), projectAreaId: text((tracked as any).project_area_id) }
    : projectAreaId
      ? { projectId: text(area?.project_id), projectAreaId }
      : projectId
        ? { projectId, projectAreaId: null }
        : touch
          ? { projectId: text(touch.project_id), projectAreaId: text(touch.project_area_id) }
          : null;
  const conversionEventId = 'lce_' + crypto.randomUUID();
  await c.env.smart_menu_db.prepare('INSERT INTO line_conversion_events (id,workspace_id,conversion_key_id,external_event_id,conversion_type,conversion_source,journey_session_id,project_id,project_area_id,attributed_project_id,attributed_project_area_id,attribution_model,value_minor,currency,mapping_status,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(
    conversionEventId, workspaceId, credential.id, text(body.externalEventId, 120), text(body.conversionType, 30), source.sourceCode, requestedSessionId || null,
    projectId || null, projectAreaId || null, mapped?.projectId || null, mapped?.projectAreaId || null,
    'last_observed_touch', value ?? null, text(body.currency || '', 8) || null, mapped ? 'matched' : 'unmatched', occurredAt,
  ).run();
  if (tracked) await c.env.smart_menu_db.prepare('UPDATE tracked_uri_attributions SET conversion_event_id=? WHERE workspace_id=? AND attribution_token_hash=? AND conversion_event_id IS NULL').bind(conversionEventId, workspaceId, await trackedTokenHash(requestedAttributionToken)).run();
  if (referralContext) establishConversionReferralEvidence(c.env.smart_menu_db,{workspaceId,lineAccountId:referralContext.line_account_id,conversionEventId,context:referralContext}).then(evidenceId=>{if(evidenceId)return establishCommissionAttribution(c.env.smart_menu_db,{workspaceId,lineAccountId:referralContext.line_account_id,conversionReferralEvidenceId:evidenceId}).then(()=>recordContributionForTrustedSource(c.env.smart_menu_db,{workspaceId,lineAccountId:referralContext.line_account_id,eventType:'VERIFIED_REFERRAL_CONVERSION',sourceRef:evidenceId})).catch(()=>recordContributionForTrustedSource(c.env.smart_menu_db,{workspaceId,lineAccountId:referralContext.line_account_id,eventType:'VERIFIED_REFERRAL_CONVERSION',sourceRef:evidenceId}));}).catch(()=>{});
  return c.json({ success: true, idempotent: false });
});

app.get('/api/projects/:projectId/intelligence/journey', async (c) => {
  const workspaceId = workspaceIdOf(c);
  const projectId = c.req.param('projectId');
  const from = text(c.req.query('from')) || new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = text(c.req.query('to')) || new Date().toISOString().slice(0, 10);
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00.000Z'));
  if (!validDate(from) || !validDate(to) || from > to || (Date.parse(to + 'T00:00:00.000Z') - Date.parse(from + 'T00:00:00.000Z')) / 86_400_000 > 366) return c.json({ success: false, error: 'INVALID_DATE_RANGE' }, 400);
  const project: any = await c.env.smart_menu_db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL').bind(projectId, workspaceId).first();
  if (!project) return c.json({ success: false, error: 'Project not found.' }, 404);
  const [daily, areas, activeKey, sourceRows] = await Promise.all([
    c.env.smart_menu_db.prepare("SELECT * FROM line_journey_daily WHERE workspace_id=? AND project_id=? AND project_area_id='' AND metric_date>=? AND metric_date<=? ORDER BY metric_date").bind(workspaceId, projectId, from, to).all(),
    c.env.smart_menu_db.prepare('SELECT id,label,action_type FROM project_areas WHERE workspace_id=? AND project_id=? ORDER BY area_index').bind(workspaceId, projectId).all(),
    c.env.smart_menu_db.prepare("SELECT id FROM workspace_conversion_api_keys WHERE workspace_id=? AND status='active' LIMIT 1").bind(workspaceId).first(),
    c.env.smart_menu_db.prepare("SELECT conversion_source,COUNT(*) event_count,MAX(occurred_at) last_event_at,COUNT(*) conversions,COALESCE(SUM(value_minor),0) conversion_value_minor FROM line_conversion_events WHERE workspace_id=? AND attributed_project_id=? AND occurred_at>=? AND occurred_at<? GROUP BY conversion_source ORDER BY conversion_source").bind(workspaceId, projectId, from + 'T00:00:00.000Z', new Date(Date.parse(to + 'T00:00:00.000Z') + 86400000).toISOString()).all(),
  ]);
  const areaDaily: any[] = (await c.env.smart_menu_db.prepare("SELECT * FROM line_journey_daily WHERE workspace_id=? AND project_id=? AND project_area_id<>'' AND metric_date>=? AND metric_date<=?").bind(workspaceId, projectId, from, to).all()).results || [];
  const [trackedResult, aggregateResult] = await Promise.all([
    c.env.smart_menu_db.prepare("SELECT project_area_id,COUNT(*) tracked_uri_clicks,SUM(CASE WHEN conversion_event_id IS NOT NULL THEN 1 ELSE 0 END) attributed_conversions FROM tracked_uri_attributions WHERE workspace_id=? AND project_id=? AND status='clicked' AND occurred_at>=? AND occurred_at<? GROUP BY project_area_id").bind(workspaceId, projectId, from + 'T00:00:00.000Z', new Date(Date.parse(to + 'T00:00:00.000Z') + 86400000).toISOString()).all(),
    c.env.smart_menu_db.prepare("SELECT project_area_id,SUM(clicks) aggregate_line_clicks FROM line_intelligence_daily WHERE workspace_id=? AND project_id=? AND metric_date>=? AND metric_date<=? GROUP BY project_area_id").bind(workspaceId, projectId, from, to).all(),
  ]);
  const trackedByArea = new Map(((trackedResult.results || []) as any[]).map(row => [row.project_area_id, row]));
  const aggregateByArea = new Map(((aggregateResult.results || []) as any[]).map(row => [row.project_area_id, Number(row.aggregate_line_clicks || 0)]));
  const overview = funnel((daily.results || []) as any[]);
  const areaMetrics = (areas.results || []).map((area: any) => {
    const rows = areaDaily.filter((row) => row.project_area_id === area.id);
    const value = (key: string) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    const observedActions = value('message_actions') + value('postback_actions') + value('switch_actions');
    const conversions = value('conversions');
    const tracked = trackedByArea.get(area.id) as any; const trackedUriClicks=Number(tracked?.tracked_uri_clicks || 0), attributedConversions=Number(tracked?.attributed_conversions || 0), aggregateLineClicks=Number(aggregateByArea.get(area.id) || 0); const trackingAvailable=area.action_type==='uri'; const trackingEnabled=trackingAvailable && trackedUriClicks>0; return { areaId: area.id, label: area.label, actionType: area.action_type, observedActions, sessions: value('observed_sessions'), keywordMatches: value('keyword_matches'), webhookSuccesses: value('webhook_successes'), conversions, conversionValueMinor: value('conversion_value_minor'), observedConversionRate: observedActions > 0 ? conversions / observedActions : null, aggregateLineClicks, trackedUriClicks, attributedConversions, trackedObservedConversionRate: trackedUriClicks > 0 ? attributedConversions / trackedUriClicks : null, trackingAvailable, trackingEnabled, attributionCoverage: aggregateLineClicks + trackedUriClicks > 0 ? trackedUriClicks / (aggregateLineClicks + trackedUriClicks) : null, trackingReason: !trackingAvailable ? 'URI_TRACKING_NOT_ENABLED' : trackedUriClicks === 0 ? 'URI_TRACKING_INSUFFICIENT' : 'READY' };
  });
  const sourceBreakdown = (sourceRows.results || []).map((row: any) => ({ sourceCode: row.conversion_source || null, displayName: row.conversion_source || 'Legacy / 未記錄來源', eventCount: Number(row.event_count || 0), conversions: Number(row.conversions || 0), conversionValueMinor: Number(row.conversion_value_minor || 0), lastEventAt: row.last_event_at || null }));
  return c.json({ success: true, period: { from, to }, ...overview, conversionIntegrationAvailable: Boolean(activeKey), sourceBreakdown, areas: areaMetrics });
});

app.post('/api/projects/:projectId/intelligence/journey/rebuild', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const projectId = c.req.param('projectId');
    const body: any = await c.req.json().catch(() => ({}));
    const from = text(body.from) || new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const to = text(body.to) || new Date().toISOString().slice(0, 10);
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00.000Z'));
    if (!validDate(from) || !validDate(to) || from > to || (Date.parse(to + 'T00:00:00.000Z') - Date.parse(from + 'T00:00:00.000Z')) / 86_400_000 > 366) return c.json({ success: false, error: 'INVALID_DATE_RANGE' }, 400);
    const project: any = await c.env.smart_menu_db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL').bind(projectId, workspaceId).first();
    if (!project) return c.json({ success: false, error: 'Project not found.' }, 404);
    await rebuildJourneyDaily(c.env.smart_menu_db, workspaceId, projectId, from, to);
    return c.json({ success: true, period: { from, to } });
  } catch (error: any) {
    return c.json({ success: false, error: error?.message === 'FORBIDDEN_ROLE' ? 'FORBIDDEN' : 'JOURNEY_REBUILD_FAILED' }, error?.message === 'FORBIDDEN_ROLE' ? 403 : 500);
  }
});

app.get('/api/projects/:projectId/guide', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    const context = await buildGuideContext({
      db: c.env.smart_menu_db,
      workspaceId,
      userId: text(c.get('userId')),
      route: text(c.req.query('route')) || `/projects/${projectId}`,
      entityType: 'project',
      entityId: projectId,
      selectedAreaId: text(c.req.query('selectedAreaId')),
    });

    if (!context) {
      return c.json({ success: false, error: '找不到專案。' }, 404);
    }

    const guide = evaluateGuide(context);
    const workflow = buildGuideWorkflow(context, guide);
    let recommendationResult = emptyRecommendationResult();
    try {
      recommendationResult = evaluateRecommendations(context);
    } catch (recommendationError) {
      console.error(JSON.stringify({
        message: 'guide recommendation evaluation failed',
        projectId,
        error: recommendationError instanceof Error ? recommendationError.message : 'unknown error',
      }));
      recommendationResult = emptyRecommendationResult('目前無法取得智慧建議。');
    }

    return c.json({
      success: true,
      context: toPublicGuideContext(context),
      guide,
      workflow,
      recommendationResult,
    });
  } catch (e: any) {
    console.error('project-guide:', e);
    return c.json({ success: false, error: '目前無法取得引導狀態。' }, 500);
  }
});

app.post('/api/projects/:projectId/guide/recommendations/:recommendationId/explain', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const recommendationId = c.req.param('recommendationId');
    const workspaceId = workspaceIdOf(c);
    const context = await buildGuideContext({
      db: c.env.smart_menu_db,
      workspaceId,
      userId: text(c.get('userId')),
      route: `/projects/${projectId}`,
      entityType: 'project',
      entityId: projectId,
    });

    if (!context) {
      return c.json({ success: false, error: '找不到專案。' }, 404);
    }

    const guide = evaluateGuide(context);
    buildGuideWorkflow(context, guide);
    const recommendationResult = evaluateRecommendations(context);
    const recommendation = findRecommendationById(recommendationResult.recommendations, recommendationId);
    if (!recommendation) {
      return c.json({ success: false, error: '找不到此智慧建議。' }, 404);
    }

    let providerUsage = extractGeminiUsageMetadata(null);
    let providerRequestId: string | null = null;
    const explanation = await executeMeteredAiCall({
      db: c.env.smart_menu_db,
      workspaceId,
      userId: text(c.get('userId')),
      featureCode: recommendation.source === 'optimization' ? 'optimization_recommendation_explanation' : recommendation.source === 'journey' ? 'journey_recommendation_explanation' : recommendation.source === 'behavior' ? 'behavior_recommendation_explanation' : recommendation.source === 'referral_growth' ? 'referral_growth_recommendation_explanation' : 'recommendation_explanation',
      operationCode: recommendation.ruleCode,
      provider: 'google',
      model: GEMINI_MODEL,
      logger: event => console.error(JSON.stringify(event)),
      execute: async () => {
        const value = await explainRecommendation(recommendation, {
          apiKey: c.env.GEMINI_API_KEY,
          timeoutMs: 8000,
          fetcher: async (request: RequestInfo | URL, init?: RequestInit) => {
            const response = await fetch(request, init);
            providerRequestId = text(response.headers.get('x-request-id')) || null;
            try {
              providerUsage = extractGeminiUsageMetadata(await response.clone().json());
            } catch {
              providerUsage = extractGeminiUsageMetadata(null);
            }
            return response;
          },
          logger: event => console.log(JSON.stringify(event)),
        });
        return {
          value,
          status: value.status === 'generated' ? 'success' as const : 'fallback' as const,
          usage: providerUsage,
          providerRequestId,
          errorCode: value.status === 'generated' ? null : 'DETERMINISTIC_FALLBACK',
        };
      },
    });

    return c.json({
      success: true,
      recommendation: {
        id: recommendation.id,
        ruleCode: recommendation.ruleCode,
        priority: recommendation.priority,
        category: recommendation.category,
        canGenerateProposal: recommendation.canGenerateProposal,
      },
      explanation,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'recommendation explanation endpoint failed',
      status: 'error',
    }));
    return c.json({ success: false, error: '目前無法取得 AI 說明。' }, 500);
  }
});

app.post('/api/projects/:projectId/guide/recommendations/:recommendationId/proposal', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const recommendationId = c.req.param('recommendationId');
    const workspaceId = workspaceIdOf(c);
    const context = await buildGuideContext({
      db: c.env.smart_menu_db,
      workspaceId,
      userId: text(c.get('userId')),
      route: `/projects/${projectId}`,
      entityType: 'project',
      entityId: projectId,
    });

    if (!context) {
      return c.json({ success: false, error: '找不到專案。' }, 404);
    }

    const guide = evaluateGuide(context);
    buildGuideWorkflow(context, guide);
    const recommendationResult = evaluateRecommendations(context);
    const recommendation = findRecommendationById(recommendationResult.recommendations, recommendationId);
    if (!recommendation) {
      return c.json({ success: false, error: '找不到此智慧建議。' }, 404);
    }

    if (recommendation.source === 'behavior' || recommendation.source === 'journey' || recommendation.source === 'optimization') return c.json({ success: false, error: 'PROPOSAL_NOT_AVAILABLE', code: 'PROPOSAL_NOT_AVAILABLE' }, 409);
  const proposal = sanitizeProposal(buildProposal({ context, recommendation }));
    if (!proposal) {
      return c.json({
        success: false,
        error: '此建議目前沒有安全的改善方案草案。',
        proposalAvailable: false,
      }, 409);
    }

    return c.json({
      success: true,
      recommendation: {
        id: recommendation.id,
        ruleCode: recommendation.ruleCode,
        priority: recommendation.priority,
      },
      proposal,
    });
  } catch {
    console.error(JSON.stringify({
      message: 'recommendation proposal endpoint failed',
      status: 'error',
    }));
    return c.json({ success: false, error: '目前無法產生改善方案預覽。' }, 500);
  }
});

type CurrentProposalResult = {
  proposal: NonNullable<ReturnType<typeof sanitizeProposal>>;
  recommendation: ReturnType<typeof evaluateRecommendations>['recommendations'][number];
  proposalType: NonNullable<ReturnType<typeof evaluateRecommendations>['recommendations'][number]['proposal']['type']>;
  context: NonNullable<Awaited<ReturnType<typeof buildGuideContext>>>;
};

async function rebuildCurrentProposal(
  c: any,
  projectId: string,
  lookup: { recommendationId?: string; ruleCode?: string; sourceEntityId?: string | null; allowFallback?: boolean },
): Promise<CurrentProposalResult | null> {
  const workspaceId = workspaceIdOf(c);
  const context = await buildGuideContext({
    db: c.env.smart_menu_db,
    workspaceId,
    userId: text(c.get('userId')),
    route: `/projects/${projectId}`,
    entityType: 'project',
    entityId: projectId,
  });
  if (!context) return null;

  const recommendations = evaluateRecommendations(context).recommendations;
  let recommendation = lookup.recommendationId
    ? findRecommendationById(recommendations, lookup.recommendationId)
    : null;
  if (!recommendation && lookup.allowFallback && lookup.ruleCode) {
    recommendation = recommendations.find(item =>
      item.ruleCode === lookup.ruleCode
      && (!lookup.sourceEntityId || item.entityId === lookup.sourceEntityId)
    ) || null;
  }
  if (!recommendation?.proposal.available || !recommendation.proposal.type) return null;

  const proposal = sanitizeProposal(buildProposal({ context, recommendation }));
  if (!proposal) return null;
  return { proposal, recommendation, proposalType: recommendation.proposal.type, context };
}

function proposalResponse(
  proposal: StoredProposal,
  role: string,
  includeSnapshot = false,
  httpsEligibility: HttpsProbeEligibility = 'NEEDS_PROBE',
  rollbackAvailable = false,
) {
  const contract = proposalExecutionContract(proposal.proposalType, proposal.sourceEntityId);
  const policy = publicPolicySummary({
    proposal,
    actorRole: role,
    probeEligibility: httpsEligibility,
    rollbackAvailable,
  });
  const execution = {
    ...contract,
    executable: policy.capabilities.canExecute,
    ...(proposal.proposalType === 'https-upgrade-candidate' ? { eligibility: httpsEligibility } : {}),
  };
  const lifecyclePermissions = proposalPermissions(role, proposal.status, execution.executable);
  return {
    id: proposal.id,
    projectId: proposal.projectId,
    recommendationId: proposal.recommendationId,
    ruleCode: proposal.ruleCode,
    proposalType: proposal.proposalType,
    status: proposal.status,
    title: proposal.title,
    summary: proposal.summary,
    generatedBy: proposal.generatedBy,
    createdBy: { id: proposal.createdByUserId, name: proposal.createdByName },
    reviewedBy: proposal.reviewedByUserId ? { id: proposal.reviewedByUserId, name: proposal.reviewedByName } : null,
    approvedBy: proposal.approvedByUserId ? { id: proposal.approvedByUserId, name: proposal.approvedByName } : null,
    rejectedBy: proposal.rejectedByUserId ? { id: proposal.rejectedByUserId, name: proposal.rejectedByName } : null,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    reviewedAt: proposal.reviewedAt,
    approvedAt: proposal.approvedAt,
    rejectedAt: proposal.rejectedAt,
    executedAt: proposal.executedAt,
    execution,
    policy,
    permissions: {
      ...lifecyclePermissions,
      canReview: policy.capabilities.canReview,
      canApprove: policy.capabilities.canApprove,
      canExecute: policy.capabilities.canExecute,
      canRollback: policy.capabilities.canRollback,
    },
    ...(includeSnapshot ? { snapshot: proposal.snapshot } : {}),
  };
}

async function loadHttpsProbeState(c: any, proposal: StoredProposal): Promise<{
  record: StoredHttpsProbe | null;
  publicProbe: PublicHttpsProbe | null;
  eligibility: HttpsProbeEligibility;
  currentUrl: string;
  projectAreaId: string | null;
}> {
  if (proposal.proposalType !== 'https-upgrade-candidate' || !proposal.sourceEntityId) {
    return { record: null, publicProbe: null, eligibility: 'NEEDS_PROBE', currentUrl: '', projectAreaId: null };
  }
  const row = await c.env.smart_menu_db.prepare(`
    SELECT id, action_uri
    FROM project_areas
    WHERE workspace_id = ? AND project_id = ? AND area_index = ?
      AND action_type = 'uri'
    LIMIT 1
  `).bind(
    proposal.workspaceId,
    proposal.projectId,
    proposal.sourceEntityId,
  ).first() as Record<string, unknown> | null;
  if (!row) {
    return { record: null, publicProbe: null, eligibility: 'NEEDS_PROBE', currentUrl: '', projectAreaId: null };
  }
  const projectAreaId = text(row.id);
  const currentUrl = text(row.action_uri);
  const record = await getLatestHttpsProbe(
    c.env.smart_menu_db,
    proposal.workspaceId,
    proposal.projectId,
    proposal.id,
    projectAreaId,
  );
  const eligibility = await httpsProbeEligibility(record, currentUrl);
  const publicProbe = record ? await toPublicHttpsProbe(record, currentUrl) : null;
  return { record, publicProbe, eligibility, currentUrl, projectAreaId };
}

async function refreshStaleStatus(c: any, proposal: StoredProposal): Promise<StoredProposal> {
  if (!['draft', 'reviewed', 'approved'].includes(proposal.status)) return proposal;
  const current = await rebuildCurrentProposal(c, proposal.projectId, {
    recommendationId: proposal.recommendationId,
  });
  const currentFingerprint = current && current.proposalType === proposal.proposalType
    ? await fingerprintProposal(current.proposal, current.proposalType, current.recommendation.evidence)
    : '';
  if (currentFingerprint === proposal.sourceFingerprint) return proposal;

  try {
    await transitionStoredProposal(c.env.smart_menu_db, {
      proposal,
      toStatus: 'stale',
      eventType: 'STALE_DETECTED',
    });
  } catch (error: any) {
    if (!['PROPOSAL_CONFLICT', 'INVALID_PROPOSAL_TRANSITION'].includes(error?.message)) throw error;
  }
  return await getStoredProposal(
    c.env.smart_menu_db,
    workspaceIdOf(c),
    proposal.projectId,
    proposal.id,
  ) || proposal;
}

function proposalApiError(c: any, error: any, fallback: string) {
  if (error instanceof OperationPolicyError) {
    return c.json({ success: false, code: error.code, error: policyReasonMessage(error.code) }, error.code === 'ROLE_NOT_ALLOWED' ? 403 : 409);
  }
  if (error?.message === 'FORBIDDEN_ROLE') {
    return c.json({ success: false, error: '權限不足。' }, 403);
  }
  if (error?.message === 'INVALID_PROPOSAL_TRANSITION') {
    return c.json({ success: false, error: '此改善方案目前不能執行該狀態操作。' }, 409);
  }
  if (error?.message === 'PROPOSAL_CONFLICT') {
    return c.json({ success: false, error: '改善方案狀態已變更，請重新載入。' }, 409);
  }
  console.error(JSON.stringify({ message: 'proposal approval workflow failed', status: 'error' }));
  return c.json({ success: false, error: fallback }, 500);
}

app.post('/api/projects/:projectId/guide/recommendations/:recommendationId/proposals', async (c) => {
  try {
    requireRole(c, 'editor');
    const projectId = c.req.param('projectId');
    const current = await rebuildCurrentProposal(c, projectId, {
      recommendationId: c.req.param('recommendationId'),
    });
    if (!current) return c.json({ success: false, error: '找不到可儲存的改善方案。' }, 404);
    if (current.recommendation.source === 'behavior' || current.recommendation.source === 'journey') return c.json({ success: false, error: 'PROPOSAL_NOT_AVAILABLE', code: 'PROPOSAL_NOT_AVAILABLE' }, 409);

    const proposalId = await createProposalDraft(c.env.smart_menu_db, {
      proposal: current.proposal,
      proposalType: current.proposalType,
      sourceEntityId: current.recommendation.entityId,
      actorUserId: text(c.get('userId')),
      sourceFacts: current.recommendation.evidence,
    });
    const stored = await getStoredProposal(c.env.smart_menu_db, workspaceIdOf(c), projectId, proposalId);
    if (!stored) throw new Error('PROPOSAL_CREATE_READ_FAILED');
    return c.json({ success: true, proposal: proposalResponse(stored, text(c.get('userRole')), true) }, 201);
  } catch (error: any) {
    return proposalApiError(c, error, '改善方案草案儲存失敗。');
  }
});

app.get('/api/projects/:projectId/proposals', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    const project = await c.env.smart_menu_db.prepare(`
      SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1
    `).bind(projectId, workspaceId).first();
    if (!project) return c.json({ success: false, error: '找不到專案。' }, 404);
    const proposals = await listStoredProposals(c.env.smart_menu_db, workspaceId, projectId);
    const responseItems = await Promise.all(proposals.map(async item => {
      const probeState = await loadHttpsProbeState(c, item);
      return proposalResponse(item, text(c.get('userRole')), false, probeState.eligibility);
    }));
    return c.json({
      success: true,
      proposals: responseItems,
      permissions: proposalPermissions(text(c.get('userRole'))),
    });
  } catch (error: any) {
    return proposalApiError(c, error, '改善方案列表讀取失敗。');
  }
});

app.get('/api/projects/:projectId/proposals/:proposalId', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    let proposal = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, c.req.param('proposalId'));
    if (!proposal) return c.json({ success: false, error: '找不到改善方案。' }, 404);
    proposal = await refreshStaleStatus(c, proposal);
    const [proposalEvents, operationLogs] = await Promise.all([
      listProposalEvents(c.env.smart_menu_db, workspaceId, proposal.id),
      listOperationLogs(c.env.smart_menu_db, workspaceId, projectId, proposal.id),
    ]);
    const events = [...proposalEvents, ...operationLogEvents(operationLogs)]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const probeState = await loadHttpsProbeState(c, proposal);
    const rollbackContext = proposal.status === 'executed'
      ? await buildRollbackContext({ db: c.env.smart_menu_db, proposal, role: text(c.get('userRole')) })
      : null;
    return c.json({
      success: true,
      proposal: proposalResponse(
        proposal,
        text(c.get('userRole')),
        true,
        probeState.eligibility,
        rollbackContext?.preview?.eligible === true,
      ),
      events,
      operationLogs: publicOperationLogs(operationLogs),
      rollbackPreview: rollbackContext?.preview || null,
      httpsProbe: probeState.publicProbe,
    });
  } catch (error: any) {
    return proposalApiError(c, error, '改善方案讀取失敗。');
  }
});

app.post('/api/projects/:projectId/proposals/:proposalId/review', async (c) => {
  try {
    requireRole(c, 'editor');
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    let proposal = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, c.req.param('proposalId'));
    if (!proposal) return c.json({ success: false, error: '找不到改善方案。' }, 404);
    proposal = await refreshStaleStatus(c, proposal);
    if (proposal.status === 'stale') return c.json({ success: false, error: '此改善方案已失效，請重新產生。' }, 409);
    const policyEvaluation = evaluateOperationPolicy({
      proposal,
      actorRole: text(c.get('userRole')),
      action: 'review',
    });
    assertPolicyAllowed(policyEvaluation);
    await transitionStoredProposal(c.env.smart_menu_db, {
      proposal,
      toStatus: 'reviewed',
      eventType: 'REVIEWED',
      actorUserId: text(c.get('userId')),
      eventMetadata: {
        policyVersion: policyEvaluation.policyVersion,
        riskLevel: policyEvaluation.riskLevel,
        policyResult: policyEvaluation.reasonCode,
      },
    });
    const updated = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, proposal.id);
    return c.json({ success: true, proposal: proposalResponse(updated!, text(c.get('userRole')), true) });
  } catch (error: any) {
    return proposalApiError(c, error, '改善方案檢視狀態更新失敗。');
  }
});

app.post('/api/projects/:projectId/proposals/:proposalId/approve', async (c) => {
  try {
    requireRole(c, 'admin');
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    let proposal = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, c.req.param('proposalId'));
    if (!proposal) return c.json({ success: false, error: '找不到改善方案。' }, 404);
    proposal = await refreshStaleStatus(c, proposal);
    if (proposal.status === 'stale') return c.json({ success: false, error: '此改善方案已失效，不能核准。' }, 409);
    const policyEvaluation = evaluateOperationPolicy({
      proposal,
      actorRole: text(c.get('userRole')),
      action: 'approve',
    });
    assertPolicyAllowed(policyEvaluation);
    await transitionStoredProposal(c.env.smart_menu_db, {
      proposal,
      toStatus: 'approved',
      eventType: 'APPROVED',
      actorUserId: text(c.get('userId')),
      eventMetadata: {
        policyVersion: policyEvaluation.policyVersion,
        riskLevel: policyEvaluation.riskLevel,
        policyResult: policyEvaluation.reasonCode,
      },
    });
    const updated = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, proposal.id);
    return c.json({ success: true, proposal: proposalResponse(updated!, text(c.get('userRole')), true) });
  } catch (error: any) {
    return proposalApiError(c, error, '改善方案核准失敗。');
  }
});

app.post('/api/projects/:projectId/proposals/:proposalId/reject', async (c) => {
  try {
    requireRole(c, 'admin');
    const body: any = await c.req.json();
    const rejectReason = text(body.rejectReason).replace(/[\u0000-\u001f\u007f]/g, '');
    if (rejectReason.length < 3 || rejectReason.length > 300) {
      return c.json({ success: false, error: '請輸入 3–300 字的拒絕原因。' }, 400);
    }
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    let proposal = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, c.req.param('proposalId'));
    if (!proposal) return c.json({ success: false, error: '找不到改善方案。' }, 404);
    proposal = await refreshStaleStatus(c, proposal);
    if (proposal.status === 'stale') return c.json({ success: false, error: '此改善方案已失效，請重新產生。' }, 409);
    await transitionStoredProposal(c.env.smart_menu_db, {
      proposal,
      toStatus: 'rejected',
      eventType: 'REJECTED',
      actorUserId: text(c.get('userId')),
      eventMetadata: { rejectReason },
    });
    const updated = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, proposal.id);
    return c.json({ success: true, proposal: proposalResponse(updated!, text(c.get('userRole')), true) });
  } catch (error: any) {
    return proposalApiError(c, error, '改善方案拒絕失敗。');
  }
});

app.post('/api/projects/:projectId/proposals/:proposalId/regenerate', async (c) => {
  try {
    requireRole(c, 'editor');
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    const previous = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, c.req.param('proposalId'));
    if (!previous) return c.json({ success: false, error: '找不到改善方案。' }, 404);
    if (previous.status !== 'stale') return c.json({ success: false, error: '只有已失效方案可以重新產生。' }, 409);
    const current = await rebuildCurrentProposal(c, projectId, {
      recommendationId: previous.recommendationId,
      ruleCode: previous.ruleCode,
      sourceEntityId: previous.sourceEntityId,
      allowFallback: true,
    });
    if (!current) return c.json({ success: false, error: '目前已沒有可重新產生的對應建議。' }, 409);

    const proposalId = await createProposalDraft(c.env.smart_menu_db, {
      proposal: current.proposal,
      proposalType: current.proposalType,
      sourceEntityId: current.recommendation.entityId,
      actorUserId: text(c.get('userId')),
      sourceFacts: current.recommendation.evidence,
      regeneratedFromId: previous.id,
    });
    const stored = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, proposalId);
    if (!stored) throw new Error('PROPOSAL_REGENERATE_READ_FAILED');
    return c.json({ success: true, proposal: proposalResponse(stored, text(c.get('userRole')), true) }, 201);
  } catch (error: any) {
    return proposalApiError(c, error, '改善方案重新產生失敗。');
  }
});

function operationApiError(c: any, error: unknown) {
  const code = error instanceof OperationPolicyError
    ? error.code
    : error instanceof OperationExecutionError
      ? error.code
    : (error as { message?: string })?.message === 'FORBIDDEN_ROLE'
      ? 'FORBIDDEN_ROLE'
      : 'EXECUTION_FAILED';
  if (error instanceof OperationPolicyError) {
    const status = code === 'ROLE_NOT_ALLOWED' ? 403 : code === 'CONFIRMATION_REQUIRED' ? 400 : 409;
    return c.json({ success: false, code, error: policyReasonMessage(error.code) }, status);
  }
  const status = code === 'FORBIDDEN_ROLE'
    ? 403
    : code === 'PROPOSAL_NOT_FOUND' || code === 'TARGET_NOT_FOUND'
      ? 404
      : code === 'EXECUTION_FAILED' || code === 'VERIFICATION_FAILED'
        ? 500
        : 409;
  if (status === 500) {
    console.error(JSON.stringify({ message: 'proposal operation failed', code }));
  }
  return c.json({ success: false, code, error: operationErrorMessage(code) }, status);
}

async function markExecutionProposalStale(c: any, proposal: StoredProposal, reason: string): Promise<void> {
  if (proposal.status !== 'approved') return;
  try {
    await transitionStoredProposal(c.env.smart_menu_db, {
      proposal,
      toStatus: 'stale',
      eventType: 'STALE_DETECTED',
      eventMetadata: { reason },
    });
  } catch (error: any) {
    if (!['PROPOSAL_CONFLICT', 'INVALID_PROPOSAL_TRANSITION'].includes(error?.message)) throw error;
  }
}

app.post('/api/projects/:projectId/proposals/:proposalId/https-probe', async (c) => {
  try {
    requireRole(c, 'editor');
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    let proposal = await getStoredProposal(
      c.env.smart_menu_db,
      workspaceId,
      projectId,
      c.req.param('proposalId'),
    );
    if (!proposal) throw new OperationExecutionError('PROPOSAL_NOT_FOUND');
    proposal = await refreshStaleStatus(c, proposal);
    if (proposal.status === 'stale') throw new OperationExecutionError('PROPOSAL_STALE');
    if (proposal.status === 'executed') throw new OperationExecutionError('PROPOSAL_ALREADY_EXECUTED');
    if (proposal.proposalType !== 'https-upgrade-candidate') {
      throw new OperationExecutionError('PROPOSAL_NOT_EXECUTABLE');
    }

    const current = await rebuildCurrentProposal(c, projectId, {
      recommendationId: proposal.recommendationId,
    });
    if (!current || current.proposalType !== proposal.proposalType) {
      await markExecutionProposalStale(c, proposal, 'CURRENT_PROPOSAL_NOT_FOUND');
      throw new OperationExecutionError('PROPOSAL_STALE');
    }
    const currentFingerprint = await fingerprintProposal(
      current.proposal,
      current.proposalType,
      current.recommendation.evidence,
    );
    if (currentFingerprint !== proposal.sourceFingerprint) {
      await markExecutionProposalStale(c, proposal, 'SOURCE_FINGERPRINT_MISMATCH');
      throw new OperationExecutionError('PROPOSAL_STALE');
    }

    const change = current.proposal.changes[0];
    const area = current.context.areas.find(item => item.id === change?.entityId);
    if (!area?.recordId || area.actionType !== 'uri') {
      throw new OperationExecutionError('TARGET_NOT_FOUND');
    }
    const result = await probeHttpsUpgradeCandidate({ originalUrl: area.uri });
    const saved = await saveHttpsProbeResult(c.env.smart_menu_db, {
      workspaceId,
      proposalId: proposal.id,
      projectId,
      projectAreaId: area.recordId,
      actorUserId: text(c.get('userId')),
      result,
    });
    const publicProbe = await toPublicHttpsProbe(saved, area.uri);
    return c.json({
      success: true,
      httpsProbe: publicProbe,
      proposal: proposalResponse(
        proposal,
        text(c.get('userRole')),
        true,
        publicProbe.eligibility,
      ),
    });
  } catch (error: unknown) {
    return operationApiError(c, error);
  }
});

app.post('/api/projects/:projectId/proposals/:proposalId/execute', async (c) => {
  try {
    requireRole(c, 'admin');
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    let proposal = await getStoredProposal(
      c.env.smart_menu_db,
      workspaceId,
      projectId,
      c.req.param('proposalId'),
    );
    if (!proposal) throw new OperationExecutionError('PROPOSAL_NOT_FOUND');
    const probeState = await loadHttpsProbeState(c, proposal);
    const policyEvaluation = evaluateOperationPolicy({
      proposal,
      actorRole: text(c.get('userRole')),
      action: 'execute',
      context: {
        confirmationProvided: body.confirmation === true,
        probeEligibility: probeState.eligibility,
      },
    });
    if (proposal.status === 'executed') throw new OperationExecutionError('PROPOSAL_ALREADY_EXECUTED');
    if (proposal.status === 'stale') throw new OperationExecutionError('PROPOSAL_STALE');
    if (proposal.status !== 'approved'
      && policyEvaluation.allowed === false
      && ['REVIEW_REQUIRED', 'APPROVAL_REQUIRED'].includes(policyEvaluation.reasonCode)
    ) {
      throw new OperationExecutionError('PROPOSAL_NOT_APPROVED');
    }
    assertPolicyAllowed(policyEvaluation);
    if (body.confirmation !== true) throw new OperationExecutionError('CONFIRMATION_REQUIRED');

    const current = await rebuildCurrentProposal(c, projectId, {
      recommendationId: proposal.recommendationId,
    });
    if (!current || current.proposalType !== proposal.proposalType) {
      await markExecutionProposalStale(c, proposal, 'CURRENT_PROPOSAL_NOT_FOUND');
      throw new OperationExecutionError('PROPOSAL_STALE');
    }
    const currentFingerprint = await fingerprintProposal(
      current.proposal,
      current.proposalType,
      current.recommendation.evidence,
    );
    if (currentFingerprint !== proposal.sourceFingerprint) {
      await markExecutionProposalStale(c, proposal, 'SOURCE_FINGERPRINT_MISMATCH');
      throw new OperationExecutionError('PROPOSAL_STALE');
    }

    const preflight = buildExecutionPreflight({
      proposal,
      actorRole: text(c.get('userRole')),
      confirmationProvided: body.confirmation === true,
      fingerprintMatches: true,
      currentStateValid: true,
      probeEligibility: probeState.eligibility,
    });
    const operationPlan = buildOperationPlan({
      proposal,
      currentProposal: current.proposal,
      context: current.context,
      actor: {
        userId: text(c.get('userId')),
        role: text(c.get('userRole')),
      },
      httpsProbe: { record: probeState.record, eligibility: probeState.eligibility },
      policyAudit: policyAuditMetadata(preflight),
    });
    const operationLog = await executeOperationPlan(
      c.env.smart_menu_db,
      operationPlan,
      currentFingerprint,
    );
    proposal = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, proposal.id);
    if (!proposal || proposal.status !== 'executed') {
      throw new OperationExecutionError('VERIFICATION_FAILED');
    }
    const [proposalEvents, operationLogs] = await Promise.all([
      listProposalEvents(c.env.smart_menu_db, workspaceId, proposal.id),
      listOperationLogs(c.env.smart_menu_db, workspaceId, projectId, proposal.id),
    ]);
    const events = [...proposalEvents, ...operationLogEvents(operationLogs)]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    return c.json({
      success: true,
      proposal: proposalResponse(
        proposal,
        text(c.get('userRole')),
        true,
        operationPlan.probe ? 'SAFE' : 'NEEDS_PROBE',
      ),
      operation: { plan: publicOperationPlan(operationPlan), log: publicOperationLog(operationLog) },
      operationLogs: publicOperationLogs(operationLogs),
      events,
    });
  } catch (error: unknown) {
    return operationApiError(c, error);
  }
});


function rollbackApiError(c: any, error: unknown) {
  if (error instanceof OperationPolicyError) {
    const status = error.code === 'ROLE_NOT_ALLOWED' ? 403 : error.code === 'CONFIRMATION_REQUIRED' ? 400 : 409;
    return c.json({ success: false, code: error.code, error: policyReasonMessage(error.code) }, status);
  }
  const code = error instanceof RollbackExecutionError
    ? error.code
    : (error as { message?: string })?.message === 'FORBIDDEN_ROLE'
      ? 'ROLLBACK_FORBIDDEN'
      : 'ROLLBACK_EXECUTION_FAILED';
  const status = code === 'ROLLBACK_FORBIDDEN'
    ? 403
    : code === 'ROLLBACK_TARGET_NOT_FOUND' || code === 'ROLLBACK_TENANT_MISMATCH'
      ? 404
      : code === 'ROLLBACK_EXECUTION_FAILED' || code === 'ROLLBACK_VERIFICATION_FAILED'
        ? 500
        : 409;
  if (status === 500) console.error(JSON.stringify({ message: 'proposal rollback failed', code }));
  return c.json({ success: false, code, error: rollbackErrorMessage(code) }, status);
}

app.get('/api/projects/:projectId/proposals/:proposalId/rollback-preview', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    const proposal = await getStoredProposal(
      c.env.smart_menu_db,
      workspaceId,
      projectId,
      c.req.param('proposalId'),
    );
    if (!proposal) throw new RollbackExecutionError('ROLLBACK_NOT_AVAILABLE');
    const policyEvaluation = evaluateOperationPolicy({
      proposal,
      actorRole: text(c.get('userRole')),
      action: 'rollback',
      context: { confirmationProvided: true, rollbackAvailable: true },
    });
    assertPolicyAllowed(policyEvaluation);
    const rollbackContext = await buildRollbackContext({
      db: c.env.smart_menu_db,
      proposal,
      role: text(c.get('userRole')),
    });
    return c.json({ success: true, rollbackPreview: rollbackContext.preview });
  } catch (error: unknown) {
    return rollbackApiError(c, error);
  }
});

app.post('/api/projects/:projectId/proposals/:proposalId/rollback', async (c) => {
  try {
    requireRole(c, 'admin');
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    const proposal = await getStoredProposal(
      c.env.smart_menu_db,
      workspaceId,
      projectId,
      c.req.param('proposalId'),
    );
    if (!proposal) throw new RollbackExecutionError('ROLLBACK_NOT_AVAILABLE');
    const policyEvaluation = evaluateOperationPolicy({
      proposal,
      actorRole: text(c.get('userRole')),
      action: 'rollback',
      context: {
        confirmationProvided: body.confirmation === true,
        rollbackAvailable: true,
      },
    });
    assertPolicyAllowed(policyEvaluation);
    if (body.confirmation !== true) throw new RollbackExecutionError('ROLLBACK_CONFIRMATION_REQUIRED');
    const rollbackContext = await buildRollbackContext({
      db: c.env.smart_menu_db,
      proposal,
      role: text(c.get('userRole')),
    });
    const rollbackPlan = buildRollbackPlan({
      proposal,
      operationLog: rollbackContext.operationLog,
      currentTarget: rollbackContext.currentTarget,
      actor: { userId: text(c.get('userId')), role: text(c.get('userRole')) },
    });
    const rollbackLog = await executeRollbackPlan(c.env.smart_menu_db, rollbackPlan);
    const [operationLogs, proposalEvents, refreshedRollback] = await Promise.all([
      listOperationLogs(c.env.smart_menu_db, workspaceId, projectId, proposal.id),
      listProposalEvents(c.env.smart_menu_db, workspaceId, proposal.id),
      buildRollbackContext({ db: c.env.smart_menu_db, proposal, role: text(c.get('userRole')) }),
    ]);
    const events = [...proposalEvents, ...operationLogEvents(operationLogs)]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    return c.json({
      success: true,
      proposal: proposalResponse(
        proposal,
        text(c.get('userRole')),
        true,
        'NEEDS_PROBE',
        refreshedRollback.preview.eligible === true,
      ),
      rollback: { plan: publicRollbackPlan(rollbackPlan), log: publicOperationLog(rollbackLog) },
      rollbackPreview: refreshedRollback.preview,
      operationLogs: publicOperationLogs(operationLogs),
      events,
    });
  } catch (error: unknown) {
    return rollbackApiError(c, error);
  }
});

class CompositePlanApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.details = details;
    this.name = 'CompositePlanApiError';
  }
}

function compositePlanErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    PLAN_NOT_FOUND: '找不到執行計畫。',
    PLAN_PROPOSAL_NOT_FOUND: '找不到選取的改善方案。',
    INVALID_PLAN_SELECTION: '請選擇 1 至 20 個改善方案。',
    DUPLICATE_PROPOSAL: '同一個改善方案不能重複加入計畫。',
    PLAN_CONFLICT: '兩個改善方案要修改同一個欄位，無法建立安全執行計畫。',
    TARGET_MISSING: '改善方案指定的目標已不存在。',
    STALE_PROPOSAL: '改善方案已失效，請重新產生。',
    EXPIRED_PROBE: 'HTTPS SAFE Probe 已過期。',
    CROSS_WORKSPACE_TARGET: '找不到選取的改善方案或目標。',
    PROPOSAL_ALREADY_EXECUTED: '已執行的改善方案不能加入新的執行計畫。',
    PLAN_CONTAINS_NON_EXECUTABLE_PROPOSAL: '此計畫包含目前不可執行的改善方案。',
    POLICY_VERSION_MISMATCH: '執行政策版本已變更，請重新建立計畫。',
    PLAN_CREATE_CONFLICT: '執行計畫建立衝突，請重新整理。',
    PLAN_CONFLICT_STATE: '執行計畫已被其他操作更新。',
    INVALID_PLAN_TRANSITION: '此執行計畫目前不能執行該狀態操作。',
    PLAN_NOT_APPROVED: '只有已核准的執行計畫可以執行。',
    PLAN_ALREADY_EXECUTING: '此執行計畫正在執行中。',
    PLAN_ALREADY_EXECUTED: '此執行計畫已經執行完成。',
    PLAN_EXECUTION_CONFLICT: '執行計畫狀態已被其他請求更新。',
    PLAN_ROLE_NOT_ALLOWED: '只有 admin 或 owner 可以執行計畫。',
    CONFIRMATION_REQUIRED: '請明確確認執行正式專案修改。',
    PRECHECK_FAILED: '最終安全檢查未通過，計畫沒有開始執行。',
    PLAN_FINALIZE_CONFLICT: '計畫完成狀態寫入衝突，請立即檢查執行紀錄。',
    PLAN_RUN_NOT_FOUND: '找不到本次執行紀錄。',
  };
  return messages[code] || '執行計畫操作失敗。';
}

function compositePlanApiError(c: any, error: unknown) {
  if (error instanceof CompositePlanError || error instanceof CompositePlanApiError) {
    const code = error.code;
    const status = ['PLAN_NOT_FOUND', 'PLAN_PROPOSAL_NOT_FOUND'].includes(code)
      ? 404
      : ['INVALID_PLAN_SELECTION'].includes(code)
        ? 400
        : 409;
    return c.json({
      success: false,
      code,
      error: compositePlanErrorMessage(code),
      ...(error.details ? { details: error.details } : {}),
    }, status);
  }
  const message = (error as { message?: string })?.message || '';
  if (message.startsWith('PLAN_') || message === 'INVALID_PLAN_TRANSITION') {
    const code = message === 'PLAN_CONFLICT' ? 'PLAN_CONFLICT_STATE' : message;
    return c.json({ success: false, code, error: compositePlanErrorMessage(code) }, 409);
  }
  console.error(JSON.stringify({ message: 'composite operation plan failed', status: 'error' }));
  return c.json({ success: false, code: 'PLAN_OPERATION_FAILED', error: '執行計畫操作失敗。' }, 500);
}

function assertCompositePlanPolicy(evaluation: ReturnType<typeof evaluateCompositePlanPolicy>): void {
  if (!evaluation.allowed) {
    throw new CompositePlanApiError(evaluation.reasonCode, {
      message: compositePlanPolicyMessage(evaluation.reasonCode),
    });
  }
}

function compositePlanResponse(plan: CompositeOperationPlan, actorRole: string, actorUserId: string) {
  const policy = evaluateCompositePlanPolicy({
    actorRole,
    actorUserId,
    action: 'view',
    status: plan.status,
    createdByUserId: plan.createdByUserId,
    preflightAllowed: plan.preflight.allowed,
    riskLevel: plan.riskLevel,
  });
  return {
    id: plan.id,
    projectId: plan.projectId,
    title: plan.title,
    status: plan.status,
    riskLevel: plan.riskLevel,
    riskReason: compositeRiskReason(plan.riskLevel),
    policyVersion: plan.policyVersion,
    steps: plan.steps.map(step => ({
      id: step.id,
      sequence: step.sequence,
      proposalId: step.proposalId,
      proposalType: step.proposalType,
      operationType: step.operationType,
      riskLevel: step.riskLevel,
      targetEntityType: step.targetEntityType,
      targetEntityId: step.targetEntityId,
      dependencies: step.dependencies,
      executable: step.executable,
      rollbackSupported: step.rollbackSupported,
      requirements: step.requirements,
      snapshot: {
        title: step.snapshot.title,
        field: step.snapshot.field,
        before: step.snapshot.before,
        after: step.snapshot.after,
        proposalStatus: step.snapshot.proposalStatus,
        fingerprintMatches: step.snapshot.fingerprintMatches,
        targetExists: step.snapshot.targetExists,
        targetInWorkspace: step.snapshot.targetInWorkspace,
        probeEligibility: step.snapshot.probeEligibility,
      },
    })),
    preflight: plan.preflight,
    sourceFingerprint: plan.sourceFingerprint,
    createdByUserId: plan.createdByUserId,
    reviewedByUserId: plan.reviewedByUserId,
    approvedByUserId: plan.approvedByUserId,
    cancelledByUserId: plan.cancelledByUserId,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    reviewedAt: plan.reviewedAt,
    approvedAt: plan.approvedAt,
    cancelledAt: plan.cancelledAt,
    capabilities: policy.capabilities,
    execution: {
      enabled: policy.capabilities.canExecute && plan.preflight.allowed,
      message: plan.status === 'approved'
        ? policy.capabilities.canExecute && plan.preflight.allowed
          ? '計畫已核准並通過目前安全檢查，可進行最終執行確認。'
          : '計畫目前未通過執行權限或安全檢查。'
        : plan.status === 'executing'
          ? '執行計畫進行中。'
          : plan.status === 'executed'
            ? '執行計畫已完成。'
            : '此計畫目前不可執行。',
    },
  };
}

function blockedCompositePreflight(plan: CompositeOperationPlan, reason: string) {
  const code = reason === 'TARGET_MISSING'
    ? 'ALL_TARGETS_EXIST'
    : reason === 'CROSS_WORKSPACE_TARGET'
      ? 'ALL_TARGETS_IN_WORKSPACE'
      : reason === 'POLICY_VERSION_MISMATCH'
        ? 'POLICY_VERSION_VALID'
        : reason === 'PROPOSAL_ALREADY_EXECUTED'
          ? 'ALL_STEPS_EXECUTABLE'
          : 'ALL_FINGERPRINTS_MATCH';
  return {
    allowed: false,
    result: 'BLOCKED' as const,
    checks: plan.preflight.checks.map(check => check.code === code
      ? { ...check, passed: false, message: reason }
      : check),
  };
}

async function refreshCompositePlan(c: any, storedPlan: CompositeOperationPlan): Promise<CompositeOperationPlan> {
  const workspaceId = workspaceIdOf(c);
  if (storedPlan.workspaceId !== workspaceId || storedPlan.projectId !== c.req.param('projectId')) {
    throw new CompositePlanApiError('PLAN_NOT_FOUND');
  }
  if (!['draft', 'reviewed', 'approved'].includes(storedPlan.status)) {
    return storedPlan;
  }
  const context = await buildGuideContext({
    db: c.env.smart_menu_db,
    workspaceId,
    userId: text(c.get('userId')),
    route: `/projects/${storedPlan.projectId}`,
    entityType: 'project',
    entityId: storedPlan.projectId,
  });
  if (!context) throw new CompositePlanApiError('PLAN_NOT_FOUND');
  let staleReason = '';
  const proposalInputs: Array<{
    proposal: StoredProposal;
    fingerprintMatches: boolean;
    probeEligibility: HttpsProbeEligibility;
  }> = [];
  for (const step of storedPlan.steps) {
    let proposal = await getStoredProposal(
      c.env.smart_menu_db,
      workspaceId,
      storedPlan.projectId,
      step.proposalId,
    );
    if (!proposal) {
      staleReason = 'TARGET_MISSING';
      break;
    }
    proposal = await refreshStaleStatus(c, proposal);
    if (proposal.status === 'stale') {
      staleReason = 'STALE_PROPOSAL';
      break;
    }
    if (proposal.status === 'executed') {
      staleReason = 'PROPOSAL_ALREADY_EXECUTED';
      break;
    }
    const probe = await loadHttpsProbeState(c, proposal);
    proposalInputs.push({
      proposal,
      fingerprintMatches: proposal.sourceFingerprint === step.snapshot.proposalFingerprint,
      probeEligibility: probe.eligibility,
    });
  }
  let rebuilt: CompositeOperationPlan | null = null;
  if (!staleReason) {
    try {
      rebuilt = await buildCompositeOperationPlan({
        id: storedPlan.id,
        workspaceId,
        projectId: storedPlan.projectId,
        title: storedPlan.title,
        proposals: proposalInputs,
        context,
        actorUserId: storedPlan.createdByUserId,
        now: storedPlan.createdAt,
      });
      if (rebuilt.sourceFingerprint !== storedPlan.sourceFingerprint) staleReason = 'STALE_PROPOSAL';
    } catch (error) {
      if (error instanceof CompositePlanError) staleReason = error.code;
      else throw error;
    }
  }
  if (staleReason) {
    const preflight = blockedCompositePreflight(storedPlan, staleReason);
    if (['draft', 'reviewed', 'approved'].includes(storedPlan.status)) {
      try {
        await transitionStoredCompositePlan(c.env.smart_menu_db, {
          plan: storedPlan,
          toStatus: 'stale',
          preflight,
          metadata: { reason: staleReason },
        });
      } catch (error: any) {
        if (!['PLAN_CONFLICT', 'INVALID_PLAN_TRANSITION'].includes(error?.message)) throw error;
      }
      const stale = await getStoredCompositePlan(
        c.env.smart_menu_db,
        workspaceId,
        storedPlan.projectId,
        storedPlan.id,
      );
      if (stale) return { ...stale, preflight };
    }
    return { ...storedPlan, status: storedPlan.status === 'cancelled' ? 'cancelled' : 'stale', preflight };
  }
  const live = {
    ...storedPlan,
    steps: rebuilt!.steps,
    preflight: rebuilt!.preflight,
    riskLevel: rebuilt!.riskLevel,
  };
  if (
    ['draft', 'reviewed', 'approved'].includes(storedPlan.status)
    && JSON.stringify(storedPlan.preflight) !== JSON.stringify(live.preflight)
  ) {
    try {
      await updateCompositePlanPreflight(c.env.smart_menu_db, storedPlan, live.preflight);
    } catch (error: any) {
      if (error?.message !== 'PLAN_CONFLICT') throw error;
    }
  }
  return live;
}

async function loadCompositePlanOr404(c: any): Promise<CompositeOperationPlan> {
  const plan = await getStoredCompositePlan(
    c.env.smart_menu_db,
    workspaceIdOf(c),
    c.req.param('projectId'),
    c.req.param('planId'),
  );
  if (!plan) throw new CompositePlanApiError('PLAN_NOT_FOUND');
  return refreshCompositePlan(c, plan);
}

app.post('/api/projects/:projectId/operation-plans', async (c) => {
  try {
    requireRole(c, 'editor');
    const planPolicy = evaluateCompositePlanPolicy({
      actorRole: text(c.get('userRole')),
      action: 'create',
    });
    assertCompositePlanPolicy(planPolicy);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const proposalIds = Array.isArray(body.proposalIds)
      ? body.proposalIds.map(text).filter(Boolean)
      : [];
    if (proposalIds.length < 1 || proposalIds.length > 20) {
      throw new CompositePlanApiError('INVALID_PLAN_SELECTION');
    }
    const workspaceId = workspaceIdOf(c);
    const projectId = c.req.param('projectId');
    const context = await buildGuideContext({
      db: c.env.smart_menu_db,
      workspaceId,
      userId: text(c.get('userId')),
      route: `/projects/${projectId}`,
      entityType: 'project',
      entityId: projectId,
    });
    if (!context) throw new CompositePlanApiError('PLAN_NOT_FOUND');
    const inputs = [];
    for (const proposalId of proposalIds) {
      let proposal = await getStoredProposal(c.env.smart_menu_db, workspaceId, projectId, proposalId);
      if (!proposal) throw new CompositePlanApiError('PLAN_PROPOSAL_NOT_FOUND');
      proposal = await refreshStaleStatus(c, proposal);
      const probe = await loadHttpsProbeState(c, proposal);
      inputs.push({ proposal, fingerprintMatches: proposal.status !== 'stale', probeEligibility: probe.eligibility });
    }
    const planId = `aiop_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const plan = await buildCompositeOperationPlan({
      id: planId,
      workspaceId,
      projectId,
      proposals: inputs,
      context,
      actorUserId: text(c.get('userId')),
    });
    await createStoredCompositePlan(c.env.smart_menu_db, plan);
    const stored = await getStoredCompositePlan(c.env.smart_menu_db, workspaceId, projectId, planId);
    if (!stored) throw new Error('PLAN_CREATE_READ_FAILED');
    return c.json({
      success: true,
      plan: compositePlanResponse(stored, text(c.get('userRole')), text(c.get('userId'))),
    }, 201);
  } catch (error) {
    return compositePlanApiError(c, error);
  }
});

app.get('/api/projects/:projectId/operation-plans', async (c) => {
  try {
    const plans = await listStoredCompositePlans(
      c.env.smart_menu_db,
      workspaceIdOf(c),
      c.req.param('projectId'),
    );
    const refreshed = await Promise.all(plans.map(plan => refreshCompositePlan(c, plan)));
    const permissionPolicy = evaluateCompositePlanPolicy({
      actorRole: text(c.get('userRole')),
      action: 'view',
    });
    return c.json({
      success: true,
      plans: refreshed.map(plan => compositePlanResponse(plan, text(c.get('userRole')), text(c.get('userId')))),
      permissions: permissionPolicy.capabilities,
    });
  } catch (error) {
    return compositePlanApiError(c, error);
  }
});

app.get('/api/projects/:projectId/operation-plans/:planId', async (c) => {
  try {
    const plan = await loadCompositePlanOr404(c);
    const [events, runs] = await Promise.all([
      listCompositePlanEvents(
        c.env.smart_menu_db,
        workspaceIdOf(c),
        c.req.param('projectId'),
        plan.id,
      ),
      listPlanExecutionRuns(
        c.env.smart_menu_db,
        workspaceIdOf(c),
        c.req.param('projectId'),
        plan.id,
      ),
    ]);
    return c.json({
      success: true,
      plan: compositePlanResponse(plan, text(c.get('userRole')), text(c.get('userId'))),
      events,
      runs,
    });
  } catch (error) {
    return compositePlanApiError(c, error);
  }
});

async function transitionCompositePlanRoute(c: any, action: 'review' | 'approve' | 'cancel') {
  try {
    requireRole(c, action === 'approve' ? 'admin' : 'editor');
    const plan = await loadCompositePlanOr404(c);
    const evaluation = evaluateCompositePlanPolicy({
      actorRole: text(c.get('userRole')),
      actorUserId: text(c.get('userId')),
      action,
      status: plan.status,
      createdByUserId: plan.createdByUserId,
      preflightAllowed: plan.preflight.allowed,
      riskLevel: plan.riskLevel,
    });
    assertCompositePlanPolicy(evaluation);
    const toStatus = action === 'review' ? 'reviewed' : action === 'approve' ? 'approved' : 'cancelled';
    await transitionStoredCompositePlan(c.env.smart_menu_db, {
      plan,
      toStatus,
      actorUserId: text(c.get('userId')),
      preflight: plan.preflight,
    });
    const updated = await getStoredCompositePlan(
      c.env.smart_menu_db,
      workspaceIdOf(c),
      c.req.param('projectId'),
      plan.id,
    );
    if (!updated) throw new CompositePlanApiError('PLAN_NOT_FOUND');
    return c.json({
      success: true,
      plan: compositePlanResponse(updated, text(c.get('userRole')), text(c.get('userId'))),
    });
  } catch (error) {
    if (error instanceof CompositePlanApiError && error.code.startsWith('PLAN_')) {
      const reason = error.code as Parameters<typeof compositePlanPolicyMessage>[0];
      if (['PLAN_ROLE_NOT_ALLOWED', 'PLAN_REVIEW_REQUIRED', 'PLAN_PREFLIGHT_BLOCKED', 'PLAN_HIGH_RISK_APPROVAL_DISABLED', 'PLAN_STATUS_NOT_ALLOWED'].includes(reason)) {
        const status = reason === 'PLAN_ROLE_NOT_ALLOWED' ? 403 : 409;
        return c.json({ success: false, code: reason, error: compositePlanPolicyMessage(reason) }, status);
      }
    }
    return compositePlanApiError(c, error);
  }
}

app.post('/api/projects/:projectId/operation-plans/:planId/review', c => transitionCompositePlanRoute(c, 'review'));
app.post('/api/projects/:projectId/operation-plans/:planId/approve', c => transitionCompositePlanRoute(c, 'approve'));
app.post('/api/projects/:projectId/operation-plans/:planId/cancel', c => transitionCompositePlanRoute(c, 'cancel'));

async function prepareCompositeExecutionStep(
  c: any,
  plan: CompositeOperationPlan,
  step: OperationPlanStep,
): Promise<PreparedPlanStep> {
  let proposal = await getStoredProposal(
    c.env.smart_menu_db,
    plan.workspaceId,
    plan.projectId,
    step.proposalId,
  );
  if (!proposal) throw new CompositeExecutionError('PLAN_PROPOSAL_NOT_FOUND');
  proposal = await refreshStaleStatus(c, proposal);
  if (proposal.status === 'executed') throw new CompositeExecutionError('PROPOSAL_ALREADY_EXECUTED');
  if (proposal.status === 'stale') throw new CompositeExecutionError('STALE_PROPOSAL');
  if (proposal.status !== 'approved') throw new CompositeExecutionError('PLAN_NOT_APPROVED');

  const current = await rebuildCurrentProposal(c, plan.projectId, {
    recommendationId: proposal.recommendationId,
  });
  if (!current || current.proposalType !== proposal.proposalType) {
    await markExecutionProposalStale(c, proposal, 'CURRENT_PROPOSAL_NOT_FOUND');
    throw new CompositeExecutionError('STALE_PROPOSAL');
  }
  const currentFingerprint = await fingerprintProposal(
    current.proposal,
    current.proposalType,
    current.recommendation.evidence,
  );
  if (currentFingerprint !== proposal.sourceFingerprint) {
    await markExecutionProposalStale(c, proposal, 'SOURCE_FINGERPRINT_MISMATCH');
    throw new CompositeExecutionError('STALE_PROPOSAL');
  }

  const probeState = await loadHttpsProbeState(c, proposal);
  const preflight = buildExecutionPreflight({
    proposal,
    actorRole: text(c.get('userRole')),
    confirmationProvided: true,
    fingerprintMatches: true,
    currentStateValid: true,
    probeEligibility: probeState.eligibility,
  });
  if (!preflight.allowed) throw new CompositeExecutionError('PRECHECK_FAILED');

  const operationPlan = buildOperationPlan({
    proposal,
    currentProposal: current.proposal,
    context: current.context,
    actor: { userId: text(c.get('userId')), role: text(c.get('userRole')) },
    httpsProbe: { record: probeState.record, eligibility: probeState.eligibility },
    policyAudit: policyAuditMetadata(preflight),
  });
  if (
    operationPlan.operationType !== step.operationType
    || operationPlan.target.entityId !== step.targetEntityId
    || proposal.workspaceId !== plan.workspaceId
    || proposal.projectId !== plan.projectId
  ) throw new CompositeExecutionError('PRECHECK_FAILED');

  return { step, proposal, operationPlan, sourceFingerprint: currentFingerprint };
}

app.post('/api/projects/:projectId/operation-plans/:planId/execute', async (c) => {
  try {
    requireRole(c, 'admin');
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const plan = await loadCompositePlanOr404(c);
    if (plan.status === 'executing') throw new CompositeExecutionError('PLAN_ALREADY_EXECUTING');
    if (plan.status === 'executed') throw new CompositeExecutionError('PLAN_ALREADY_EXECUTED');
    const policy = evaluateCompositePlanPolicy({
      actorRole: text(c.get('userRole')),
      actorUserId: text(c.get('userId')),
      action: 'execute',
      status: plan.status,
      createdByUserId: plan.createdByUserId,
      preflightAllowed: plan.preflight.allowed,
      riskLevel: plan.riskLevel,
    });
    assertCompositePlanPolicy(policy);
    const run = await executeCompositeOperationPlan({
      db: c.env.smart_menu_db,
      plan,
      actor: { userId: text(c.get('userId')), role: text(c.get('userRole')) },
      confirmation: body.confirmation === true,
      prepareStep: step => prepareCompositeExecutionStep(c, plan, step),
      executeStep: prepared => executeOperationPlan(
        c.env.smart_menu_db,
        prepared.operationPlan,
        prepared.sourceFingerprint,
      ),
      rollbackStep: async (prepared, operationLog) => {
        const proposal = await getStoredProposal(
          c.env.smart_menu_db,
          plan.workspaceId,
          plan.projectId,
          prepared.proposal.id,
        );
        if (!proposal) throw new RollbackExecutionError('ROLLBACK_NOT_AVAILABLE');
        const rollbackContext = await buildRollbackContext({
          db: c.env.smart_menu_db,
          proposal,
          role: text(c.get('userRole')),
        });
        if (rollbackContext.operationLog?.id !== operationLog.id) {
          throw new RollbackExecutionError('ROLLBACK_NOT_AVAILABLE');
        }
        const rollbackPlan = buildRollbackPlan({
          proposal,
          operationLog: rollbackContext.operationLog,
          currentTarget: rollbackContext.currentTarget,
          actor: { userId: text(c.get('userId')), role: text(c.get('userRole')) },
        });
        return executeRollbackPlan(c.env.smart_menu_db, rollbackPlan);
      },
    });
    const updated = await getStoredCompositePlan(
      c.env.smart_menu_db,
      plan.workspaceId,
      plan.projectId,
      plan.id,
    );
    if (!updated) throw new CompositeExecutionError('PLAN_NOT_FOUND');
    const [events, runs] = await Promise.all([
      listCompositePlanEvents(c.env.smart_menu_db, plan.workspaceId, plan.projectId, plan.id),
      listPlanExecutionRuns(c.env.smart_menu_db, plan.workspaceId, plan.projectId, plan.id),
    ]);
    return c.json({
      success: true,
      plan: compositePlanResponse(updated, text(c.get('userRole')), text(c.get('userId'))),
      run,
      runs,
      events,
      refresh: ['guide', 'recommendations'],
    });
  } catch (error: unknown) {
    if (error instanceof CompositeExecutionError) {
      const status = error.code === 'PLAN_ROLE_NOT_ALLOWED' ? 403
        : error.code === 'CONFIRMATION_REQUIRED' ? 400 : 409;
      return c.json({
        success: false,
        code: error.code,
        error: compositePlanErrorMessage(error.code),
        ...(error.preflight ? { preflight: error.preflight } : {}),
      }, status);
    }
    return compositePlanApiError(c, error);
  }
});

app.get('/api/projects/:projectId/intelligence/summary', async (c) => {
  try {
    const workspaceId = workspaceIdOf(c); const projectId = c.req.param('projectId');
    const project: any = await c.env.smart_menu_db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL').bind(projectId, workspaceId).first();
    if (!project) return c.json({ success: false, error: 'Project not found.' }, 404);
    const from = text(c.req.query('from')) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10); const to = text(c.req.query('to')) || new Date().toISOString().slice(0, 10);
    const rows: any[] = (await c.env.smart_menu_db.prepare("SELECT * FROM line_intelligence_daily WHERE workspace_id=? AND project_id=? AND project_area_id='' AND metric_date>=? AND metric_date<=? ORDER BY metric_date").bind(workspaceId, projectId, from, to).all()).results || [];
    const areaRows: any[] = (await c.env.smart_menu_db.prepare("SELECT * FROM line_intelligence_daily WHERE workspace_id=? AND project_id=? AND project_area_id<>'' AND metric_date>=? AND metric_date<=?").bind(workspaceId, projectId, from, to).all()).results || [];
    const areas: any[] = (await c.env.smart_menu_db.prepare('SELECT id,label,action_type FROM project_areas WHERE workspace_id=? AND project_id=? ORDER BY area_index').bind(workspaceId, projectId).all()).results || [];
    const suppressed = rows.some(row => row.data_status === 'privacy_suppressed'); const sum = (key: string) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    const mapped = areas.map(area => { const metrics = areaRows.filter(row => row.project_area_id === area.id); const value = (key: string) => metrics.reduce((total, row) => total + Number(row[key] || 0), 0); const status = metrics.some(row => row.data_status === 'privacy_suppressed') ? 'privacy_suppressed' : metrics.some(row => row.data_status === 'mapping_unmatched') ? 'mapping_unmatched' : metrics.length ? 'available' : 'unavailable'; return { projectAreaId: area.id, label: area.label, actionType: area.action_type, clicks: status === 'privacy_suppressed' ? null : value('clicks'), uniqueClickers: status === 'privacy_suppressed' ? null : value('click_unique_users'), messageActions: value('message_actions'), postbackActions: value('postback_actions'), switchActions: value('switch_actions'), dataStatus: status }; }).sort((a, b) => Number(b.clicks || 0) - Number(a.clicks || 0));
    const binding: any = await c.env.smart_menu_db.prepare('SELECT line_rich_menu_id,last_synced_at,last_sync_status,status FROM workspace_rich_menu_bindings WHERE workspace_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 1').bind(workspaceId, projectId).first();
    return c.json({ success: true, period: { from, to }, project: { impressions: suppressed ? null : sum('impressions'), uniqueViewers: suppressed ? null : sum('impression_unique_users'), clicks: suppressed ? null : sum('clicks'), uniqueClickers: suppressed ? null : sum('click_unique_users'), ctr: suppressed || !sum('impressions') ? null : sum('clicks') / sum('impressions'), messageActions: sum('message_actions'), postbackActions: sum('postback_actions'), switchActions: sum('switch_actions') }, areas: mapped, privacySuppressed: suppressed, dataFreshness: { lastLineSyncAt: binding?.last_synced_at || null, metricsThrough: rows.map(row => row.metric_date).at(-1) || null, delayed: true }, binding: binding ? { lineRichMenuId: binding.line_rich_menu_id, status: binding.status } : null });
  } catch { return c.json({ success: false, error: 'Unable to load LINE intelligence.' }, 500); }
});

app.get('/api/projects/:projectId/intelligence/daily', async (c) => {
  const workspaceId = workspaceIdOf(c); const projectId = c.req.param('projectId'); const project: any = await c.env.smart_menu_db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL').bind(projectId, workspaceId).first();
  if (!project) return c.json({ success: false, error: 'Project not found.' }, 404);
  const from = text(c.req.query('from')) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10); const to = text(c.req.query('to')) || new Date().toISOString().slice(0, 10);
  const rows: any[] = (await c.env.smart_menu_db.prepare("SELECT metric_date date,impressions,clicks,click_through_rate,data_status FROM line_intelligence_daily WHERE workspace_id=? AND project_id=? AND project_area_id='' AND metric_date>=? AND metric_date<=? ORDER BY metric_date").bind(workspaceId, projectId, from, to).all()).results || [];
  return c.json({ success: true, days: rows.map(row => ({ date: row.date, impressions: row.data_status === 'privacy_suppressed' ? null : Number(row.impressions || 0), clicks: row.data_status === 'privacy_suppressed' ? null : Number(row.clicks || 0), ctr: row.data_status === 'privacy_suppressed' ? null : row.click_through_rate, dataStatus: row.data_status })) });
});

app.post('/api/projects/:projectId/intelligence/bindings', async (c) => {
  try { requireRole(c, 'admin'); const workspaceId = workspaceIdOf(c); const projectId = c.req.param('projectId'); const body: any = await c.req.json(); const richMenuId = text(body.lineRichMenuId, 100); const account: any = await c.env.smart_menu_db.prepare('SELECT * FROM workspace_line_accounts WHERE workspace_id=? LIMIT 1').bind(workspaceId).first(); const project: any = await c.env.smart_menu_db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL').bind(projectId, workspaceId).first(); if (!project) return c.json({ success: false, error: 'Project not found.' }, 404); if (!account?.line_bot_channel_access_token) return c.json({ success: false, error: 'Workspace LINE Bot token is not configured.' }, 409); if (!richMenuId) return c.json({ success: false, error: 'LINE Rich Menu ID is required.' }, 400); const verify = await fetch(`https://api.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}`, { headers: { Authorization: `Bearer ${account.line_bot_channel_access_token}` } }); if (!verify.ok) return c.json({ success: false, error: verify.status === 404 ? 'LINE Rich Menu was not found for this Workspace.' : 'Unable to verify LINE Rich Menu.' }, verify.status === 404 ? 404 : 502); await c.env.smart_menu_db.prepare("INSERT INTO workspace_rich_menu_bindings (id,workspace_id,line_account_id,project_id,line_rich_menu_id,line_rich_menu_alias_id,source,status) VALUES (?,?,?,?,?,?, 'manual_link','active') ON CONFLICT(workspace_id,line_rich_menu_id) DO UPDATE SET project_id=excluded.project_id,line_account_id=excluded.line_account_id,line_rich_menu_alias_id=excluded.line_rich_menu_alias_id,status='active',updated_at=CURRENT_TIMESTAMP").bind(id('lrmb'), workspaceId, account.id, projectId, richMenuId, text(body.lineRichMenuAliasId) || null).run(); return c.json({ success: true }); } catch (error: any) { return c.json({ success: false, error: error?.message === 'FORBIDDEN_ROLE' ? 'Owner or admin role is required.' : 'Unable to link LINE Rich Menu.' }, error?.message === 'FORBIDDEN_ROLE' ? 403 : 500); }
});

app.post('/api/projects/:projectId/intelligence/sync', async (c) => {
  try { requireRole(c, 'admin'); const workspaceId = workspaceIdOf(c); const projectId = c.req.param('projectId'); const binding: any = await c.env.smart_menu_db.prepare("SELECT * FROM workspace_rich_menu_bindings WHERE workspace_id=? AND project_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1").bind(workspaceId, projectId).first(); const account: any = await c.env.smart_menu_db.prepare('SELECT * FROM workspace_line_accounts WHERE workspace_id=? LIMIT 1').bind(workspaceId).first(); if (!binding) return c.json({ success: false, error: 'Link a LINE Rich Menu first.' }, 409); const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10); const priorDate = text(binding.last_synced_at, 10); const from = priorDate && priorDate < yesterday ? priorDate : yesterday; const result = await syncLineRichMenuInsights({ db: c.env.smart_menu_db, workspaceId, projectId, binding, account, from, to: yesterday }); return c.json({ success: true, result }); } catch (error: any) { const code = String(error?.message || ''); return c.json({ success: false, error: code === 'LINE_SYNC_COOLDOWN' ? 'LINE insight sync is limited to once per 15 minutes.' : code === 'LINE_RICH_MENU_UNAVAILABLE' ? 'LINE Rich Menu is unavailable.' : 'Unable to sync LINE insight.' }, code === 'LINE_SYNC_COOLDOWN' ? 429 : 502); }
});

app.get('/api/system/journey-health', async (c) => {
  await requireSystemAdmin(c);
  const rows:any[]=(await c.env.smart_menu_db.prepare("SELECT w.id workspace_id,w.name workspace_name,COALESCE(k.active_key_count,0) active_key_count,e.last_journey_event,v.last_conversion_event,COALESCE(e.webhook_routes,0) webhook_routes,COALESCE(e.webhook_failures,0) webhook_failures,COALESCE(e.mapped_events,0) mapped_events,COALESCE(e.journey_events,0) journey_events FROM workspaces w LEFT JOIN (SELECT workspace_id,COUNT(*) active_key_count FROM workspace_conversion_api_keys WHERE status='active' GROUP BY workspace_id) k ON k.workspace_id=w.id LEFT JOIN (SELECT workspace_id,MAX(occurred_at) last_journey_event,SUM(CASE WHEN event_type='webhook_route' THEN 1 ELSE 0 END) webhook_routes,SUM(CASE WHEN event_type='webhook_failure' THEN 1 ELSE 0 END) webhook_failures,SUM(CASE WHEN project_area_id IS NOT NULL AND project_area_id<>'' THEN 1 ELSE 0 END) mapped_events,COUNT(*) journey_events FROM line_journey_events GROUP BY workspace_id) e ON e.workspace_id=w.id LEFT JOIN (SELECT workspace_id,MAX(occurred_at) last_conversion_event FROM line_conversion_events GROUP BY workspace_id) v ON v.workspace_id=w.id WHERE w.deleted_at IS NULL ORDER BY w.created_at DESC").all()).results||[];
  return c.json({success:true,workspaces:rows.map((row:any)=>{const total=Number(row.journey_events||0),routes=Number(row.webhook_routes||0),mapping=total?Number(row.mapped_events||0)/total:0,reason=!total?'NO_JOURNEY_DATA':!row.last_journey_event||Date.now()-Date.parse(row.last_journey_event)>3*86400000?'STALE_DATA':mapping<.8?'MAPPING_INCOMPLETE':'READY';return {workspaceId:row.workspace_id,workspaceName:row.workspace_name,journeyReady:reason==='READY',journeyReason:reason,conversionIntegrationAvailable:Number(row.active_key_count||0)>0,activeConversionApiKeys:Number(row.active_key_count||0),lastJourneyEvent:row.last_journey_event||null,lastConversionEvent:row.last_conversion_event||null,webhookFailureRate:routes?Number(row.webhook_failures||0)/routes:null};})});
});
app.get('/api/system/optimization-health', async c => {
  await requireSystemAdmin(c);
  const rows:any[]=(await c.env.smart_menu_db.prepare(`SELECT w.id workspace_id,w.name workspace_name,COALESCE(j.observed_actions,0) observed_actions,COALESCE(t.tracked_uri_clicks,0) tracked_uri_clicks,COALESCE(t.attributed_conversions,0) attributed_conversions,COALESCE(k.active_keys,0) active_keys,COALESCE(s.active_sources,0) active_sources,COALESCE(s.stale_sources,0) stale_sources,MAX(j.metrics_through) last_intelligence_activity FROM workspaces w LEFT JOIN (SELECT workspace_id,SUM(message_actions)+SUM(postback_actions)+SUM(switch_actions) observed_actions,MAX(metric_date) metrics_through FROM line_journey_daily GROUP BY workspace_id) j ON j.workspace_id=w.id LEFT JOIN (SELECT workspace_id,COUNT(*) tracked_uri_clicks,SUM(CASE WHEN conversion_event_id IS NOT NULL THEN 1 ELSE 0 END) attributed_conversions FROM tracked_uri_attributions WHERE status='clicked' GROUP BY workspace_id) t ON t.workspace_id=w.id LEFT JOIN (SELECT workspace_id,COUNT(*) active_keys FROM workspace_conversion_api_keys WHERE status='active' GROUP BY workspace_id) k ON k.workspace_id=w.id LEFT JOIN (SELECT workspace_id,SUM(CASE WHEN occurred_at>=datetime('now','-3 days') THEN 1 ELSE 0 END) active_sources,SUM(CASE WHEN occurred_at<datetime('now','-3 days') THEN 1 ELSE 0 END) stale_sources FROM (SELECT workspace_id,conversion_source,MAX(occurred_at) occurred_at FROM line_conversion_events GROUP BY workspace_id,conversion_source) GROUP BY workspace_id) s ON s.workspace_id=w.id WHERE w.deleted_at IS NULL GROUP BY w.id,w.name ORDER BY w.created_at DESC`).all()).results||[];
  return c.json({success:true,workspaces:rows.map((row:any)=>{const tracked=Number(row.tracked_uri_clicks||0), conversions=Number(row.attributed_conversions||0), coverage=tracked+Number(row.observed_actions||0)>0?tracked/(tracked+Number(row.observed_actions||0)):null, reason=!Number(row.observed_actions||0)?'NO_JOURNEY_DATA':!Number(row.active_keys||0)?'NO_CONVERSION_INTEGRATION':Number(row.stale_sources||0)>0?'CONVERSION_SOURCE_STALE':coverage===null||coverage<.8?'ATTRIBUTION_COVERAGE_LOW':'READY'; return {workspaceId:row.workspace_id,workspaceName:row.workspace_name,optimizationReady:reason==='READY',optimizationReason:reason,attributionCoverage:coverage,uriTrackingReady:tracked>0,conversionSourcesReady:Number(row.active_sources||0)>0,activeConversionSources:Number(row.active_sources||0),staleConversionSources:Number(row.stale_sources||0),lastIntelligenceActivity:row.last_intelligence_activity||null};})});
});app.get('/api/system/conversion-source-health', async c => {
  await requireSystemAdmin(c);
  const rows: any[] = (await c.env.smart_menu_db.prepare("SELECT w.id workspace_id,w.name workspace_name,c.conversion_source,COUNT(c.id) event_count,MAX(c.occurred_at) last_event_at,COUNT(c.id) conversions,COALESCE(SUM(c.value_minor),0) conversion_value_minor FROM workspaces w LEFT JOIN line_conversion_events c ON c.workspace_id=w.id WHERE w.deleted_at IS NULL GROUP BY w.id,w.name,c.conversion_source ORDER BY w.created_at DESC,c.conversion_source").all()).results || [];
  const grouped = new Map<string, any>();
  for (const row of rows) { const key = row.workspace_id; if (!grouped.has(key)) grouped.set(key, { workspaceId: row.workspace_id, workspaceName: row.workspace_name, sources: [] }); grouped.get(key).sources.push(row); }
  return c.json({ success: true, workspaces: [...grouped.values()].map(workspace => ({ ...workspace, sources: conversionSourceHealthRows(workspace.sources) })) });
});
app.get('/api/system/line-intelligence/health', async (c) => {
  await requireSystemAdmin(c);
  const rows: any[] = (await c.env.smart_menu_db.prepare("SELECT b.workspace_id,b.project_id,p.name project_name,b.line_rich_menu_id,b.status,b.last_synced_at,b.last_sync_status,COUNT(i.id) cached_rows,SUM(CASE WHEN i.data_status='privacy_suppressed' THEN 1 ELSE 0 END) privacy_rows,SUM(CASE WHEN i.data_status='mapping_unmatched' THEN 1 ELSE 0 END) unmatched_rows FROM workspace_rich_menu_bindings b LEFT JOIN projects p ON p.id=b.project_id AND p.workspace_id=b.workspace_id LEFT JOIN line_rich_menu_insight_daily i ON i.workspace_id=b.workspace_id AND i.project_id=b.project_id GROUP BY b.id ORDER BY b.updated_at DESC").all()).results || [];
  return c.json({ success: true, bindings: rows.map(row => ({ workspaceId: row.workspace_id, projectId: row.project_id, projectName: row.project_name, lineRichMenuId: row.line_rich_menu_id, status: row.status, lastSyncedAt: row.last_synced_at, lastSyncStatus: row.last_sync_status, cachedRows: Number(row.cached_rows || 0), privacyRows: Number(row.privacy_rows || 0), unmatchedRows: Number(row.unmatched_rows || 0), behaviorReady: Number(row.cached_rows || 0) > 0 && Number(row.privacy_rows || 0) === 0 && Number(row.unmatched_rows || 0) === 0, behaviorReason: Number(row.cached_rows || 0) === 0 ? 'NO_SYNC' : Number(row.privacy_rows || 0) > 0 ? 'PRIVACY_SUPPRESSED' : Number(row.unmatched_rows || 0) > 0 ? 'MAPPING_INCOMPLETE' : 'READY' })) });
});

app.post('/api/projects/:projectId/publish', async (c) => {
  const projectId = c.req.param('projectId');
  let publishProgress = { created: false, imageUploaded: false, aliasAssigned: false, defaultAssigned: false };

  try {
    requireRole(c, 'editor');
    const workspaceId = workspaceIdOf(c);
    const project: any = await getProjectForPublish(c.env, workspaceId, projectId);

    if (!project) return c.json({ success: false, ...publishProgress, errorCode: 'PROJECT_NOT_FOUND', error: '找不到專案。' }, 404);

    const publishCredential = await resolveProjectLinePublishCredential(c.env.smart_menu_db, workspaceId, projectId);
    if (!publishCredential.ok) {
      if (publishCredential.code === 'PROJECT_NOT_FOUND') return c.json({ success: false, ...publishProgress, errorCode: publishCredential.code, error: '找不到專案。' }, 404);
      if (publishCredential.code === 'LINE_ACCOUNT_NOT_CONNECTED') return c.json({ success: false, ...publishProgress, errorCode: publishCredential.code, error: '目前專案所屬 Workspace 尚未連結 LINE 官方帳號。' }, 409);
      return c.json({ success: false, ...publishProgress, errorCode: publishCredential.code, error: '目前連結的 LINE 官方帳號尚未設定 Messaging API Bot Token。' }, 409);
    }
    const channelAccessToken = publishCredential.credential.channelAccessToken;

    if (project.status === 'disabled') return c.json({ success: false, ...publishProgress, errorCode: 'PROJECT_DISABLED', error: '此專案已停用，請先啟用後再發布。' }, 409);
    if (!project.asset_id) return c.json({ success: false, ...publishProgress, errorCode: 'PROJECT_IMAGE_MISSING', error: '專案尚未設定圖片。' }, 400);
    if (!project.areas?.length) return c.json({ success: false, ...publishProgress, errorCode: 'PROJECT_AREAS_MISSING', error: '專案沒有可發布的熱區。' }, 400);

    const switchTargetIds = [...new Set(
      project.areas
        .filter((area: any) => area.action?.type === 'richmenuswitch')
        .map((area: any) => text(area.action?.targetPageId))
        .filter(Boolean)
    )] as string[];
    if (switchTargetIds.includes(projectId)) return c.json({ success: false, ...publishProgress, errorCode: 'PROJECT_SWITCH_SELF_REFERENCE', error: '切換頁 Action 不可指向目前專案。' }, 400);

    if (switchTargetIds.length) {
      const placeholders = switchTargetIds.map(() => '?').join(', ');
      const targetResult = await c.env.smart_menu_db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = ? AND deleted_at IS NULL AND status <> 'disabled' AND id IN (${placeholders})
      `).bind(workspaceId, ...switchTargetIds).all();
      if ((targetResult.results || []).length !== switchTargetIds.length) return c.json({ success: false, ...publishProgress, errorCode: 'PROJECT_SWITCH_TARGET_INVALID', error: '切換目標不存在、已停用或不屬於目前 Workspace。' }, 400);
    }

    const dimensions = resolveRichMenuDimensions(project.image_width, project.image_height);
    let validatedAreas;
    try {
      validateRichMenuImageDimensions(dimensions.width, dimensions.height);
      validatedAreas = validateRichMenuAreas(project.areas, dimensions.width, dimensions.height);
    } catch {
      return c.json({ success: false, ...publishProgress, errorCode: 'PROJECT_LAYOUT_INVALID', error: '專案圖片尺寸或熱區座標不符合 LINE Rich Menu 規格。' }, 400);
    }
    const lineAreas = validatedAreas.map((area: any) => ({
      bounds: {
        x: Math.max(0, Math.round(num(area.x))),
        y: Math.max(0, Math.round(num(area.y))),
        width: Math.max(1, Math.round(num(area.width, 1))),
        height: Math.max(1, Math.round(num(area.height, 1))),
      },
      action: buildLineAction(area.action),
    }));
    const richMenuObject = {
      size: { width: dimensions.width, height: dimensions.height },
      selected: true,
      name: text(project.name).slice(0, 300) || 'Smart Menu',
      chatBarText: '選單',
      areas: lineAreas,
    };

    const { asset, object } = await getProjectImageObject(c.env, workspaceId, project.asset_id);
    const publishResult = await publishRichMenuToLine({
      fetcher: fetch,
      channelAccessToken,
      richMenuObject,
      imageBody: object.body,
      imageContentType: asset.content_type === 'image/png' ? 'image/png' : 'image/jpeg',
      richMenuAliasId: richMenuAliasIdForProject(projectId),
    });
    publishProgress = {
      created: publishResult.created,
      imageUploaded: publishResult.imageUploaded,
      aliasAssigned: publishResult.aliasAssigned,
      defaultAssigned: publishResult.defaultAssigned,
    };

    // LINE is authoritative first; D1 lifecycle state is finalized only after default verification.
    await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        UPDATE projects SET status = 'published', updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND status = 'default' AND id <> ? AND deleted_at IS NULL
      `).bind(workspaceId, projectId),
      c.env.smart_menu_db.prepare(`
        UPDATE projects SET status = 'default', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).bind(projectId, workspaceId),
    ]);

    return c.json({
      success: true,
      ...publishProgress,
      status: 'published',
      project: { id: projectId, name: project.name, status: 'default', isDefault: true },
    });
  } catch (e: any) {
    const errorCode = text(e?.code || e?.message) || 'LINE_PUBLISH_FAILED';
    if (e?.progress) publishProgress = {
      created: Boolean(e.progress.created),
      imageUploaded: Boolean(e.progress.imageUploaded),
      aliasAssigned: Boolean(e.progress.aliasAssigned),
      defaultAssigned: Boolean(e.progress.defaultAssigned),
    };
    console.error(JSON.stringify({
      message: 'publish project failed',
      code: ['FORBIDDEN_ROLE', 'LINE_ACCOUNT_TOKEN_UNUSABLE', 'LINE_RICH_MENU_CREATE_FAILED', 'LINE_RICH_MENU_UPLOAD_FAILED', 'LINE_ALIAS_ASSIGN_FAILED', 'LINE_DEFAULT_ASSIGN_FAILED', 'LINE_DEFAULT_VERIFY_FAILED'].includes(errorCode) ? errorCode : 'LINE_PUBLISH_FAILED',
    }));
    if (errorCode === 'FORBIDDEN_ROLE') return c.json({ success: false, ...publishProgress, errorCode, error: '權限不足，需要 editor、admin 或 owner。' }, 403);
    if (errorCode === 'LINE_ACCOUNT_TOKEN_UNUSABLE') return c.json({ success: false, ...publishProgress, errorCode, error: 'LINE 官方帳號的 Messaging API 設定無法使用，請重新確認帳號設定。' }, 409);
    if (errorCode === 'LINE_DEFAULT_ASSIGN_FAILED' || errorCode === 'LINE_DEFAULT_VERIFY_FAILED') return c.json({ success: false, ...publishProgress, errorCode, error: '圖文選單已建立，但設定為目前使用中的選單失敗，請稍後再試。' }, 502);
    return c.json({ success: false, ...publishProgress, errorCode, error: '發布至 LINE 失敗，請稍後再試。' }, 502);
  }
});

app.post('/api/projects/:projectId/set-default', async (c) => {
  try {
    requireRole(c, 'editor');
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    const project: any = await c.env.smart_menu_db.prepare(`
      SELECT id, name, status FROM projects
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1
    `).bind(projectId, workspaceId).first();

    if (!project) return c.json({ success: false, defaultAssigned: false, errorCode: 'PROJECT_NOT_FOUND', error: '找不到專案。' }, 404);
    if (project.status === 'disabled') return c.json({ success: false, defaultAssigned: false, errorCode: 'PROJECT_DISABLED', error: '停用中的專案不可設為首頁。' }, 409);

    const publishCredential = await resolveProjectLinePublishCredential(c.env.smart_menu_db, workspaceId, projectId);
    if (!publishCredential.ok) {
      if (publishCredential.code === 'LINE_ACCOUNT_NOT_CONNECTED') return c.json({ success: false, defaultAssigned: false, errorCode: publishCredential.code, error: '目前專案所屬 Workspace 尚未連結 LINE 官方帳號。' }, 409);
      if (publishCredential.code === 'LINE_ACCOUNT_TOKEN_MISSING') return c.json({ success: false, defaultAssigned: false, errorCode: publishCredential.code, error: '目前連結的 LINE 官方帳號尚未設定 Messaging API Bot Token。' }, 409);
      return c.json({ success: false, defaultAssigned: false, errorCode: publishCredential.code, error: '找不到專案。' }, 404);
    }
    const channelAccessToken = publishCredential.credential.channelAccessToken;
    const alias: any = await getRichMenuAlias(fetch, channelAccessToken, richMenuAliasIdForProject(projectId));
    const richMenuId = text(alias?.richMenuId);
    if (!richMenuId) return c.json({ success: false, defaultAssigned: false, errorCode: 'LINE_ALIAS_NOT_FOUND', error: '此專案尚未發布或 Alias 不存在，請先發布。' }, 409);

    await setDefaultRichMenu(fetch, channelAccessToken, richMenuId);
    if (!await verifyDefaultRichMenu(fetch, channelAccessToken, richMenuId)) {
      const verifyError: any = new Error('LINE_DEFAULT_VERIFY_FAILED');
      verifyError.code = 'LINE_DEFAULT_VERIFY_FAILED';
      throw verifyError;
    }
    await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        UPDATE projects SET status = 'published', updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND status = 'default' AND id <> ? AND deleted_at IS NULL
      `).bind(workspaceId, projectId),
      c.env.smart_menu_db.prepare(`
        UPDATE projects SET status = 'default', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).bind(projectId, workspaceId),
    ]);

    return c.json({ success: true, defaultAssigned: true, status: 'default', project: { id: projectId, name: project.name, status: 'default', isDefault: true } });
  } catch (e: any) {
    const errorCode = text(e?.code || e?.message) || 'LINE_DEFAULT_ASSIGN_FAILED';
    console.error(JSON.stringify({
      message: 'set default project failed',
      code: ['FORBIDDEN_ROLE', 'LINE_DEFAULT_ASSIGN_FAILED', 'LINE_DEFAULT_VERIFY_FAILED'].includes(errorCode) ? errorCode : 'LINE_DEFAULT_ASSIGN_FAILED',
    }));
    if (errorCode === 'FORBIDDEN_ROLE') return c.json({ success: false, defaultAssigned: false, errorCode, error: '權限不足，需要 editor、admin 或 owner。' }, 403);
    return c.json({ success: false, defaultAssigned: false, errorCode, error: '設定目前使用中的 LINE 選單失敗，請稍後再試。' }, 502);
  }
});
app.post('/api/projects/:projectId/disable', async (c) => {
  try {
    requireRole(c, 'editor');
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);

    if (!c.env.LINE_CHANNEL_ACCESS_TOKEN) {
      return c.json({ success: false, error: 'LINE_CHANNEL_ACCESS_TOKEN 尚未設定。' }, 500);
    }

    const project: any = await c.env.smart_menu_db.prepare(`
      SELECT id, name, status
      FROM projects
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(projectId, workspaceId).first();

    if (!project) return c.json({ success: false, error: '找不到專案。' }, 404);
    if (project.status === 'disabled') return c.json({ success: true, alreadyDisabled: true });
    if (project.status === 'default') {
      return c.json({ success: false, error: '此專案是目前首頁，請先將其他已發布專案設為首頁。' }, 409);
    }

    const reference: any = await c.env.smart_menu_db.prepare(`
      SELECT COUNT(*) AS count
      FROM project_areas pa
      INNER JOIN projects p
        ON p.id = pa.project_id AND p.workspace_id = pa.workspace_id
      WHERE pa.workspace_id = ?
        AND pa.target_page_id = ?
        AND pa.action_type = 'richmenuswitch'
        AND p.id <> ?
        AND p.deleted_at IS NULL
        AND p.status <> 'disabled'
    `).bind(workspaceId, projectId, projectId).first();

    if (num(reference?.count) > 0) {
      return c.json({
        success: false,
        error: `仍有 ${num(reference.count)} 個啟用中熱區切換到此頁，請先修改這些 Action。`,
      }, 409);
    }

    const richMenuAliasId = richMenuAliasIdForProject(projectId);
    const alias = await deleteRichMenuAlias(fetch, c.env.LINE_CHANNEL_ACCESS_TOKEN, richMenuAliasId);
    await c.env.smart_menu_db.prepare(`
      UPDATE projects
      SET status = 'disabled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
    `).bind(projectId, workspaceId).run();

    return c.json({ success: true, project: { id: projectId, status: 'disabled' }, alias });
  } catch (e: any) {
    console.error('disable-project:', e);
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 editor、admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '停用專案失敗' }, 500);
  }
});

app.post('/api/projects/:projectId/enable', async (c) => {
  try {
    requireRole(c, 'editor');
    const projectId = c.req.param('projectId');
    const workspaceId = workspaceIdOf(c);
    const project: any = await c.env.smart_menu_db.prepare(`
      SELECT id, status
      FROM projects
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(projectId, workspaceId).first();

    if (!project) return c.json({ success: false, error: '找不到專案。' }, 404);
    if (project.status !== 'disabled') return c.json({ success: true, alreadyEnabled: true });

    await c.env.smart_menu_db.prepare(`
      UPDATE projects
      SET status = 'draft', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
    `).bind(projectId, workspaceId).run();

    return c.json({ success: true, project: { id: projectId, status: 'draft' } });
  } catch (e: any) {
    console.error('enable-project:', e);
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 editor、admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '啟用專案失敗' }, 500);
  }
});

async function runLineSimulation(env: Bindings, workspaceId: string, messageText: string) {
  const targetsResult = await env.smart_menu_db.prepare(`
    SELECT * FROM workspace_webhook_targets
    WHERE workspace_id = ? ORDER BY position ASC
  `).bind(workspaceId).all();
  const targets = (targetsResult.results || []) as any[];

  const routesResult = await env.smart_menu_db.prepare(`
    SELECT r.*, t.name AS target_name, t.position AS target_position
    FROM workspace_keyword_routes r
    JOIN workspace_webhook_targets t ON t.id = r.target_id
    WHERE r.workspace_id = ? AND r.enabled = 1
    ORDER BY r.priority ASC, r.created_at ASC
  `).bind(workspaceId).all();
  const routes = (routesResult.results || []) as any[];
  const matches = routes.filter(r => keywordMatches(messageText, r.keyword, r.match_type));
  const route = matches[0] || null;

  const account: any = await env.smart_menu_db.prepare(`
    SELECT default_target_id FROM workspace_line_accounts
    WHERE workspace_id = ? LIMIT 1
  `).bind(workspaceId).first();

  let target = route ? targets.find(t => t.id === route.target_id) : null;
  if (!target && account?.default_target_id) target = targets.find(t => t.id === account.default_target_id);
  if (!target) target = targets.find(t => Number(t.position) === 1) || targets[0] || null;

  return { targets, routes, matches, route, target };
}

// =====================================================
// LINE Gateway Webhook V1
// LINE Developers 的 Webhook URL 指向這裡。
// =====================================================

app.post('/line/webhook/:workspaceId/:webhookToken', async (c) => {
  const workspaceId = text(c.req.param('workspaceId'));
  const webhookToken = text(c.req.param('webhookToken'));

  try {
    const account: any = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM workspace_line_accounts
      WHERE workspace_id = ?
        AND webhook_token = ?
        AND webhook_enabled = 1
      LIMIT 1
    `).bind(workspaceId, webhookToken).first();

    if (!account) {
      return c.json({
        success: false,
        error: 'LINE Webhook 不存在或已停用。',
      }, 404);
    }

    const rawBody = await c.req.text();
    const signature = text(c.req.header('x-line-signature'));

    if (!account.line_bot_channel_secret) {
      return c.json({
        success: false,
        error: '此 Workspace 尚未設定 LINE Bot Channel Secret。',
      }, 503);
    }

    const signatureOk = await verifyLineSignature(
      rawBody,
      signature,
      account.line_bot_channel_secret
    );

    if (!signatureOk) {
      return c.json({
        success: false,
        error: 'Invalid LINE Signature',
      }, 403);
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch {
      return c.json({
        success: false,
        error: 'Webhook body 不是有效 JSON。',
      }, 400);
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];

    // LINE Developers 的 Verify 會送 events: []。
    // 只要 URL、token、Channel Secret、Signature 都正確，就回 200。
    if (events.length === 0) {
      return c.json({
        success: true,
        verified: true,
        workspaceId,
      }, 200);
    }

    const targetResult = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM workspace_webhook_targets
      WHERE workspace_id = ?
        AND enabled = 1
        AND endpoint_url IS NOT NULL
        AND trim(endpoint_url) <> ''
      ORDER BY position ASC
    `).bind(workspaceId).all();

    const targets = (targetResult.results || []) as any[];

    const routeResult = await c.env.smart_menu_db.prepare(`
      SELECT
        r.*,
        t.name AS target_name,
        t.endpoint_url,
        t.can_reply,
        t.forward_signature,
        t.timeout_ms
      FROM workspace_keyword_routes r
      JOIN workspace_webhook_targets t
        ON t.id = r.target_id
       AND t.workspace_id = r.workspace_id
      WHERE r.workspace_id = ?
        AND r.enabled = 1
        AND t.enabled = 1
        AND t.endpoint_url IS NOT NULL
        AND trim(t.endpoint_url) <> ''
      ORDER BY r.priority ASC, r.created_at ASC
    `).bind(workspaceId).all();

    const keywordRoutes = (routeResult.results || []) as any[];

    let defaultTarget: any = null;

    if (account.default_target_id) {
      defaultTarget = targets.find(t => t.id === account.default_target_id) || null;
    }

    if (!defaultTarget) {
      defaultTarget = targets.find(t => Number(t.position) === 1) || targets[0] || null;
    }

    const dispatches: any[] = [];

    for (const event of events) {
      await recordLineActionEvent(c.env.smart_menu_db, { workspaceId, account, event }).catch(() => {});
      let selectedTarget: any = null;
      let matchedRoute: any = null;

      if (event?.type === 'message' && event?.message?.type === 'text') {
        const messageText = text(event.message.text);

        matchedRoute = keywordRoutes.find(route =>
          keywordMatches(messageText, route.keyword, route.match_type)
        ) || null;

        if (matchedRoute) {
          await writeGatewayJourneyEvent(c.env.smart_menu_db,{workspaceId,account,event,eventType:'keyword_match',routeId:matchedRoute.id,targetId:matchedRoute.target_id,status:matchedRoute.match_type}).catch(()=>{});
          selectedTarget = targets.find(t => t.id === matchedRoute.target_id) || {
            id: matchedRoute.target_id,
            name: matchedRoute.target_name,
            endpoint_url: matchedRoute.endpoint_url,
            can_reply: matchedRoute.can_reply,
            forward_signature: matchedRoute.forward_signature,
            timeout_ms: matchedRoute.timeout_ms,
          };
        }
      }

      if (!selectedTarget) {
        selectedTarget = defaultTarget;
      }

      if (!selectedTarget?.endpoint_url) {
        dispatches.push({
          eventType: event?.type || 'unknown',
          skipped: true,
          reason: 'NO_TARGET',
        });
        continue;
      }

      const forwardPayload = {
        action: 'LINE_WEBHOOK',
        workspaceId,
        targetId: selectedTarget.id,
        targetName: selectedTarget.name,
        matchedKeyword: matchedRoute?.keyword || null,
        matchedType: matchedRoute?.match_type || null,
        payload: {
          destination: payload?.destination || null,
          events: [event],
        },
      };

      const controller = new AbortController();
      const timeoutMs = Math.max(
        1000,
        Math.min(30000, Number(selectedTarget.timeout_ms || 8000))
      );
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const journeyStarted=Date.now();
        await writeGatewayJourneyEvent(c.env.smart_menu_db,{workspaceId,account,event,eventType:'webhook_route',targetId:selectedTarget.id}).catch(()=>{});
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Smart-Menu-Workspace': workspaceId,
          'X-Smart-Menu-Target': String(selectedTarget.id),
        };

        if (Number(selectedTarget.forward_signature) === 1 && signature) {
          headers['x-line-signature'] = signature;
        }

        const forwardRes = await fetch(selectedTarget.endpoint_url, {
          method: 'POST',
          headers,
          body: JSON.stringify(forwardPayload),
          signal: controller.signal,
        });

        await writeGatewayJourneyEvent(c.env.smart_menu_db,{workspaceId,account,event,eventType:forwardRes.ok?'webhook_success':'webhook_failure',targetId:selectedTarget.id,status:String(Math.floor(forwardRes.status/100)+'xx'),latencyMs:Date.now()-journeyStarted,errorCode:forwardRes.ok?null:'DOWNSTREAM_HTTP'}).catch(()=>{});
        const responseText = await forwardRes.text();
        let downstream: any = null;

        try {
          downstream = responseText ? JSON.parse(responseText) : null;
        } catch {
          downstream = responseText || null;
        }

        if (
          Number(selectedTarget.can_reply) === 1 &&
          downstream &&
          account.line_bot_channel_access_token
        ) {
          const replyPayload =
            downstream?.replyPayload ||
            downstream?.data?.replyPayload ||
            null;

          if (replyPayload) {
            await replyToLine(
              account.line_bot_channel_access_token,
              replyPayload
            );
          }
        }

        dispatches.push({
          eventType: event?.type || 'unknown',
          targetId: selectedTarget.id,
          targetName: selectedTarget.name,
          keyword: matchedRoute?.keyword || null,
          status: forwardRes.status,
          ok: forwardRes.ok,
        });
      } catch (error: any) {
        await writeGatewayJourneyEvent(c.env.smart_menu_db,{workspaceId,account,event,eventType:'webhook_failure',targetId:selectedTarget?.id||null,errorCode:error?.name==='AbortError'?'DOWNSTREAM_TIMEOUT':'FORWARD_FAILED'}).catch(()=>{});
        console.error('LINE webhook forward failed:', {
          workspaceId,
          targetId: selectedTarget?.id,
          error: error?.message || error,
        });

        dispatches.push({
          eventType: event?.type || 'unknown',
          targetId: selectedTarget?.id || null,
          targetName: selectedTarget?.name || null,
          keyword: matchedRoute?.keyword || null,
          ok: false,
          error: error?.name === 'AbortError'
            ? 'DOWNSTREAM_TIMEOUT'
            : (error?.message || 'FORWARD_FAILED'),
        });
      } finally {
        clearTimeout(timer);
      }
    }

    // 對 LINE 一律回 200，避免下游系統短暫失敗造成 LINE 重送風暴。
    return c.json({
      success: true,
      workspaceId,
      receivedEvents: events.length,
      dispatches,
    }, 200);

  } catch (error: any) {
    console.error('LINE Gateway webhook error:', error);

    return c.json({
      success: false,
      error: error?.message || 'LINE Gateway webhook error',
    }, 500);
  }
});



async function requireSystemAdmin(c: any) {
  const userId = text(c.get('userId'));
  const row: any = await c.env.smart_menu_db.prepare(`
    SELECT id, is_system_admin FROM users
    WHERE id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1
  `).bind(userId).first();
  if (!row || Number(row.is_system_admin) !== 1) throw new Error('SYSTEM_ADMIN_REQUIRED');
  return row;
}

async function ensureWorkspaceLineHub(env: Bindings, workspaceId: string) {
  const account: any = await env.smart_menu_db.prepare(
    `SELECT id FROM workspace_line_accounts WHERE workspace_id = ? LIMIT 1`
  ).bind(workspaceId).first();
  if (!account) {
    await env.smart_menu_db.prepare(`
      INSERT INTO workspace_line_accounts
      (id, workspace_id, status, webhook_token, webhook_enabled, created_at, updated_at)
      VALUES (?, ?, 'disconnected', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(id('lineacct'), workspaceId, generateWebhookToken()).run();
  }
  for (const s of [
    {p:1,n:'System A',t:'primary',r:1},
    {p:2,n:'System B',t:'secondary',r:0}
  ]) {
    const exists = await env.smart_menu_db.prepare(
      `SELECT id FROM workspace_webhook_targets WHERE workspace_id = ? AND position = ? LIMIT 1`
    ).bind(workspaceId, s.p).first();
    if (!exists) {
      await env.smart_menu_db.prepare(`
        INSERT INTO workspace_webhook_targets
        (id, workspace_id, name, target_type, endpoint_url, position, enabled,
         can_reply, forward_signature, timeout_ms, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, 0, ?, 1, 8000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(id('wht'), workspaceId, s.n, s.t, s.p, s.r).run();
    }
  }
}

// =====================================================
// LINE Hub V1
// =====================================================

app.get('/api/line-hub', async (c) => {
  try {
    const workspaceId = workspaceIdOf(c);

    const account: any = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM workspace_line_accounts
      WHERE workspace_id = ?
      LIMIT 1
    `).bind(workspaceId).first();

    const targetResult = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM workspace_webhook_targets
      WHERE workspace_id = ?
      ORDER BY position ASC
    `).bind(workspaceId).all();

    const keywordResult = await c.env.smart_menu_db.prepare(`
      SELECT
        r.*,
        t.name AS target_name
      FROM workspace_keyword_routes r
      JOIN workspace_webhook_targets t ON t.id = r.target_id
      WHERE r.workspace_id = ?
      ORDER BY r.priority ASC, r.created_at ASC
    `).bind(workspaceId).all();

    return c.json({
      success: true,
      lineAccount: account ? {
        id: account.id,
        workspaceId: account.workspace_id,
        oaName: account.oa_name,
        lineLoginChannelId: account.line_login_channel_id,
        lineBotChannelId: account.line_channel_id,
        lineBotBasicId: account.line_bot_basic_id,
        status: account.status,
        webhookEnabled: Boolean(account.webhook_enabled),
        webhookPath: account.webhook_token
          ? `/line/webhook/${workspaceId}/${account.webhook_token}`
          : null,
        hasLoginSecret: Boolean(account.line_login_channel_secret),
        hasBotToken: Boolean(account.line_bot_channel_access_token),
        hasBotSecret: Boolean(account.line_bot_channel_secret),
      } : null,
      targets: targetResult.results || [],
      keywordRoutes: keywordResult.results || [],
    });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'LINE Hub 讀取失敗' }, 500);
  }
});

app.patch('/api/line-hub/account', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const body: any = await c.req.json();

    const existing: any = await c.env.smart_menu_db.prepare(`
      SELECT id, webhook_token
      FROM workspace_line_accounts
      WHERE workspace_id = ?
      LIMIT 1
    `).bind(workspaceId).first();

    const accountId = existing?.id || id('lineacct');
    const webhookToken = existing?.webhook_token || generateWebhookToken();

    if (existing) {
      await c.env.smart_menu_db.prepare(`
        UPDATE workspace_line_accounts
        SET
          oa_name = ?,
          line_login_channel_id = ?,
          line_login_channel_secret = COALESCE(NULLIF(?, ''), line_login_channel_secret),
          line_channel_id = ?,
          line_bot_channel_access_token = COALESCE(NULLIF(?, ''), line_bot_channel_access_token),
          line_bot_channel_secret = COALESCE(NULLIF(?, ''), line_bot_channel_secret),
          line_bot_basic_id = ?,
          status = ?,
          webhook_enabled = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ?
      `).bind(
        text(body.oaName) || null,
        text(body.lineLoginChannelId) || null,
        text(body.lineLoginChannelSecret),
        text(body.lineBotChannelId) || null,
        text(body.lineBotChannelAccessToken),
        text(body.lineBotChannelSecret),
        text(body.lineBotBasicId) || null,
        text(body.status || 'disconnected'),
        body.webhookEnabled === false ? 0 : 1,
        accountId,
        workspaceId
      ).run();
    } else {
      await c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_line_accounts (
          id, workspace_id,
          oa_name,
          line_login_channel_id,
          line_login_channel_secret,
          line_channel_id,
          line_bot_channel_access_token,
          line_bot_channel_secret,
          line_bot_basic_id,
          status,
          webhook_token,
          webhook_enabled
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        accountId,
        workspaceId,
        text(body.oaName) || null,
        text(body.lineLoginChannelId) || null,
        text(body.lineLoginChannelSecret) || null,
        text(body.lineBotChannelId) || null,
        text(body.lineBotChannelAccessToken) || null,
        text(body.lineBotChannelSecret) || null,
        text(body.lineBotBasicId) || null,
        text(body.status || 'disconnected'),
        webhookToken,
        body.webhookEnabled === false ? 0 : 1
      ).run();
    }

    return c.json({
      success: true,
      webhookPath: `/line/webhook/${workspaceId}/${webhookToken}`,
    });
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || 'LINE OA 設定失敗' }, 500);
  }
});

app.post('/api/line-hub/targets', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const body: any = await c.req.json();

    const position = Math.max(1, Math.round(num(body.position, 1)));

    const existingPosition = await c.env.smart_menu_db.prepare(`
      SELECT id
      FROM workspace_webhook_targets
      WHERE workspace_id = ? AND position = ?
      LIMIT 1
    `).bind(workspaceId, position).first();

    if (existingPosition) {
      return c.json({
        success: false,
        error: `System ${position} 插槽已存在，請修改既有 target。`,
      }, 409);
    }

    const targetId = id('wht');

    await c.env.smart_menu_db.prepare(`
      INSERT INTO workspace_webhook_targets (
        id, workspace_id, name, target_type, endpoint_url,
        position, enabled, can_reply, forward_signature, timeout_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      targetId,
      workspaceId,
      text(body.name || `System ${position}`),
      text(body.targetType || 'secondary'),
      text(body.endpointUrl) || null,
      position,
      body.enabled ? 1 : 0,
      body.canReply ? 1 : 0,
      body.forwardSignature === false ? 0 : 1,
      Math.max(1000, Math.min(30000, Math.round(num(body.timeoutMs, 8000))))
    ).run();

    return c.json({ success: true, targetId }, 201);
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || 'Target 建立失敗' }, 500);
  }
});

app.patch('/api/line-hub/targets/:targetId', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const targetId = c.req.param('targetId');
    const body: any = await c.req.json();

    const existing: any = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM workspace_webhook_targets
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).bind(targetId, workspaceId).first();

    if (!existing) return c.json({ success: false, error: '找不到 Target。' }, 404);

    await c.env.smart_menu_db.prepare(`
      UPDATE workspace_webhook_targets
      SET
        name = ?,
        target_type = ?,
        endpoint_url = ?,
        enabled = ?,
        can_reply = ?,
        forward_signature = ?,
        timeout_ms = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).bind(
      text(body.name || existing.name),
      text(body.targetType || existing.target_type),
      text(body.endpointUrl ?? existing.endpoint_url) || null,
      body.enabled === undefined ? existing.enabled : (body.enabled ? 1 : 0),
      body.canReply === undefined ? existing.can_reply : (body.canReply ? 1 : 0),
      body.forwardSignature === undefined ? existing.forward_signature : (body.forwardSignature ? 1 : 0),
      Math.max(1000, Math.min(30000, Math.round(num(body.timeoutMs, existing.timeout_ms || 8000)))),
      targetId,
      workspaceId
    ).run();

    return c.json({ success: true });
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || 'Target 更新失敗' }, 500);
  }
});

app.get('/api/line-hub/keywords', async (c) => {
  try {
    const workspaceId = workspaceIdOf(c);

    const result = await c.env.smart_menu_db.prepare(`
      SELECT
        r.*,
        t.name AS target_name
      FROM workspace_keyword_routes r
      JOIN workspace_webhook_targets t ON t.id = r.target_id
      WHERE r.workspace_id = ?
      ORDER BY r.priority ASC, r.created_at ASC
    `).bind(workspaceId).all();

    return c.json({ success: true, routes: result.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || '關鍵字查詢失敗' }, 500);
  }
});

app.post('/api/line-hub/keywords/check-conflict', async (c) => {
  try {
    const workspaceId = workspaceIdOf(c);
    const body: any = await c.req.json();

    const keyword = text(body.keyword);
    const matchType = text(body.matchType || 'exact').toLowerCase();

    if (!keyword) return c.json({ success: false, error: '關鍵字不可空白。' }, 400);
    if (!['exact', 'prefix', 'contains'].includes(matchType)) {
      return c.json({ success: false, error: 'matchType 僅支援 exact / prefix / contains。' }, 400);
    }

    const conflict: any = await findKeywordConflict(
      c.env,
      workspaceId,
      keyword,
      matchType,
      text(body.excludeRouteId)
    );

    return c.json({
      success: true,
      conflict: conflict ? {
        routeId: conflict.id,
        keyword: conflict.keyword,
        matchType: conflict.match_type,
        targetId: conflict.target_id,
        targetName: conflict.target_name,
      } : null,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || '衝突檢查失敗' }, 500);
  }
});

app.post('/api/line-hub/keywords', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const body: any = await c.req.json();

    const keyword = text(body.keyword);
    const matchType = text(body.matchType || 'exact').toLowerCase();
    const targetId = text(body.targetId);

    if (!keyword) return c.json({ success: false, error: '關鍵字不可空白。' }, 400);
    if (!['exact', 'prefix', 'contains'].includes(matchType)) {
      return c.json({ success: false, error: 'matchType 僅支援 exact / prefix / contains。' }, 400);
    }

    const target = await c.env.smart_menu_db.prepare(`
      SELECT id
      FROM workspace_webhook_targets
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).bind(targetId, workspaceId).first();

    if (!target) return c.json({ success: false, error: '指定 Target 不存在。' }, 400);

    const conflict: any = await findKeywordConflict(
      c.env,
      workspaceId,
      keyword,
      matchType
    );

    if (conflict) {
      return c.json({
        success: false,
        error: `關鍵字規則衝突：「${keyword}」會與 ${conflict.target_name} 的「${conflict.keyword}」(${conflict.match_type}) 競爭。`,
        conflict: {
          routeId: conflict.id,
          keyword: conflict.keyword,
          matchType: conflict.match_type,
          targetId: conflict.target_id,
          targetName: conflict.target_name,
        },
      }, 409);
    }

    const routeId = id('kwr');

    await c.env.smart_menu_db.prepare(`
      INSERT INTO workspace_keyword_routes (
        id, workspace_id,
        keyword, keyword_normalized,
        match_type, target_id,
        priority, enabled
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      routeId,
      workspaceId,
      keyword,
      normalizeKeyword(keyword),
      matchType,
      targetId,
      Math.round(num(body.priority, 100)),
      body.enabled === false ? 0 : 1
    ).run();

    return c.json({ success: true, routeId }, 201);
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '關鍵字建立失敗' }, 500);
  }
});

app.patch('/api/line-hub/keywords/:routeId', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const routeId = c.req.param('routeId');
    const body: any = await c.req.json();

    const existing: any = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM workspace_keyword_routes
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).bind(routeId, workspaceId).first();

    if (!existing) return c.json({ success: false, error: '找不到關鍵字規則。' }, 404);

    const keyword = text(body.keyword ?? existing.keyword);
    const matchType = text(body.matchType ?? existing.match_type).toLowerCase();
    const targetId = text(body.targetId ?? existing.target_id);
    const enabled = body.enabled === undefined ? Boolean(existing.enabled) : Boolean(body.enabled);

    if (enabled) {
      const conflict: any = await findKeywordConflict(
        c.env,
        workspaceId,
        keyword,
        matchType,
        routeId
      );

      if (conflict) {
        return c.json({
          success: false,
          error: `關鍵字規則衝突：「${keyword}」會與 ${conflict.target_name} 的「${conflict.keyword}」(${conflict.match_type}) 競爭。`,
          conflict,
        }, 409);
      }
    }

    await c.env.smart_menu_db.prepare(`
      UPDATE workspace_keyword_routes
      SET
        keyword = ?,
        keyword_normalized = ?,
        match_type = ?,
        target_id = ?,
        priority = ?,
        enabled = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).bind(
      keyword,
      normalizeKeyword(keyword),
      matchType,
      targetId,
      Math.round(num(body.priority, existing.priority || 100)),
      enabled ? 1 : 0,
      routeId,
      workspaceId
    ).run();

    return c.json({ success: true });
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '關鍵字更新失敗' }, 500);
  }
});

app.delete('/api/line-hub/keywords/:routeId', async (c) => {
  try {
    requireRole(c, 'admin');
    const workspaceId = workspaceIdOf(c);
    const routeId = c.req.param('routeId');

    await c.env.smart_menu_db.prepare(`
      DELETE FROM workspace_keyword_routes
      WHERE id = ? AND workspace_id = ?
    `).bind(routeId, workspaceId).run();

    return c.json({ success: true, deleted: routeId });
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '關鍵字刪除失敗' }, 500);
  }
});



app.post('/api/system/workspaces', async (c) => {
  try {
    await requireSystemAdmin(c);
    const body: any = await c.req.json();

    const workspaceName = text(body.workspaceName);
    const companyName = text(body.companyName || workspaceName);
    const contactName = text(body.contactName);
    const phone = text(body.phone);
    const industry = text(body.industry);
    const taxId = text(body.taxId);

    const existingUserId = text(body.existingUserId);
    const ownerDisplayName = text(body.ownerDisplayName || contactName || companyName);
    const ownerUsername = text(body.ownerUsername).toLowerCase();
    const ownerEmail = text(body.ownerEmail).toLowerCase();
    const ownerPassword = String(body.ownerPassword || '');

    if (!workspaceName) {
      return c.json({ success: false, error: '請輸入客戶 / Workspace 名稱。' }, 400);
    }

    const workspaceId = id('ws');
    const workspaceSlug = await uniqueWorkspaceSlug(c.env, workspaceName);
    let ownerUserId = existingUserId;

    const statements: D1PreparedStatement[] = [];

    if (existingUserId) {
      const existing: any = await c.env.smart_menu_db.prepare(`
        SELECT id
        FROM users
        WHERE id = ?
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `).bind(existingUserId).first();

      if (!existing) {
        return c.json({ success: false, error: '指定的既有使用者不存在。' }, 400);
      }
    } else {
      if (!ownerUsername || ownerUsername.length < 3) {
        return c.json({ success: false, error: 'Owner 帳號至少需要 3 個字元。' }, 400);
      }
      if (!ownerEmail || !ownerEmail.includes('@')) {
        return c.json({ success: false, error: '請輸入 Owner Email。' }, 400);
      }
      if (ownerPassword.length < 8) {
        return c.json({ success: false, error: 'Owner 初始密碼至少需要 8 個字元。' }, 400);
      }

      const duplicate = await c.env.smart_menu_db.prepare(`
        SELECT id
        FROM users
        WHERE (lower(username) = ? OR lower(email) = ?)
          AND deleted_at IS NULL
        LIMIT 1
      `).bind(ownerUsername, ownerEmail).first();

      if (duplicate) {
        return c.json({
          success: false,
          error: 'Owner 帳號或 Email 已存在；請改用「既有使用者作為 Owner」。',
        }, 409);
      }

      ownerUserId = id('usr');
      const pw = await createPasswordRecord(ownerPassword);

      statements.push(
        c.env.smart_menu_db.prepare(`
          INSERT INTO users (
            id, username, email, display_name,
            password_hash, password_salt, password_iterations,
            password_updated_at, status, is_system_admin,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(
          ownerUserId,
          ownerUsername,
          ownerEmail,
          ownerDisplayName || companyName,
          pw.hash,
          pw.salt,
          pw.iterations
        )
      );
    }

    statements.push(
      c.env.smart_menu_db.prepare(`
        INSERT INTO workspaces (
          id, name, slug, status, plan, created_at, updated_at
        )
        VALUES (?, ?, ?, 'active', 'starter', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(workspaceId, workspaceName, workspaceSlug),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_members (
          id, workspace_id, user_id, role, status, created_at, updated_at
        )
        VALUES (?, ?, ?, 'owner', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(id('wsm'), workspaceId, ownerUserId),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_profiles (
          workspace_id, contact_name, phone, company_name,
          tax_id, industry, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        workspaceId,
        contactName || null,
        phone || null,
        companyName || workspaceName,
        taxId || null,
        industry || null
      )
    );

    await c.env.smart_menu_db.batch(statements);
    await ensureWorkspaceLineHub(c.env, workspaceId);

    return c.json({
      success: true,
      workspace: {
        id: workspaceId,
        name: workspaceName,
        slug: workspaceSlug,
      },
      ownerUserId,
    }, 201);
  } catch (e: any) {
    if (e?.message === 'SYSTEM_ADMIN_REQUIRED') {
      return c.json({ success: false, error: '需要系統管理員權限。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '建立客戶 Workspace 失敗' }, 500);
  }
});



app.post('/api/system/users/:userId/promote-to-workspace', async (c) => {
  try {
    await requireSystemAdmin(c);
    const userId = text(c.req.param('userId'));
    const body: any = await c.req.json().catch(() => ({}));

    const user: any = await c.env.smart_menu_db.prepare(`
      SELECT id, username, display_name, email
      FROM users
      WHERE id = ? AND status = 'active' AND deleted_at IS NULL
      LIMIT 1
    `).bind(userId).first();

    if (!user) return c.json({ success: false, error: '找不到可用的使用者。' }, 404);

    const existingOwner: any = await c.env.smart_menu_db.prepare(`
      SELECT wm.workspace_id, w.name AS workspace_name
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
        AND wm.status = 'active'
        AND wm.role = 'owner'
        AND w.deleted_at IS NULL
      LIMIT 1
    `).bind(userId).first();

    if (existingOwner) {
      return c.json({
        success: false,
        error: `此使用者已是「${existingOwner.workspace_name || existingOwner.workspace_id}」的 Owner。`,
        existingWorkspaceId: existingOwner.workspace_id,
      }, 409);
    }

    const workspaceName = text(body.workspaceName || body.companyName || user.display_name || user.username);
    if (!workspaceName) return c.json({ success: false, error: '請提供 Workspace 名稱。' }, 400);

    const baseSlug = text(body.slug || workspaceName)
      .toLowerCase().normalize('NFKC')
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 48) || `workspace-${Date.now()}`;

    let slug = baseSlug;
    for (let i = 0; i < 20; i++) {
      const exists = await c.env.smart_menu_db.prepare(`
        SELECT id FROM workspaces WHERE slug = ? AND deleted_at IS NULL LIMIT 1
      `).bind(slug).first();
      if (!exists) break;
      slug = `${baseSlug}-${i + 2}`;
    }

    const workspaceId = id('ws');
    const membershipId = id('wm');

    const oldMemberships = await c.env.smart_menu_db.prepare(`
      SELECT wm.id, wm.workspace_id, wm.role, w.name AS workspace_name
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
        AND wm.status = 'active'
        AND w.deleted_at IS NULL
      ORDER BY wm.created_at ASC
    `).bind(userId).all();

    await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        INSERT INTO workspaces (
          id, name, slug, status, plan, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(workspaceId, workspaceName, slug, text(body.plan || 'standard')),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_members (
          id, workspace_id, user_id, role, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'owner', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(membershipId, workspaceId, userId),

      c.env.smart_menu_db.prepare(`
        INSERT INTO workspace_profiles (
          workspace_id, contact_name, phone, company_name, tax_id,
          industry, address, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        workspaceId,
        text(body.contactName || user.display_name),
        text(body.phone),
        text(body.companyName || workspaceName),
        text(body.taxId),
        text(body.industry),
        text(body.address),
        text(body.notes)
      ),
    ]);

    await ensureWorkspaceLineHub(c.env, workspaceId);

    const removedOldMemberships: any[] = [];
    if (body.removeOldMembership !== false) {
      for (const row of (oldMemberships.results || []) as any[]) {
        if (row.role === 'owner') continue;
        await c.env.smart_menu_db.prepare(`
          UPDATE workspace_members
          SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(row.id).run();

        removedOldMemberships.push({
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name,
          role: row.role,
        });
      }
    }

    return c.json({
      success: true,
      workspace: { id: workspaceId, name: workspaceName, slug },
      ownerUser: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
      },
      removedOldMemberships,
    });
  } catch (e: any) {
    return c.json({
      success: false,
      error: e?.message === 'SYSTEM_ADMIN_REQUIRED'
        ? '需要系統管理員權限。'
        : (e?.message || '轉換 Workspace 失敗'),
    }, e?.message === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500);
  }
});



// =====================================================
// Workspace Data Migration V2.3
// Safe copy: source rows remain untouched.
// Destination keeps its own Gateway webhook token.
// R2 objects are reused through new destination Asset rows.
// =====================================================


// =====================================================
// Tenant Transfer Engine V2.6
// Complete SaaS copy engine:
// Template + Areas + Project + Areas + Asset + R2 +
// LINE + Webhook + Keyword.
// Source rows stay untouched. Destination receives new IDs.
// =====================================================

async function copyAssetBundleToWorkspace(
  env: Bindings,
  sourceWorkspaceId: string,
  destinationWorkspaceId: string,
  sourceAssetId: string,
  assetMap: Map<string, string>
) {
  if (!sourceAssetId) return null;
  if (assetMap.has(sourceAssetId)) return assetMap.get(sourceAssetId)!;

  const asset: any = await env.smart_menu_db.prepare(`
    SELECT *
    FROM assets
    WHERE id = ?
      AND workspace_id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `).bind(sourceAssetId, sourceWorkspaceId).first();

  if (!asset) {
    throw new Error(`來源 Asset 不存在或 ownership 不符：${sourceAssetId}`);
  }

  const object = await env.smart_menu_assets.get(asset.storage_key);
  if (!object) {
    throw new Error(`R2 找不到來源檔案：${asset.storage_key}`);
  }

  const newAssetId = id('asset');
  const sourceKey = text(asset.storage_key);
  const filename = sourceKey.split('/').pop() || 'image.bin';
  const category = sourceKey.startsWith('projects/') ? 'projects' : 'templates';
  const destinationKey =
    `${category}/${destinationWorkspaceId}/${newAssetId}/${filename}`;

  await env.smart_menu_assets.put(destinationKey, object.body, {
    httpMetadata: object.httpMetadata,
    customMetadata: {
      ...(object.customMetadata || {}),
      assetId: newAssetId,
      workspaceId: destinationWorkspaceId,
      transferredFromAssetId: sourceAssetId,
      transferredFromWorkspaceId: sourceWorkspaceId,
    },
  });

  await env.smart_menu_db.prepare(`
    INSERT INTO assets (
      id, workspace_id, storage_key, original_filename,
      content_type, size_bytes, width, height, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newAssetId,
    destinationWorkspaceId,
    destinationKey,
    asset.original_filename || filename,
    asset.content_type || object.httpMetadata?.contentType || 'application/octet-stream',
    Number(asset.size_bytes || object.size || 0),
    asset.width || null,
    asset.height || null,
    asset.status || 'ready'
  ).run();

  assetMap.set(sourceAssetId, newAssetId);
  return newAssetId;
}

function transferAreaShape(row: any) {
  return {
    label: row.label,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    action: normalizeAction({
      type: row.action_type || 'none',
      uri: row.action_uri || '',
      text: row.action_text || '',
      data: row.action_data || '',
      displayText: row.action_display_text || '',
      targetPageId: row.target_page_id || '',
    }),
  };
}

app.get('/api/system/workspaces/:workspaceId/data-migration-preview', async (c) => {
  try {
    await requireSystemAdmin(c);

    const destinationWorkspaceId = text(c.req.param('workspaceId'));
    const requestedSource = text(c.req.query('source'));

    const workspaceRows = await c.env.smart_menu_db.prepare(`
      SELECT id, name, slug
      FROM workspaces
      WHERE deleted_at IS NULL
        AND id <> ?
      ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, created_at ASC
    `).bind(destinationWorkspaceId).all();

    const sources = (workspaceRows.results || []) as any[];
    const sourceWorkspaceId = requestedSource || text(sources[0]?.id);

    if (!sourceWorkspaceId) {
      return c.json({
        success: true,
        engineVersion: '2.6.0',
        transferMode: 'copy',
        sources: [],
        sourceWorkspaceId: '',
        source: null,
        lineAccount: null,
        webhookTargets: [],
        keywordRoutes: [],
        templates: [],
        projects: [],
      });
    }

    if (sourceWorkspaceId === destinationWorkspaceId) {
      return c.json({ success: false, error: '來源與目的 Workspace 不可相同。' }, 400);
    }

    const source = sources.find((x: any) => x.id === sourceWorkspaceId);
    if (!source) {
      return c.json({ success: false, error: '找不到來源 Workspace。' }, 404);
    }

    const result = await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        SELECT
          id, oa_name, line_login_channel_id, line_channel_id,
          line_bot_basic_id, status, webhook_enabled,
          CASE WHEN line_login_channel_secret IS NOT NULL AND line_login_channel_secret <> '' THEN 1 ELSE 0 END AS has_login_secret,
          CASE WHEN line_bot_channel_access_token IS NOT NULL AND line_bot_channel_access_token <> '' THEN 1 ELSE 0 END AS has_bot_token,
          CASE WHEN line_bot_channel_secret IS NOT NULL AND line_bot_channel_secret <> '' THEN 1 ELSE 0 END AS has_bot_secret
        FROM workspace_line_accounts
        WHERE workspace_id = ?
        LIMIT 1
      `).bind(sourceWorkspaceId),

      c.env.smart_menu_db.prepare(`
        SELECT id, name, target_type, endpoint_url, position,
               enabled, can_reply, forward_signature, timeout_ms
        FROM workspace_webhook_targets
        WHERE workspace_id = ?
        ORDER BY position ASC
      `).bind(sourceWorkspaceId),

      c.env.smart_menu_db.prepare(`
        SELECT r.id, r.keyword, r.match_type, r.priority, r.enabled,
               t.name AS target_name, t.position AS target_position
        FROM workspace_keyword_routes r
        JOIN workspace_webhook_targets t ON t.id = r.target_id
        WHERE r.workspace_id = ?
        ORDER BY r.priority ASC, r.created_at ASC
      `).bind(sourceWorkspaceId),

      c.env.smart_menu_db.prepare(`
        SELECT
          t.id, t.name, t.industry, t.status, t.asset_id,
          t.area_count, t.page_count, t.updated_at,
          a.workspace_id AS asset_workspace_id,
          a.storage_key AS asset_storage_key
        FROM templates t
        LEFT JOIN assets a ON a.id = t.asset_id
        WHERE t.workspace_id = ?
          AND t.deleted_at IS NULL
        ORDER BY t.updated_at DESC, t.created_at DESC
      `).bind(sourceWorkspaceId),

      c.env.smart_menu_db.prepare(`
        SELECT
          p.id, p.template_id, p.name, p.status, p.asset_id,
          p.page_count, p.updated_at,
          COUNT(pa.id) AS area_count,
          a.workspace_id AS asset_workspace_id,
          a.storage_key AS asset_storage_key
        FROM projects p
        LEFT JOIN project_areas pa
          ON pa.project_id = p.id
         AND pa.workspace_id = p.workspace_id
        LEFT JOIN assets a ON a.id = p.asset_id
        WHERE p.workspace_id = ?
          AND p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY p.updated_at DESC, p.created_at DESC
      `).bind(sourceWorkspaceId),
    ]);

    const templates = (result[3]?.results || []) as any[];
    const projects = (result[4]?.results || []) as any[];

    const ownershipWarnings = [
      ...templates
        .filter(x => x.asset_id && x.asset_workspace_id !== sourceWorkspaceId)
        .map(x => ({
          type: 'template_asset_workspace_mismatch',
          id: x.id,
          name: x.name,
          assetId: x.asset_id,
          assetWorkspaceId: x.asset_workspace_id,
        })),
      ...projects
        .filter(x => x.asset_id && x.asset_workspace_id !== sourceWorkspaceId)
        .map(x => ({
          type: 'project_asset_workspace_mismatch',
          id: x.id,
          name: x.name,
          assetId: x.asset_id,
          assetWorkspaceId: x.asset_workspace_id,
        })),
    ];

    return c.json({
      success: true,
      engineVersion: '2.6.0',
      transferMode: 'copy',
      sources,
      sourceWorkspaceId,
      source,
      lineAccount: result[0]?.results?.[0] || null,
      webhookTargets: result[1]?.results || [],
      keywordRoutes: result[2]?.results || [],
      templates,
      projects,
      ownershipWarnings,
      preflightHealthy: ownershipWarnings.length === 0,
    });
  } catch (e: any) {
    return c.json({
      success: false,
      error: e?.message === 'SYSTEM_ADMIN_REQUIRED'
        ? '需要系統管理員權限。'
        : (e?.message || 'Tenant Transfer 預覽失敗'),
    }, e?.message === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500);
  }
});

app.post('/api/system/workspaces/:workspaceId/data-migration', async (c) => {
  const createdR2Keys: string[] = [];

  try {
    await requireSystemAdmin(c);

    const destinationWorkspaceId = text(c.req.param('workspaceId'));
    const body: any = await c.req.json();
    const sourceWorkspaceId = text(body.sourceWorkspaceId);

    if (!sourceWorkspaceId) {
      return c.json({ success: false, error: '請選擇來源 Workspace。' }, 400);
    }
    if (sourceWorkspaceId === destinationWorkspaceId) {
      return c.json({ success: false, error: '來源與目的 Workspace 不可相同。' }, 400);
    }

    const sourceWorkspace: any = await c.env.smart_menu_db.prepare(`
      SELECT id, name
      FROM workspaces
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(sourceWorkspaceId).first();

    const destinationWorkspace: any = await c.env.smart_menu_db.prepare(`
      SELECT id, name
      FROM workspaces
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(destinationWorkspaceId).first();

    if (!sourceWorkspace || !destinationWorkspace) {
      return c.json({ success: false, error: '來源或目的 Workspace 不存在。' }, 404);
    }

    await ensureWorkspaceLineHub(c.env, destinationWorkspaceId);

    const copyLine = body.copyLine === true;
    const copyWebhooks = body.copyWebhooks === true;
    const copyKeywords = body.copyKeywords === true;

    const templateIds = Array.isArray(body.templateIds)
      ? [...new Set(body.templateIds.map((x: any) => text(x)).filter(Boolean))]
      : [];

    const projectIds = Array.isArray(body.projectIds)
      ? [...new Set(body.projectIds.map((x: any) => text(x)).filter(Boolean))]
      : [];

    // Preflight: selected content must genuinely belong to source workspace,
    // and every referenced Asset must match source ownership.
    for (const templateId of templateIds) {
      const row: any = await c.env.smart_menu_db.prepare(`
        SELECT
          t.id, t.asset_id,
          a.workspace_id AS asset_workspace_id
        FROM templates t
        LEFT JOIN assets a ON a.id = t.asset_id
        WHERE t.id = ?
          AND t.workspace_id = ?
          AND t.deleted_at IS NULL
        LIMIT 1
      `).bind(templateId, sourceWorkspaceId).first();

      if (!row) throw new Error(`模板不屬於來源 Workspace：${templateId}`);
      if (row.asset_id && row.asset_workspace_id !== sourceWorkspaceId) {
        throw new Error(`模板 Asset ownership 不一致，請先用租戶健康檢查修復：${templateId}`);
      }
    }

    for (const projectId of projectIds) {
      const row: any = await c.env.smart_menu_db.prepare(`
        SELECT
          p.id, p.asset_id,
          a.workspace_id AS asset_workspace_id
        FROM projects p
        LEFT JOIN assets a ON a.id = p.asset_id
        WHERE p.id = ?
          AND p.workspace_id = ?
          AND p.deleted_at IS NULL
        LIMIT 1
      `).bind(projectId, sourceWorkspaceId).first();

      if (!row) throw new Error(`專案不屬於來源 Workspace：${projectId}`);
      if (row.asset_id && row.asset_workspace_id !== sourceWorkspaceId) {
        throw new Error(`專案 Asset ownership 不一致，請先用租戶健康檢查修復：${projectId}`);
      }
    }

    const summary: any = {
      engineVersion: '2.6.0',
      transferMode: 'copy',
      sourceWorkspaceId,
      destinationWorkspaceId,
      lineCopied: false,
      webhookTargetsCopied: 0,
      keywordRoutesCopied: 0,
      templatesCopied: 0,
      projectsCopied: 0,
      assetsCopied: 0,
      r2ObjectsCopied: 0,
    };

    // LINE credentials copy. Destination gateway token remains untouched.
    if (copyLine) {
      const sourceAccount: any = await c.env.smart_menu_db.prepare(`
        SELECT *
        FROM workspace_line_accounts
        WHERE workspace_id = ?
        LIMIT 1
      `).bind(sourceWorkspaceId).first();

      if (sourceAccount) {
        await c.env.smart_menu_db.prepare(`
          UPDATE workspace_line_accounts
          SET
            oa_name = ?,
            line_login_channel_id = ?,
            line_login_channel_secret = ?,
            line_channel_id = ?,
            line_bot_channel_access_token = ?,
            line_bot_channel_secret = ?,
            line_bot_basic_id = ?,
            status = ?,
            webhook_enabled = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE workspace_id = ?
        `).bind(
          sourceAccount.oa_name,
          sourceAccount.line_login_channel_id,
          sourceAccount.line_login_channel_secret,
          sourceAccount.line_channel_id,
          sourceAccount.line_bot_channel_access_token,
          sourceAccount.line_bot_channel_secret,
          sourceAccount.line_bot_basic_id,
          sourceAccount.status || 'disconnected',
          Number(sourceAccount.webhook_enabled ?? 1),
          destinationWorkspaceId
        ).run();

        summary.lineCopied = true;
      }
    }

    const sourceTargets = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM workspace_webhook_targets
      WHERE workspace_id = ?
      ORDER BY position ASC
    `).bind(sourceWorkspaceId).all();

    const destinationTargets = await c.env.smart_menu_db.prepare(`
      SELECT *
      FROM workspace_webhook_targets
      WHERE workspace_id = ?
      ORDER BY position ASC
    `).bind(destinationWorkspaceId).all();

    const destinationByPosition = new Map<number, any>();
    for (const row of (destinationTargets.results || []) as any[]) {
      destinationByPosition.set(Number(row.position), row);
    }

    if (copyWebhooks) {
      for (const sourceTarget of (sourceTargets.results || []) as any[]) {
        const destinationTarget = destinationByPosition.get(Number(sourceTarget.position));
        if (!destinationTarget) continue;

        await c.env.smart_menu_db.prepare(`
          UPDATE workspace_webhook_targets
          SET
            name = ?,
            target_type = ?,
            endpoint_url = ?,
            enabled = ?,
            can_reply = ?,
            forward_signature = ?,
            timeout_ms = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND workspace_id = ?
        `).bind(
          sourceTarget.name,
          sourceTarget.target_type,
          sourceTarget.endpoint_url,
          Number(sourceTarget.enabled ?? 0),
          Number(sourceTarget.can_reply ?? 0),
          Number(sourceTarget.forward_signature ?? 0),
          Number(sourceTarget.timeout_ms || 8000),
          destinationTarget.id,
          destinationWorkspaceId
        ).run();

        summary.webhookTargetsCopied += 1;
      }
    }

    if (copyKeywords) {
      await c.env.smart_menu_db.prepare(`
        DELETE FROM workspace_keyword_routes
        WHERE workspace_id = ?
      `).bind(destinationWorkspaceId).run();

      const sourceRoutes = await c.env.smart_menu_db.prepare(`
        SELECT r.*, t.position AS target_position
        FROM workspace_keyword_routes r
        JOIN workspace_webhook_targets t ON t.id = r.target_id
        WHERE r.workspace_id = ?
        ORDER BY r.priority ASC, r.created_at ASC
      `).bind(sourceWorkspaceId).all();

      for (const sourceRoute of (sourceRoutes.results || []) as any[]) {
        const destinationTarget =
          destinationByPosition.get(Number(sourceRoute.target_position));
        if (!destinationTarget) continue;

        await c.env.smart_menu_db.prepare(`
          INSERT INTO workspace_keyword_routes (
            id, workspace_id, keyword, keyword_normalized,
            match_type, target_id, priority, enabled,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(
          id('kwr'),
          destinationWorkspaceId,
          sourceRoute.keyword,
          sourceRoute.keyword_normalized || normalizeKeyword(sourceRoute.keyword),
          sourceRoute.match_type,
          destinationTarget.id,
          Number(sourceRoute.priority || 100),
          Number(sourceRoute.enabled ?? 1)
        ).run();

        summary.keywordRoutesCopied += 1;
      }
    }

    const assetMap = new Map<string, string>();
    const templateMap = new Map<string, string>();

    // Templates first so Projects can remap template_id.
    for (const sourceTemplateId of templateIds) {
      const normalizedSourceTemplateId = text(sourceTemplateId);
      const sourceTemplate: any = await c.env.smart_menu_db.prepare(`
        SELECT *
        FROM templates
        WHERE id = ?
          AND workspace_id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `).bind(normalizedSourceTemplateId, sourceWorkspaceId).first();

      if (!sourceTemplate) continue;

      const beforeAssetCount = assetMap.size;
      const newAssetId = sourceTemplate.asset_id
        ? await copyAssetBundleToWorkspace(
            c.env,
            sourceWorkspaceId,
            destinationWorkspaceId,
            sourceTemplate.asset_id,
            assetMap
          )
        : null;

      if (assetMap.size > beforeAssetCount) {
        const copiedAsset: any = await c.env.smart_menu_db.prepare(`
          SELECT storage_key
          FROM assets
          WHERE id = ?
          LIMIT 1
        `).bind(newAssetId).first();

        if (copiedAsset?.storage_key) {
          createdR2Keys.push(copiedAsset.storage_key);
          summary.r2ObjectsCopied += 1;
        }
      }

      const newTemplateId = id('tpl');
      templateMap.set(normalizedSourceTemplateId, newTemplateId);

      await c.env.smart_menu_db.prepare(`
        INSERT INTO templates (
          id, workspace_id, name, industry, status, asset_id,
          area_count, page_count, ai_provider, ai_model,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        newTemplateId,
        destinationWorkspaceId,
        sourceTemplate.name,
        sourceTemplate.industry,
        sourceTemplate.status,
        newAssetId,
        Number(sourceTemplate.area_count || 0),
        Number(sourceTemplate.page_count || 1),
        sourceTemplate.ai_provider,
        sourceTemplate.ai_model
      ).run();

      const areas = await c.env.smart_menu_db.prepare(`
        SELECT *
        FROM template_areas
        WHERE template_id = ?
          AND workspace_id = ?
        ORDER BY area_index ASC
      `).bind(normalizedSourceTemplateId, sourceWorkspaceId).all();

      const statements = ((areas.results || []) as any[]).map((row: any, index: number) =>
        areaInsertStatement(
          c.env,
          destinationWorkspaceId,
          newTemplateId,
          transferAreaShape(row),
          index
        )
      );

      if (statements.length) {
        await c.env.smart_menu_db.batch(statements);
      }

      summary.templatesCopied += 1;
    }

    for (const sourceProjectId of projectIds) {
      const sourceProject: any = await c.env.smart_menu_db.prepare(`
        SELECT *
        FROM projects
        WHERE id = ?
          AND workspace_id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `).bind(sourceProjectId, sourceWorkspaceId).first();

      if (!sourceProject) continue;

      const beforeAssetCount = assetMap.size;
      const newAssetId = sourceProject.asset_id
        ? await copyAssetBundleToWorkspace(
            c.env,
            sourceWorkspaceId,
            destinationWorkspaceId,
            sourceProject.asset_id,
            assetMap
          )
        : null;

      if (assetMap.size > beforeAssetCount) {
        const copiedAsset: any = await c.env.smart_menu_db.prepare(`
          SELECT storage_key
          FROM assets
          WHERE id = ?
          LIMIT 1
        `).bind(newAssetId).first();

        if (copiedAsset?.storage_key) {
          createdR2Keys.push(copiedAsset.storage_key);
          summary.r2ObjectsCopied += 1;
        }
      }

      const newProjectId = id('prj');
      const mappedTemplateId = sourceProject.template_id
        ? (templateMap.get(sourceProject.template_id) || null)
        : null;

      await c.env.smart_menu_db.prepare(`
        INSERT INTO projects (
          id, workspace_id, template_id, name, status,
          asset_id, page_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        newProjectId,
        destinationWorkspaceId,
        mappedTemplateId,
        sourceProject.name,
        sourceProject.status || 'draft',
        newAssetId,
        Number(sourceProject.page_count || 1)
      ).run();

      const areas = await c.env.smart_menu_db.prepare(`
        SELECT *
        FROM project_areas
        WHERE project_id = ?
          AND workspace_id = ?
        ORDER BY area_index ASC
      `).bind(sourceProjectId, sourceWorkspaceId).all();

      const statements = ((areas.results || []) as any[]).map((row: any, index: number) =>
        projectAreaInsertStatement(
          c.env,
          destinationWorkspaceId,
          newProjectId,
          transferAreaShape(row),
          index
        )
      );

      if (statements.length) {
        await c.env.smart_menu_db.batch(statements);
      }

      summary.projectsCopied += 1;
    }

    summary.assetsCopied = assetMap.size;

    return c.json({
      success: true,
      migration: summary,
      note: 'Tenant Transfer V2.6 完成：來源資料保留，目的端建立新 IDs / 新 Asset rows / 新 R2 objects；Gateway webhook token 保留。',
    });
  } catch (e: any) {
    // Best-effort cleanup for R2 objects created during a failed transfer.
    if (createdR2Keys.length) {
      try {
        await Promise.all(
          createdR2Keys.map(key => c.env.smart_menu_assets.delete(key))
        );
      } catch {}
    }

    console.error('tenant-transfer-v2.6:', e);

    return c.json({
      success: false,
      error: e?.message === 'SYSTEM_ADMIN_REQUIRED'
        ? '需要系統管理員權限。'
        : (e?.message || 'Tenant Transfer 失敗'),
    }, e?.message === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500);
  }
});



app.get('/api/system/users', async (c) => {
  try {
    await requireSystemAdmin(c);

    const result = await c.env.smart_menu_db.prepare(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.display_name,
        u.status,
        GROUP_CONCAT(w.name, '、') AS workspace_names
      FROM users u
      LEFT JOIN workspace_members wm
        ON wm.user_id = u.id
       AND wm.status = 'active'
      LEFT JOIN workspaces w
        ON w.id = wm.workspace_id
       AND w.deleted_at IS NULL
      WHERE u.deleted_at IS NULL
        AND u.status = 'active'
        AND COALESCE(u.is_system_admin, 0) = 0
      GROUP BY u.id
      ORDER BY u.display_name ASC, u.created_at ASC
    `).all();

    return c.json({ success: true, users: result.results || [] });
  } catch (e: any) {
    if (e?.message === 'SYSTEM_ADMIN_REQUIRED') {
      return c.json({ success: false, error: '需要系統管理員權限。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '使用者查詢失敗' }, 500);
  }
});

app.get('/api/system/workspaces', async (c) => {
  const startedAt = Date.now();

  try {
    await requireSystemAdmin(c);

    const r = await c.env.smart_menu_db.prepare(`
      SELECT
        w.id,
        w.name,
        w.slug,
        w.status,
        w.plan,
        w.created_at,
        w.updated_at,
        p.contact_name,
        p.phone,
        p.company_name,
        p.tax_id,
        p.industry,
        COALESCE(mc.member_count, 0) AS member_count,
        COALESCE(hc.active_webhook_count, 0) AS active_webhook_count
      FROM workspaces w
      LEFT JOIN workspace_profiles p
        ON p.workspace_id = w.id
      LEFT JOIN (
        SELECT workspace_id, COUNT(*) AS member_count
        FROM workspace_members
        WHERE status = 'active'
        GROUP BY workspace_id
      ) mc
        ON mc.workspace_id = w.id
      LEFT JOIN (
        SELECT workspace_id, COUNT(*) AS active_webhook_count
        FROM workspace_webhook_targets
        WHERE enabled = 1
        GROUP BY workspace_id
      ) hc
        ON hc.workspace_id = w.id
      WHERE w.deleted_at IS NULL
      ORDER BY w.created_at DESC
    `).all();

    c.header('Server-Timing', `db;dur=${Date.now() - startedAt}`);
    c.header('Cache-Control', 'private, max-age=5');

    return c.json({
      success: true,
      workspaces: r.results || [],
      performance: { serverMs: Date.now() - startedAt },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        error: e?.message === 'SYSTEM_ADMIN_REQUIRED'
          ? '需要系統管理員權限。'
          : (e?.message || 'Workspace 查詢失敗'),
      },
      e?.message === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500
    );
  }
});

app.get('/api/system/workspaces/:workspaceId', async (c) => {
  const startedAt = Date.now();

  try {
    await requireSystemAdmin(c);
    const wid = text(c.req.param('workspaceId'));

    // Read-only GET. No hidden initialization/writes.
    const result = await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        SELECT
          w.*,
          p.contact_name,
          p.phone,
          p.company_name,
          p.tax_id,
          p.industry,
          p.address,
          p.notes
        FROM workspaces w
        LEFT JOIN workspace_profiles p
          ON p.workspace_id = w.id
        WHERE w.id = ?
          AND w.deleted_at IS NULL
        LIMIT 1
      `).bind(wid),

      c.env.smart_menu_db.prepare(`
        SELECT *
        FROM workspace_line_accounts
        WHERE workspace_id = ?
        LIMIT 1
      `).bind(wid),

      c.env.smart_menu_db.prepare(`
        SELECT *
        FROM workspace_webhook_targets
        WHERE workspace_id = ?
        ORDER BY position
      `).bind(wid),

      c.env.smart_menu_db.prepare(`
        SELECT
          r.*,
          t.name AS target_name
        FROM workspace_keyword_routes r
        JOIN workspace_webhook_targets t
          ON t.id = r.target_id
        WHERE r.workspace_id = ?
        ORDER BY r.priority, r.created_at
      `).bind(wid),
    ]);

    const w: any = result[0]?.results?.[0] || null;
    if (!w) {
      return c.json({ success: false, error: '找不到 Workspace。' }, 404);
    }

    const a: any = result[1]?.results?.[0] || null;
    const ts = result[2]?.results || [];
    const ks = result[3]?.results || [];

    c.header('Server-Timing', `db;dur=${Date.now() - startedAt}`);

    return c.json({
      success: true,
      workspace: w,
      lineAccount: a ? {
        id: a.id,
        workspaceId: a.workspace_id,
        oaName: a.oa_name,
        lineLoginChannelId: a.line_login_channel_id,
        lineBotChannelId: a.line_channel_id,
        lineBotBasicId: a.line_bot_basic_id,
        status: a.status,
        webhookEnabled: Boolean(a.webhook_enabled),
        webhookPath: a.webhook_token
          ? `/line/webhook/${wid}/${a.webhook_token}`
          : null,
        hasLoginSecret: Boolean(a.line_login_channel_secret),
        hasBotToken: Boolean(a.line_bot_channel_access_token),
        hasBotSecret: Boolean(a.line_bot_channel_secret),
      } : null,
      targets: ts,
      keywordRoutes: ks,
      performance: { serverMs: Date.now() - startedAt },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        error: e?.message === 'SYSTEM_ADMIN_REQUIRED'
          ? '需要系統管理員權限。'
          : (e?.message || 'Workspace 讀取失敗'),
      },
      e?.message === 'SYSTEM_ADMIN_REQUIRED' ? 403 : 500
    );
  }
});

app.patch('/api/system/workspaces/:workspaceId/profile', async(c)=>{
  try{
    await requireSystemAdmin(c); const wid=text(c.req.param('workspaceId')); const b:any=await c.req.json();
    await c.env.smart_menu_db.prepare(`
      INSERT INTO workspace_profiles(workspace_id,contact_name,phone,company_name,tax_id,industry,address,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(workspace_id) DO UPDATE SET contact_name=excluded.contact_name,phone=excluded.phone,
      company_name=excluded.company_name,tax_id=excluded.tax_id,industry=excluded.industry,address=excluded.address,
      notes=excluded.notes,updated_at=CURRENT_TIMESTAMP
    `).bind(wid,text(b.contactName)||null,text(b.phone)||null,text(b.companyName)||null,text(b.taxId)||null,
      text(b.industry)||null,text(b.address)||null,text(b.notes)||null).run();
    if(text(b.workspaceName))await c.env.smart_menu_db.prepare(`UPDATE workspaces SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(text(b.workspaceName),wid).run();
    return c.json({success:true});
  }catch(e:any){return c.json({success:false,error:e?.message==='SYSTEM_ADMIN_REQUIRED'?'需要系統管理員權限。':(e?.message||'一般資訊儲存失敗')},e?.message==='SYSTEM_ADMIN_REQUIRED'?403:500)}
});

app.patch('/api/system/workspaces/:workspaceId/line-account',async(c)=>{
 try{
  await requireSystemAdmin(c);const wid=text(c.req.param('workspaceId'));const b:any=await c.req.json();await ensureWorkspaceLineHub(c.env,wid);
  await c.env.smart_menu_db.prepare(`
   UPDATE workspace_line_accounts SET oa_name=?,line_login_channel_id=?,
   line_login_channel_secret=COALESCE(NULLIF(?,''),line_login_channel_secret),line_channel_id=?,
   line_bot_channel_access_token=COALESCE(NULLIF(?,''),line_bot_channel_access_token),
   line_bot_channel_secret=COALESCE(NULLIF(?,''),line_bot_channel_secret),line_bot_basic_id=?,
   status=?,webhook_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?
  `).bind(text(b.oaName)||null,text(b.lineLoginChannelId)||null,text(b.lineLoginChannelSecret),
   text(b.lineBotChannelId)||null,text(b.lineBotChannelAccessToken),text(b.lineBotChannelSecret),
   text(b.lineBotBasicId)||null,text(b.status||'disconnected'),b.webhookEnabled===false?0:1,wid).run();
  const a:any=await c.env.smart_menu_db.prepare(`SELECT webhook_token FROM workspace_line_accounts WHERE workspace_id=? LIMIT 1`).bind(wid).first();
  return c.json({success:true,webhookPath:a?.webhook_token?`/line/webhook/${wid}/${a.webhook_token}`:null});
 }catch(e:any){return c.json({success:false,error:e?.message==='SYSTEM_ADMIN_REQUIRED'?'需要系統管理員權限。':(e?.message||'LINE OA 設定失敗')},e?.message==='SYSTEM_ADMIN_REQUIRED'?403:500)}
});

app.patch('/api/system/workspaces/:workspaceId/targets/:targetId',async(c)=>{
 try{
  await requireSystemAdmin(c);const wid=text(c.req.param('workspaceId')),tid=text(c.req.param('targetId'));const b:any=await c.req.json();
  const x:any=await c.env.smart_menu_db.prepare(`SELECT * FROM workspace_webhook_targets WHERE id=? AND workspace_id=? LIMIT 1`).bind(tid,wid).first();
  if(!x)return c.json({success:false,error:'找不到 Webhook target。'},404);
  await c.env.smart_menu_db.prepare(`
   UPDATE workspace_webhook_targets SET name=?,endpoint_url=?,enabled=?,can_reply=?,forward_signature=?,timeout_ms=?,updated_at=CURRENT_TIMESTAMP
   WHERE id=? AND workspace_id=?
  `).bind(text(b.name??x.name),text(b.endpointUrl??x.endpoint_url)||null,b.enabled===undefined?x.enabled:(b.enabled?1:0),
   b.canReply===undefined?x.can_reply:(b.canReply?1:0),b.forwardSignature===undefined?x.forward_signature:(b.forwardSignature?1:0),
   Math.max(1000,Math.min(30000,Math.round(num(b.timeoutMs,x.timeout_ms||8000)))),tid,wid).run();
  return c.json({success:true});
 }catch(e:any){return c.json({success:false,error:e?.message==='SYSTEM_ADMIN_REQUIRED'?'需要系統管理員權限。':(e?.message||'Webhook 更新失敗')},e?.message==='SYSTEM_ADMIN_REQUIRED'?403:500)}
});

app.post('/api/system/workspaces/:workspaceId/keywords/check-conflict',async(c)=>{
 try{
  await requireSystemAdmin(c);const wid=text(c.req.param('workspaceId'));const b:any=await c.req.json();
  const k=text(b.keyword),m=text(b.matchType||'exact').toLowerCase();
  if(!k)return c.json({success:false,error:'關鍵字不可空白。'},400);
  const x:any=await findKeywordConflict(c.env,wid,k,m,text(b.excludeRouteId));
  return c.json({success:true,conflict:x?{routeId:x.id,keyword:x.keyword,matchType:x.match_type,targetId:x.target_id,targetName:x.target_name}:null});
 }catch(e:any){return c.json({success:false,error:e?.message==='SYSTEM_ADMIN_REQUIRED'?'需要系統管理員權限。':(e?.message||'衝突檢查失敗')},e?.message==='SYSTEM_ADMIN_REQUIRED'?403:500)}
});

app.post('/api/system/workspaces/:workspaceId/keywords',async(c)=>{
 try{
  await requireSystemAdmin(c);const wid=text(c.req.param('workspaceId'));const b:any=await c.req.json();
  const k=text(b.keyword),m=text(b.matchType||'exact').toLowerCase(),tid=text(b.targetId);
  if(!k)return c.json({success:false,error:'關鍵字不可空白。'},400);
  if(!['exact','prefix','contains'].includes(m))return c.json({success:false,error:'matchType 不正確。'},400);
  const t=await c.env.smart_menu_db.prepare(`SELECT id FROM workspace_webhook_targets WHERE id=? AND workspace_id=? LIMIT 1`).bind(tid,wid).first();
  if(!t)return c.json({success:false,error:'指定 System A/B 不存在。'},400);
  const x:any=await findKeywordConflict(c.env,wid,k,m);
  if(x)return c.json({success:false,error:`關鍵字「${k}」會與 ${x.target_name} 的「${x.keyword}」(${x.match_type}) 競爭。`,
    conflict:{routeId:x.id,keyword:x.keyword,matchType:x.match_type,targetId:x.target_id,targetName:x.target_name}},409);
  const rid=id('kwr');
  await c.env.smart_menu_db.prepare(`
   INSERT INTO workspace_keyword_routes(id,workspace_id,keyword,keyword_normalized,match_type,target_id,priority,enabled,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `).bind(rid,wid,k,normalizeKeyword(k),m,tid,Math.round(num(b.priority,100))).run();
  return c.json({success:true,routeId:rid},201);
 }catch(e:any){return c.json({success:false,error:e?.message==='SYSTEM_ADMIN_REQUIRED'?'需要系統管理員權限。':(e?.message||'關鍵字建立失敗')},e?.message==='SYSTEM_ADMIN_REQUIRED'?403:500)}
});

app.delete('/api/system/workspaces/:workspaceId/keywords/:routeId',async(c)=>{
 try{
  await requireSystemAdmin(c);const wid=text(c.req.param('workspaceId')),rid=text(c.req.param('routeId'));
  await c.env.smart_menu_db.prepare(`DELETE FROM workspace_keyword_routes WHERE id=? AND workspace_id=?`).bind(rid,wid).run();
  return c.json({success:true});
 }catch(e:any){return c.json({success:false,error:e?.message==='SYSTEM_ADMIN_REQUIRED'?'需要系統管理員權限。':(e?.message||'關鍵字刪除失敗')},e?.message==='SYSTEM_ADMIN_REQUIRED'?403:500)}
});

app.notFound((c) => c.json({ success: false, error: 'API route not found', path: c.req.path }, 404));
app.onError((err, c) => {
  console.error('Worker global error:', err);
  return c.json({ success: false, error: err.message || 'Worker internal error' }, 500);
});


function pointsPeriod(value: unknown): '7d' | '30d' { return value === '30d' ? '30d' : '7d'; }
async function scopedPointAccount(db:D1Database, workspaceId:string, lineAccountId:string) {
  return db.prepare('SELECT id FROM workspace_line_accounts WHERE id=? AND workspace_id=? LIMIT 1').bind(lineAccountId,workspaceId).first<any>();
}

function contributionRouteError(error:any, fallback:string) {
  const code=String(error?.message||'');
  if (code==='FORBIDDEN_ROLE') return { error:'FORBIDDEN', status:403 };
  if (['INVALID_SCORE_DELTA','INVALID_TIER_RULE','TIER_THRESHOLD_AMBIGUOUS','TIER_THRESHOLD_ORDER_INVALID'].includes(code)) return { error:code, status:400 };
  return { error:fallback, status:500 };
}
app.get('/api/contribution-rules',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),eventType=text(c.req.query('eventType'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);let sql='SELECT event_type AS eventType,score_delta AS scoreDelta,version_no AS versionNo,effective_from AS effectiveFrom,created_at AS createdAt FROM contribution_rule_versions WHERE workspace_id=? AND line_account_id=?',args:any[]=[workspaceId,lineAccountId];if(eventType){if(!isContributionEventType(eventType))return c.json({success:false,error:'INVALID_CONTRIBUTION_EVENT_TYPE'},400);sql+=' AND event_type=?';args.push(eventType);}sql+=' ORDER BY event_type ASC,version_no DESC';const rows:any[]=(await c.env.smart_menu_db.prepare(sql).bind(...args).all()).results||[];return c.json({success:true,rules:rows.map(r=>({eventType:text(r.eventType),scoreDelta:Number(r.scoreDelta),versionNo:Number(r.versionNo),effectiveFrom:r.effectiveFrom,createdAt:r.createdAt}))});}catch(e:any){const x=contributionRouteError(e,'CONTRIBUTION_RULE_LIST_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.post('/api/contribution-rules',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json().catch(()=>({})),lineAccountId=text(body.lineAccountId),eventType=text(body.eventType);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!isContributionEventType(eventType))return c.json({success:false,error:'INVALID_CONTRIBUTION_EVENT_TYPE'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,rule:await createContributionRuleVersion(c.env.smart_menu_db,{workspaceId,lineAccountId,eventType,scoreDelta:Number(body.scoreDelta),createdByUserId:text(c.get('userId'))})},201);}catch(e:any){const x=contributionRouteError(e,'CONTRIBUTION_RULE_CREATE_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.get('/api/tier-rules',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const rows:any[]=(await c.env.smart_menu_db.prepare('SELECT tier_code AS tierCode,tier_name AS tierName,min_contribution_score AS minContributionScore,version_no AS versionNo,effective_from AS effectiveFrom,created_at AS createdAt FROM member_tier_rule_versions WHERE workspace_id=? AND line_account_id=? ORDER BY tier_code ASC,version_no DESC').bind(workspaceId,lineAccountId).all()).results||[];return c.json({success:true,rules:rows.map(r=>({tierCode:text(r.tierCode),tierName:text(r.tierName),minContributionScore:Number(r.minContributionScore),versionNo:Number(r.versionNo),effectiveFrom:r.effectiveFrom,createdAt:r.createdAt}))});}catch(e:any){const x=contributionRouteError(e,'TIER_RULE_LIST_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.post('/api/tier-rules',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json().catch(()=>({})),lineAccountId=text(body.lineAccountId),tierCode=text(body.tierCode).toUpperCase();if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!isTierCode(tierCode))return c.json({success:false,error:'INVALID_TIER_CODE'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,rule:await createTierRuleVersion(c.env.smart_menu_db,{workspaceId,lineAccountId,tierCode,tierName:text(body.tierName,80),minContributionScore:Number(body.minContributionScore),createdByUserId:text(c.get('userId'))})},201);}catch(e:any){const x=contributionRouteError(e,'TIER_RULE_CREATE_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.get('/api/contribution-summary',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),period=pointsPeriod(c.req.query('period'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,...await tenantContributionSummary(c.env.smart_menu_db,{workspaceId,lineAccountId,period})});}catch(e:any){const x=contributionRouteError(e,'CONTRIBUTION_SUMMARY_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.get('/api/member/contribution',async c=>{try{const lineAccountId=text(c.req.query('lineAccountId')),period=pointsPeriod(c.req.query('period')),verified=await verifiedReferralMember(c,{lineAccountId,liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')});return c.json({success:true,...await memberContributionRead(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,memberId:verified.memberId,period})});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
function pointsRouteError(error:any, fallback:string) {
  const code=String(error?.message||'');
  if (code==='FORBIDDEN_ROLE') return { error:'FORBIDDEN', status:403 };
  if (['INVALID_POINTS','INVALID_REWARD_POINTS_COST','REWARD_NAME_REQUIRED','INVALID_REWARD_STATUS'].includes(code)) return { error:code, status:400 };
  if (['INSUFFICIENT_POINTS','REWARD_NOT_AVAILABLE','REWARD_HANDLE_INVALID','REWARD_HANDLE_EXPIRED','INVALID_REWARD_STATUS_TRANSITION','REWARD_ARCHIVED'].includes(code)) return { error:code, status:409 };
  return { error:fallback, status:500 };
}
app.get('/api/point-rules',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const rules:any[]=(await c.env.smart_menu_db.prepare('SELECT reason_code AS reasonCode,points,version_no AS versionNo,effective_from AS effectiveFrom,created_at AS createdAt FROM point_rule_versions WHERE workspace_id=? AND line_account_id=? ORDER BY reason_code ASC,version_no DESC').bind(workspaceId,lineAccountId).all()).results||[];return c.json({success:true,rules:rules.map(row=>({reasonCode:text(row.reasonCode),points:Number(row.points),versionNo:Number(row.versionNo),effectiveFrom:row.effectiveFrom,createdAt:row.createdAt}))});}catch(e:any){const x=pointsRouteError(e,'POINT_RULE_LIST_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.post('/api/point-rules',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json().catch(()=>({})),lineAccountId=text(body.lineAccountId),reasonCode=text(body.reasonCode),points=Number(body.points);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(reasonCode!=='QUALIFIED_REFERRAL'&&reasonCode!=='VERIFIED_REFERRAL_CONVERSION')return c.json({success:false,error:'INVALID_POINT_REASON'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const rule=await createPointRuleVersion(c.env.smart_menu_db,{workspaceId,lineAccountId,reasonCode:reasonCode as any,points,createdByUserId:text(c.get('userId'))});return c.json({success:true,rule},201);}catch(e:any){const x=pointsRouteError(e,'POINT_RULE_CREATE_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.get('/api/points-summary',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),period=pointsPeriod(c.req.query('period'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,period,...await getTenantPointsSummary(c.env.smart_menu_db,{workspaceId,lineAccountId,period})});}catch(e:any){const x=pointsRouteError(e,'POINTS_SUMMARY_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.get('/api/member/points',async c=>{try{const lineAccountId=text(c.req.query('lineAccountId')),period=pointsPeriod(c.req.query('period')),verified=await verifiedReferralMember(c,{lineAccountId,liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')});return c.json({success:true,period,...await getMemberPoints(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,memberId:verified.memberId,period})});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.get('/api/point-rewards',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,rewards:await listTenantRewards(c.env.smart_menu_db,{workspaceId,lineAccountId})});}catch(e:any){const x=pointsRouteError(e,'REWARD_LIST_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.post('/api/point-rewards',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json().catch(()=>({})),lineAccountId=text(body.lineAccountId);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const reward=await createReward(c.env.smart_menu_db,{workspaceId,lineAccountId,name:text(body.name,120),description:text(body.description,1000),pointsCost:Number(body.pointsCost),createdByUserId:text(c.get('userId'))});return c.json({success:true,reward},201);}catch(e:any){const x=pointsRouteError(e,'REWARD_CREATE_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.post('/api/point-rewards/:rewardId/version',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json().catch(()=>({})),lineAccountId=text(c.req.query('lineAccountId'))||text(body.lineAccountId);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const reward=await createRewardVersion(c.env.smart_menu_db,{workspaceId,lineAccountId,rewardId:text(c.req.param('rewardId')),name:text(body.name,120),description:text(body.description,1000),pointsCost:Number(body.pointsCost),createdByUserId:text(c.get('userId'))});return c.json({success:true,reward},201);}catch(e:any){const x=pointsRouteError(e,'REWARD_VERSION_CREATE_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.post('/api/point-rewards/:rewardId/status',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json().catch(()=>({})),lineAccountId=text(c.req.query('lineAccountId'))||text(body.lineAccountId),status=text(body.status).toUpperCase();if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!isRewardStatus(status))return c.json({success:false,error:'INVALID_REWARD_STATUS'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,reward:await transitionRewardStatus(c.env.smart_menu_db,{workspaceId,lineAccountId,rewardId:text(c.req.param('rewardId')),toStatus:status})});}catch(e:any){const x=pointsRouteError(e,'REWARD_STATUS_UPDATE_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.get('/api/point-redemptions',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),period=pointsPeriod(c.req.query('period'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await scopedPointAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,period,...await tenantRedemptionSummary(c.env.smart_menu_db,{workspaceId,lineAccountId,period})});}catch(e:any){const x=pointsRouteError(e,'POINT_REDEMPTION_READ_FAILED');return c.json({success:false,error:x.error},x.status)}});
app.get('/api/member/rewards',async c=>{try{const lineAccountId=text(c.req.query('lineAccountId')),verified=await verifiedReferralMember(c,{lineAccountId,liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')});return c.json({success:true,rewards:await listMemberRewards(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,memberId:verified.memberId,secret:text(c.env.MEMBER_IDENTITY_HMAC_SECRET)})});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.post('/api/member/redemptions',async c=>{try{const body:any=await c.req.json().catch(()=>({})),verified=await verifiedReferralMember(c,body),rewardHandle=text(body.rewardHandle,4096);if(!rewardHandle)return c.json({success:false,error:'REWARD_HANDLE_REQUIRED'},400);const redemption=await redeemReward(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,memberId:verified.memberId,secret:text(c.env.MEMBER_IDENTITY_HMAC_SECRET),rewardHandle});return c.json({success:true,redemption},redemption.code==='REDEEMED'?201:200);}catch(e:any){const code=String(e?.message||'');if(['INSUFFICIENT_POINTS','REWARD_NOT_AVAILABLE','REWARD_HANDLE_INVALID','REWARD_HANDLE_EXPIRED'].includes(code))return c.json({success:false,error:code},409);return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.get('/api/member/redemptions',async c=>{try{const lineAccountId=text(c.req.query('lineAccountId')),verified=await verifiedReferralMember(c,{lineAccountId,liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')});return c.json({success:true,redemptions:await listMemberRedemptions(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,memberId:verified.memberId})});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});


function crmRouteError(error:any, fallback:string) {
  const code=String(error?.message||'');
  if (code==='FORBIDDEN_ROLE') return { error:'FORBIDDEN', status:403 };
  if (code==='CRM_PERSON_NOT_FOUND') return { error:'NOT_FOUND', status:404 };
  if (['CRM_PROFILE_PATCH_EMPTY','CRM_PROFILE_FIELD_FORBIDDEN','CRM_PERSON_STATUS_INVALID','CRM_INVALID_GENDER','CRM_DO_NOT_CONTACT_CLEAR_REQUIRES_MEMBER'].includes(code) || code.startsWith('CRM_INVALID_')) return { error:code, status:400 };
  return { error:fallback, status:500 };
}
async function crmLineAccountScope(db:D1Database, workspaceId:string, lineAccountId:string) {
  return db.prepare('SELECT id FROM workspace_line_accounts WHERE id=? AND workspace_id=? LIMIT 1').bind(lineAccountId,workspaceId).first<any>();
}
function crmTenantCanSeePii(c:any) { return text(c.get('userRole')||'viewer').toLowerCase()!=='viewer'; }

app.get('/api/crm/people',async c=>{try{
  requireRole(c,'viewer');
  const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));
  if(lineAccountId&&!await crmLineAccountScope(c.env.smart_menu_db,workspaceId,lineAccountId)) return c.json({success:false,error:'NOT_FOUND'},404);
  const people=await listCrmPeople(c.env.smart_menu_db,{workspaceId,lineAccountId:lineAccountId||undefined,search:text(c.req.query('search'),100),status:text(c.req.query('status')).toUpperCase()||undefined});
  const enriched=await Promise.all(people.map(async row=>{const [acquisition,referral,assignment]=await Promise.all([acquisitionSummary(c.env.smart_menu_db,workspaceId,row.id),referralSummary(c.env.smart_menu_db,workspaceId,row.id),assignmentSummary(c.env.smart_menu_db,workspaceId,row.id)]);return {...publicCrmPerson(row,{includePii:crmTenantCanSeePii(c),includeInternalNote:false}),firstAcquisitionSource:acquisition.first?.sourceType||null,latestAcquisitionSource:acquisition.latest?.sourceType||null,acquisitionAt:acquisition.latest?.occurredAt||null,hasReferrer:referral.hasReferrer,referrerLabel:referral.referrerLabel,assignedOwnerLabel:assignment?.label||null};}));return c.json({success:true,people:enriched});
}catch(e:any){const x=crmRouteError(e,'CRM_PERSON_LIST_FAILED');return c.json({success:false,error:x.error},x.status)}});

app.get('/api/crm/people/:safePersonReference',async c=>{try{
  requireRole(c,'viewer');
  const row=await crmPersonByReference(c.env.smart_menu_db,{workspaceId:workspaceIdOf(c),publicRef:text(c.req.param('safePersonReference'),80)});
  if(!row)return c.json({success:false,error:'NOT_FOUND'},404);
  const workspaceId=workspaceIdOf(c),[acquisition,referredBy,assignedOwner]=await Promise.all([acquisitionSummary(c.env.smart_menu_db,workspaceId,row.id),referralSummary(c.env.smart_menu_db,workspaceId,row.id),assignmentSummary(c.env.smart_menu_db,workspaceId,row.id)]);return c.json({success:true,person:{...publicCrmPerson(row,{includePii:crmTenantCanSeePii(c),includeInternalNote:crmTenantCanSeePii(c)}),acquisition,relationships:{referredBy,assignedOwner}}});
}catch(e:any){const x=crmRouteError(e,'CRM_PERSON_READ_FAILED');return c.json({success:false,error:x.error},x.status)}});

app.patch('/api/crm/people/:safePersonReference/profile',async c=>{try{
  requireRole(c,'editor');
  const workspaceId=workspaceIdOf(c),row=await crmPersonByReference(c.env.smart_menu_db,{workspaceId,publicRef:text(c.req.param('safePersonReference'),80)});
  if(!row)return c.json({success:false,error:'NOT_FOUND'},404);
  const body:any=await c.req.json().catch(()=>({})),patch=body&&typeof body.profile==='object'&&!Array.isArray(body.profile)?body.profile:{};
  const profile=await updateCrmProfile(c.env.smart_menu_db,{workspaceId,crmPersonId:text(row.id),patch,actor:{sourceType:'CRM_MANUAL',actorType:'TENANT_USER',actorUserId:text(c.get('userId'))||null}});
  return c.json({success:true,person:{...publicCrmPerson(row,{includePii:true,includeInternalNote:true}),profile}});
}catch(e:any){const x=crmRouteError(e,'CRM_PROFILE_UPDATE_FAILED');return c.json({success:false,error:x.error},x.status)}});

app.get('/api/member/crm-profile',async c=>{try{
  const verified=await verifiedReferralMember(c,{lineAccountId:text(c.req.query('lineAccountId')),liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')});
  const person=await ensureCrmPersonForVerifiedMember(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,lineMemberId:verified.memberId});
  const row=await crmPersonByReference(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,publicRef:person.publicRef});
  if(!row)throw new Error('CRM_PERSON_NOT_FOUND');
  return c.json({success:true,person:publicCrmPerson(row,{includePii:true,includeInternalNote:false})});
}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});

app.patch('/api/member/crm-profile',async c=>{try{
  const body:any=await c.req.json().catch(()=>({})),verified=await verifiedReferralMember(c,body);
  const person=await ensureCrmPersonForVerifiedMember(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,lineMemberId:verified.memberId});
  const patch=body&&typeof body.profile==='object'&&!Array.isArray(body.profile)?body.profile:{};
  const profile=await updateCrmProfile(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,crmPersonId:person.id,patch,actor:{sourceType:'MEMBER_SELF_INPUT',actorType:'MEMBER',memberSelf:true}});
  return c.json({success:true,person:{personRef:person.publicRef,profile}});
}catch(e:any){const code=String(e?.message||'');if(code.startsWith('CRM_'))return c.json({success:false,error:code},400);return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});



app.post('/api/crm/imports',async c=>{try{requireRole(c,'admin');const body:any=await c.req.json().catch(()=>({})),type=text(body.importType,40),capability=importCapability(type);if(!capability.available)return c.json({success:false,error:capability.code},409);const csv=text(body.csv,2_000_000);if(!csv)return c.json({success:false,error:'CSV_REQUIRED'},400);return c.json({success:true,import:await createCsvImport(c.env.smart_menu_db,{workspaceId:workspaceIdOf(c),userId:text(c.get('userId'))||null,csv,filename:text(body.filename,255),contentType:text(body.contentType,120)})},201);}catch(e:any){const code=String(e?.message||'');return c.json({success:false,error:code.startsWith('CSV_')?code:code==='FORBIDDEN_ROLE'?'FORBIDDEN':'CRM_IMPORT_CREATE_FAILED'},code==='FORBIDDEN_ROLE'?403:400)}});
app.get('/api/crm/imports',async c=>{try{requireRole(c,'admin');return c.json({success:true,imports:await listCrmImports(c.env.smart_menu_db,workspaceIdOf(c))});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'CRM_IMPORT_LIST_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/crm/imports/:importReference/rows',async c=>{try{requireRole(c,'admin');return c.json({success:true,rows:await importRows(c.env.smart_menu_db,workspaceIdOf(c),c.req.param('importReference'))});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'CRM_IMPORT_ROWS_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/crm/imports/:importReference',async c=>{try{requireRole(c,'admin');const imports=await listCrmImports(c.env.smart_menu_db,workspaceIdOf(c)),item=imports.find((x:any)=>x.importReference===c.req.param('importReference'));return item?c.json({success:true,import:item}):c.json({success:false,error:'NOT_FOUND'},404);}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'CRM_IMPORT_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/crm/imports/:importReference/rows/:rowReference/resolve',async c=>{try{requireRole(c,'admin');const body:any=await c.req.json().catch(()=>({})),resolution=text(body.resolution,40);if(!['CREATE_PERSON','LINK_EXISTING','REJECT'].includes(resolution))return c.json({success:false,error:'CRM_IMPORT_RESOLUTION_INVALID'},400);return c.json({success:true,result:await resolveCrmImportRow(c.env.smart_menu_db,{workspaceId:workspaceIdOf(c),importReference:c.req.param('importReference'),rowReference:c.req.param('rowReference'),resolution:resolution as any,targetPersonReference:text(body.targetPersonReference,100),userId:text(c.get('userId'))||null})});}catch(e:any){const code=String(e?.message||'');const known=['CRM_IMPORT_ROW_NOT_FOUND','CRM_IMPORT_REVIEW_REQUIRED','CRM_PERSON_NOT_FOUND','MERGE_REVIEW_REQUIRED','FIELD_AUTHORITY_CONFLICT'];return c.json({success:false,error:known.includes(code)?code:'CRM_IMPORT_RESOLVE_FAILED'},known.includes(code)?409:500)}});

async function ownCrmCardMember(c:any){const verified=await verifiedReferralMember(c,{lineAccountId:text(c.req.query('lineAccountId')),liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\\s+/i,'')});return {verified,person:await ownPerson(c.env.smart_menu_db,verified.account.workspace_id,verified.account.id,verified.memberId)}}
app.get('/api/member/personal-card',async c=>{try{const x=await ownCrmCardMember(c);return c.json({success:true,card:publicCard(await ownCard(c.env.smart_menu_db,x.verified.account.workspace_id,x.person.id))});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.post('/api/member/personal-card',async c=>{try{const x=await ownCrmCardMember(c),body:any=await c.req.json();return c.json({success:true,card:publicCard(await createOrVersion(c.env.smart_menu_db,{workspaceId:x.verified.account.workspace_id,personId:x.person.id,patch:body.card||body}))},201);}catch{return c.json({success:false,error:'PERSONAL_CARD_CREATE_FAILED'},400)}});
app.post('/api/member/personal-card/version',async c=>{try{const x=await ownCrmCardMember(c),body:any=await c.req.json();return c.json({success:true,card:publicCard(await createOrVersion(c.env.smart_menu_db,{workspaceId:x.verified.account.workspace_id,personId:x.person.id,patch:body.card||body}))});}catch{return c.json({success:false,error:'PERSONAL_CARD_VERSION_FAILED'},400)}});
app.post('/api/member/personal-card/status',async c=>{try{const x=await ownCrmCardMember(c),body:any=await c.req.json();return c.json({success:true,card:publicCard(await setCardStatus(c.env.smart_menu_db,x.verified.account.workspace_id,x.person.id,text(body.status,20)))});}catch{return c.json({success:false,error:'PERSONAL_CARD_STATUS_FAILED'},400)}});
app.post('/api/member/personal-card/share',async c=>{try{const x=await ownCrmCardMember(c),body:any=await c.req.json().catch(()=>({}));return c.json({success:true,share:await createShare(c.env.smart_menu_db,x.verified.account.workspace_id,x.person.id,text(body.expiresAt,40)||undefined)});}catch{return c.json({success:false,error:'PERSONAL_CARD_SHARE_FAILED'},400)}});
app.get('/api/public/cards/:shareToken',async c=>{try{return c.json({success:true,card:await publicShare(c.env.smart_menu_db,c.req.param('shareToken'))});}catch{return c.json({success:false,error:'CARD_SHARE_UNAVAILABLE'},404)}});
app.post('/api/member/personal-card/share/revoke',async c=>{try{const x=await ownCrmCardMember(c),b:any=await c.req.json();return c.json({success:true,result:await revokeShare(c.env.smart_menu_db,x.verified.account.workspace_id,x.person.id,text(b.revokeHandle,100))});}catch{return c.json({success:false,error:'CARD_SHARE_REVOKE_FAILED'},400)}});
app.get('/api/member/card-collection',async c=>{try{const x=await ownCrmCardMember(c);return c.json({success:true,collections:await ownCollection(c.env.smart_menu_db,x.verified.account.workspace_id,x.person.id)});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.post('/api/member/card-collection',async c=>{try{const x=await ownCrmCardMember(c),b:any=await c.req.json();return c.json({success:true,result:await collectShare(c.env.smart_menu_db,x.verified.account.workspace_id,x.person.id,text(b.shareToken,200),text(b.privateNote,4000))});}catch(e:any){return c.json({success:false,error:String(e?.message||'CARD_COLLECTION_FAILED')},400)}});
app.post('/api/crm/people/:personReference/business-cards',async c=>{try{requireRole(c,'editor');const w=workspaceIdOf(c),p:any=await crmPersonByReference(c.env.smart_menu_db,{workspaceId:w,publicRef:c.req.param('personReference')});if(!p)return c.json({success:false,error:'NOT_FOUND'},404);const b:any=await c.req.json();return c.json({success:true,result:await createBusinessCard(c.env.smart_menu_db,{workspaceId:w,personId:p.id,data:b.card||b,sourceType:'MANUAL'})},201);}catch{return c.json({success:false,error:'CRM_BUSINESS_CARD_CREATE_FAILED'},400)}});
app.post('/api/crm/people/:personReference/assignment',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),person:any=await crmPersonByReference(c.env.smart_menu_db,{workspaceId,publicRef:c.req.param('personReference')});if(!person)return c.json({success:false,error:'NOT_FOUND'},404);const body:any=await c.req.json(),token=text(body.assignedUserReference);if(!token)return c.json({success:false,error:'CRM_ASSIGNEE_REFERENCE_REQUIRED'},400);let verified:any;try{verified=await verifyAssigneeHandle(text(c.env.CRM_ASSIGNEE_HANDLE_SECRET),token)}catch(e:any){const code=String(e?.message||'');return c.json({success:false,error:code==='CRM_ASSIGNEE_HANDLE_EXPIRED'?'CRM_ASSIGNEE_REFERENCE_EXPIRED':'CRM_ASSIGNEE_REFERENCE_INVALID'},400)}const candidates:any[]=await crmAssignableUsers(c.env.smart_menu_db,workspaceId),matched=[] as any[];for(const candidate of candidates)if(await assigneeReference(text(c.env.CRM_ASSIGNEE_HANDLE_SECRET),workspaceId,candidate.id)===verified.reference)matched.push(candidate);if(matched.length!==1)return c.json({success:false,error:'CRM_ASSIGNEE_NOT_ELIGIBLE'},400);return c.json({success:true,result:await assignCrmOwner(c.env.smart_menu_db,{workspaceId,personId:person.id,assignedUserId:matched[0].id,assignedByUserId:text(c.get('userId'))||null,reason:text(body.reason,500)})});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'CRM_ASSIGNMENT_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:400)}});
app.get('/api/crm/people/:safePersonReference/cards',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),person:any=await crmPersonByReference(c.env.smart_menu_db,{workspaceId,publicRef:text(c.req.param('safePersonReference'),80)});if(!person)return c.json({success:false,error:'NOT_FOUND'},404);const db=c.env.smart_menu_db;const personal:any[]=(await db.prepare(`SELECT c.status,c.updated_at,v.version_no,v.display_name,v.company_name,v.job_title FROM crm_personal_cards c LEFT JOIN crm_personal_card_versions v ON v.personal_card_id=c.id AND v.version_no=c.current_version_no WHERE c.workspace_id=? AND c.crm_person_id=? ORDER BY c.updated_at DESC`).bind(workspaceId,person.id).all()).results||[];const business:any[]=(await db.prepare(`SELECT display_name,company_name,department,job_title,source_type,captured_at,archived_at FROM crm_business_cards WHERE workspace_id=? AND crm_person_id=? ORDER BY captured_at DESC,created_at DESC`).bind(workspaceId,person.id).all()).results||[];return c.json({success:true,personalCards:personal.map(x=>({status:x.status,versionNo:Number(x.version_no||0),displayName:x.display_name||'',companyName:x.company_name||'',jobTitle:x.job_title||'',updatedAt:x.updated_at})),businessCards:business.map(x=>({displayName:x.display_name||'',companyName:x.company_name||'',department:x.department||'',jobTitle:x.job_title||'',sourceType:x.source_type,capturedAt:x.captured_at||null,archived:Boolean(x.archived_at)}))});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'CRM_CARD_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
async function crmAssignableUsers(db:any,workspaceId:string){return ((await db.prepare(`SELECT id,display_name,role,status FROM users WHERE workspace_id=? AND (status IS NULL OR status IN ('active','ACTIVE')) ORDER BY display_name ASC,id ASC`).bind(workspaceId).all()).results||[])}
app.get('/api/crm/assignees',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),secret=text(c.env.CRM_ASSIGNEE_HANDLE_SECRET),users:any[]=await crmAssignableUsers(c.env.smart_menu_db,workspaceId);return c.json({success:true,assignees:await Promise.all(users.map(async u=>({assignedUserReference:await createAssigneeHandle(secret,workspaceId,u.id),displayLabel:text(u.display_name,120)||'Workspace user',roleLabel:text(u.role,40)||null})))});}catch(e:any){return c.json({success:false,error:e?.message==='CRM_ASSIGNEE_HANDLE_SECRET_MISSING'?'CRM_ASSIGNEE_HANDLE_UNAVAILABLE':'CRM_ASSIGNEE_LIST_FAILED'},500)}});
export default app;
registerCrmInsightRoutes(app,{requireRole,workspaceIdOf,crmPersonByReference,text,crmRouteError,verifiedReferralMember,ensureCrmPersonForVerifiedMember});
registerCrmPipelineRoutes(app,{requireRole,workspaceIdOf,crmPersonByReference,text,assignmentSummary,crmAssignableUsers});
registerCrmTimelineRoutes(app,{requireRole,workspaceIdOf,crmPersonByReference,text});
registerCrmSegmentRoutes(app,{requireRole,workspaceIdOf,text});
registerCampaignAudienceRoutes(app,{requireRole,workspaceIdOf,text});
registerCampaignExecutionRoutes(app,{requireRole,workspaceIdOf,text});
registerCampaignRoutes(app,{requireRole,workspaceIdOf,text});
registerCommerceRoutes(app,{requireRole,workspaceIdOf,text});
app.post('/api/system/workspaces/:workspaceId/line-simulator', async (c) => {
  try {
    await requireSystemAdmin(c);
    const workspaceId = text(c.req.param('workspaceId'));
    const body: any = await c.req.json();
    const message = text(body.message);
    const mode = text(body.mode || 'routing').toLowerCase();
    if (!message) return c.json({ success:false, error:'請輸入模擬訊息。' },400);
    if (!['routing','webhook'].includes(mode)) return c.json({ success:false, error:'不支援的測試模式。' },400);

    const started = Date.now();
    const r = await runLineSimulation(c.env, workspaceId, message);
    const target = r.target;
    const result:any = {
      success:true, simulation:true, mode, message,
      routing:{
        keyword:r.route?.keyword || null,
        matchType:r.route?.match_type || null,
        target:target ? {
          id:target.id, name:target.name,
          system:Number(target.position)===1?'System A':'System B',
          enabled:Boolean(target.enabled),
          endpointUrl:target.endpoint_url || null
        }:null,
        conflictDetected:r.matches.length > 1,
        matchingRouteCount:r.matches.length,
        skippedTargets:r.targets.filter((t:any)=>!target || t.id!==target.id).map((t:any)=>t.name)
      },
      downstream:null, replyPreview:null, elapsedMs:Date.now()-started
    };

    if (mode === 'routing') return c.json(result,200);
    if (!target?.endpoint_url) {
      result.downstream={attempted:false,ok:false,reason:'NO_ENDPOINT'};
      return c.json(result,200);
    }
    if (!Boolean(target.enabled)) {
      result.downstream={attempted:false,ok:false,reason:'TARGET_DISABLED'};
      return c.json(result,200);
    }

    const t0=Date.now();
    try {
      const resp=await fetch(target.endpoint_url,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'X-Smart-Menu-Simulation':'true',
          'X-Smart-Menu-Dry-Run':'true',
          'X-Smart-Menu-Workspace':workspaceId
        },
        body:JSON.stringify({
          action:'LINE_WEBHOOK_SIMULATION',
          simulation:true, dryRun:true, workspaceId,
          targetId:target.id, targetName:target.name,
          matchedKeyword:r.route?.keyword || null,
          payload:{events:[{
            type:'message',
            replyToken:'SIMULATION_REPLY_TOKEN',
            source:{type:'user',userId:'SIMULATOR_USER'},
            message:{id:`sim_${Date.now()}`,type:'text',text:message}
          }]}
        })
      });
      const raw=await resp.text();
      let parsed:any=null;
      try { parsed=raw?JSON.parse(raw):null; } catch { parsed=raw || null; }
      result.downstream={attempted:true,ok:resp.ok,status:resp.status,elapsedMs:Date.now()-t0,response:parsed};
      result.replyPreview=parsed?.replyPayload || parsed?.data?.replyPayload || parsed?.reply || null;
    } catch(e:any) {
      result.downstream={attempted:true,ok:false,reason:'FORWARD_FAILED',error:e?.message || 'Webhook 測試失敗'};
    }
    result.elapsedMs=Date.now()-started;
    return c.json(result,200);
  } catch(e:any) {
    if(e?.message==='SYSTEM_ADMIN_REQUIRED') return c.json({success:false,error:'需要系統管理員權限。'},403);
    return c.json({success:false,error:e?.message || 'LINE 模擬器失敗'},500);
  }
});
async function recordDealerStatusEvent(db:D1Database,input:{workspaceId:string;lineAccountId:string;dealerId:string;fromStatus:string|null;toStatus:string;actorType:'MEMBER'|'TENANT_ADMIN';actorUserId?:string|null;reasonCode?:string|null}){await db.prepare('INSERT INTO dealer_status_events(id,workspace_id,line_account_id,dealer_id,from_status,to_status,actor_type,actor_user_id,reason_code) VALUES(?,?,?,?,?,?,?,?,?)').bind(id('dse'),input.workspaceId,input.lineAccountId,input.dealerId,input.fromStatus,input.toStatus,input.actorType,input.actorUserId||null,input.reasonCode||null).run();}
app.get('/api/member/dealer-status',async c=>{try{const verified=await verifiedReferralMember(c,{lineAccountId:text(c.req.query('lineAccountId')),liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')});const dealer:any=await c.env.smart_menu_db.prepare('SELECT id,status,applied_at,approved_at,suspended_at,rejected_at,created_at,updated_at FROM line_oa_dealers WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1').bind(verified.account.workspace_id,verified.account.id,verified.memberId).first();return c.json({success:true,enrolled:Boolean(dealer),status:dealer?.status||'NONE',dealer:dealer?publicDealerRow(dealer,0):null});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.post('/api/member/dealer/apply',async c=>{try{const body:any=await c.req.json(),verified=await verifiedReferralMember(c,body),db=c.env.smart_menu_db,workspaceId=verified.account.workspace_id,lineAccountId=verified.account.id;let dealer:any=await db.prepare('SELECT * FROM line_oa_dealers WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1').bind(workspaceId,lineAccountId,verified.memberId).first();const decision=dealerApplyDecision(dealer?.status||null);if(decision==='SUSPENDED_BLOCKED')return c.json({success:false,error:'DEALER_SUSPENDED',status:'SUSPENDED'},409);if(decision==='CREATE_PENDING'){const dealerId=id('dealer');try{await db.prepare('INSERT INTO line_oa_dealers(id,workspace_id,line_account_id,member_id,status) VALUES(?,?,?,?,?)').bind(dealerId,workspaceId,lineAccountId,verified.memberId,'PENDING').run();dealer=await db.prepare('SELECT * FROM line_oa_dealers WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(dealerId,workspaceId,lineAccountId).first();await recordDealerStatusEvent(db,{workspaceId,lineAccountId,dealerId,fromStatus:null,toStatus:'PENDING',actorType:'MEMBER'});}catch{dealer=await db.prepare('SELECT * FROM line_oa_dealers WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1').bind(workspaceId,lineAccountId,verified.memberId).first();}}else if(decision==='REAPPLY_PENDING'){await db.prepare("UPDATE line_oa_dealers SET status='PENDING',applied_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND line_account_id=? AND status='REJECTED'").bind(dealer.id,workspaceId,lineAccountId).run();await recordDealerStatusEvent(db,{workspaceId,lineAccountId,dealerId:dealer.id,fromStatus:'REJECTED',toStatus:'PENDING',actorType:'MEMBER'});dealer=await db.prepare('SELECT * FROM line_oa_dealers WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(dealer.id,workspaceId,lineAccountId).first();}if(!dealer)throw new Error('DEALER_APPLY_FAILED');return c.json({success:true,status:dealer.status,dealer:publicDealerRow(dealer,0),idempotent:decision==='IDEMPOTENT'});}catch(e:any){return c.json({success:false,error:e?.message==='CONFIG_NOT_READY'?'CONFIG_NOT_READY':'MEMBER_CONTEXT_REQUIRED'},401)}});
app.get('/api/dealers',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),status=text(c.req.query('status'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(status&&!isDealerStatus(status))return c.json({success:false,error:'INVALID_STATUS_FILTER'},400);const account:any=await c.env.smart_menu_db.prepare('SELECT id FROM workspace_line_accounts WHERE id=? AND workspace_id=? LIMIT 1').bind(lineAccountId,workspaceId).first();if(!account)return c.json({success:false,error:'NOT_FOUND'},404);const rows:any[]=(await c.env.smart_menu_db.prepare(`SELECT id,status,applied_at,approved_at,suspended_at,rejected_at,created_at,updated_at FROM line_oa_dealers WHERE workspace_id=? AND line_account_id=? ${status?'AND status=?':''} ORDER BY applied_at DESC,id DESC`).bind(...(status?[workspaceId,lineAccountId,status]:[workspaceId,lineAccountId])).all()).results||[];return c.json({success:true,dealers:rows.map((row,index)=>publicDealerRow(row,index))});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'DEALER_LIST_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/dealers/:dealerId/status',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),body:any=await c.req.json(),next=text(body.status);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!isDealerStatus(next))return c.json({success:false,error:'INVALID_DEALER_STATUS'},400);const dealer:any=await c.env.smart_menu_db.prepare('SELECT * FROM line_oa_dealers WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(c.req.param('dealerId'),workspaceId,lineAccountId).first();if(!dealer)return c.json({success:false,error:'NOT_FOUND'},404);if(!isDealerStatus(dealer.status)||!canTenantTransitionDealerStatus(dealer.status,next))return c.json({success:false,error:'INVALID_DEALER_TRANSITION'},409);await c.env.smart_menu_db.prepare("UPDATE line_oa_dealers SET status=?,approved_at=CASE WHEN ?='ACTIVE' THEN COALESCE(approved_at,CURRENT_TIMESTAMP) ELSE approved_at END,suspended_at=CASE WHEN ?='SUSPENDED' THEN CURRENT_TIMESTAMP ELSE suspended_at END,rejected_at=CASE WHEN ?='REJECTED' THEN CURRENT_TIMESTAMP ELSE rejected_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND line_account_id=? AND status=?").bind(next,next,next,next,dealer.id,workspaceId,lineAccountId,dealer.status).run();await recordDealerStatusEvent(c.env.smart_menu_db,{workspaceId,lineAccountId,dealerId:dealer.id,fromStatus:dealer.status,toStatus:next,actorType:'TENANT_ADMIN',actorUserId:text(c.get('userId'))||null});const updated:any=await c.env.smart_menu_db.prepare('SELECT id,status,applied_at,approved_at,suspended_at,rejected_at,created_at,updated_at FROM line_oa_dealers WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(dealer.id,workspaceId,lineAccountId).first();return c.json({success:true,dealer:publicDealerRow(updated,0)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'DEALER_STATUS_UPDATE_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});

async function recordCommissionProgramStatusEvent(db:D1Database,input:{workspaceId:string;lineAccountId:string;programId:string;fromStatus:string|null;toStatus:string;actorUserId?:string|null}){await db.prepare('INSERT INTO commission_program_status_events(id,workspace_id,line_account_id,program_id,from_status,to_status,actor_user_id) VALUES(?,?,?,?,?,?,?)').bind(id('cpse'),input.workspaceId,input.lineAccountId,input.programId,input.fromStatus,input.toStatus,input.actorUserId||null).run();}
async function recordCommissionProgramDealerStatusEvent(db:D1Database,input:{workspaceId:string;lineAccountId:string;programId:string;dealerId:string;fromStatus:string|null;toStatus:string;actorUserId?:string|null}){await db.prepare('INSERT INTO commission_program_dealer_status_events(id,workspace_id,line_account_id,program_id,dealer_id,from_status,to_status,actor_user_id) VALUES(?,?,?,?,?,?,?,?)').bind(id('cpdse'),input.workspaceId,input.lineAccountId,input.programId,input.dealerId,input.fromStatus,input.toStatus,input.actorUserId||null).run();}
async function commissionProgramAccount(db:D1Database,workspaceId:string,lineAccountId:string){return await db.prepare('SELECT id FROM workspace_line_accounts WHERE id=? AND workspace_id=? LIMIT 1').bind(lineAccountId,workspaceId).first<any>();}
async function scopedCommissionProgram(db:D1Database,workspaceId:string,lineAccountId:string,programId:string){return await db.prepare('SELECT * FROM commission_programs WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(programId,workspaceId,lineAccountId).first<any>();}
app.get('/api/commission-programs',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await commissionProgramAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const rows:any[]=(await c.env.smart_menu_db.prepare('SELECT id,name,status,attribution_window_days,created_at,updated_at FROM commission_programs WHERE workspace_id=? AND line_account_id=? ORDER BY created_at DESC,id DESC').bind(workspaceId,lineAccountId).all()).results||[];return c.json({success:true,programs:rows.map(publicCommissionProgramRow)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_PROGRAM_LIST_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/commission-programs',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json(),lineAccountId=text(body.lineAccountId),name=text(body.name,120),window=Number(body.attributionWindowDays);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!name)return c.json({success:false,error:'PROGRAM_NAME_REQUIRED'},400);if(!isAttributionWindowDays(window))return c.json({success:false,error:'INVALID_ATTRIBUTION_WINDOW'},400);if(!await commissionProgramAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const programId=id('cprog');await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare('INSERT INTO commission_programs(id,workspace_id,line_account_id,name,status,attribution_window_days,created_by_user_id) VALUES(?,?,?,?,?,?,?)').bind(programId,workspaceId,lineAccountId,name,'DRAFT',window,text(c.get('userId'))||null),c.env.smart_menu_db.prepare('INSERT INTO commission_program_status_events(id,workspace_id,line_account_id,program_id,from_status,to_status,actor_user_id) VALUES(?,?,?,?,?,?,?)').bind(id('cpse'),workspaceId,lineAccountId,programId,null,'DRAFT',text(c.get('userId'))||null)]);const program:any=await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,programId);return c.json({success:true,program:publicCommissionProgramRow(program)},201);}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_PROGRAM_CREATE_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/commission-programs/:programId/rules',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);const program:any=await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,c.req.param('programId'));if(!program)return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,rules:await listCommissionRuleVersions(c.env.smart_menu_db,{workspaceId,lineAccountId,programId:program.id})});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_RULE_LIST_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/commission-programs/:programId/rules',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json(),lineAccountId=text(body.lineAccountId);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);const program:any=await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,c.req.param('programId'));if(!program)return c.json({success:false,error:'NOT_FOUND'},404);const rule=await createCommissionRuleVersion(c.env.smart_menu_db,{workspaceId,lineAccountId,programId:program.id,calculationType:body.calculationType,fixedAmountMinor:body.fixedAmountMinor,currencyCode:text(body.currencyCode),createdByUserId:text(c.get('userId'))||null});return c.json({success:true,rule},201);}catch(e:any){const code=String(e?.message||'');return c.json({success:false,error:code==='FORBIDDEN_ROLE'?'FORBIDDEN':code==='UNSUPPORTED_COMMISSION_CALCULATION_TYPE'||code==='INVALID_FIXED_COMMISSION_AMOUNT'||code==='UNSUPPORTED_COMMISSION_CURRENCY'?code:'COMMISSION_RULE_CREATE_FAILED'},code==='FORBIDDEN_ROLE'?403:code==='UNSUPPORTED_COMMISSION_CALCULATION_TYPE'||code==='INVALID_FIXED_COMMISSION_AMOUNT'||code==='UNSUPPORTED_COMMISSION_CURRENCY'?400:500)}});
app.post('/api/commission-programs/:programId/status',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),body:any=await c.req.json(),next=text(body.status);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!isCommissionProgramStatus(next))return c.json({success:false,error:'INVALID_PROGRAM_STATUS'},400);const program:any=await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,c.req.param('programId'));if(!program)return c.json({success:false,error:'NOT_FOUND'},404);if(program.status===next)return c.json({success:true,program:publicCommissionProgramRow(program),idempotent:true});if(!isCommissionProgramStatus(program.status)||!canTransitionCommissionProgramStatus(program.status,next))return c.json({success:false,error:'INVALID_PROGRAM_TRANSITION'},409);try{await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare('UPDATE commission_programs SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND line_account_id=? AND status=?').bind(next,program.id,workspaceId,lineAccountId,program.status),c.env.smart_menu_db.prepare('INSERT INTO commission_program_status_events(id,workspace_id,line_account_id,program_id,from_status,to_status,actor_user_id) VALUES(?,?,?,?,?,?,?)').bind(id('cpse'),workspaceId,lineAccountId,program.id,program.status,next,text(c.get('userId'))||null)]);}catch{if(next==='ACTIVE')return c.json({success:false,error:'ACTIVE_PROGRAM_EXISTS'},409);throw new Error('PROGRAM_STATUS_UPDATE_FAILED');}const updated:any=await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,program.id);return c.json({success:true,program:publicCommissionProgramRow(updated)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_PROGRAM_STATUS_UPDATE_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/commission-programs/:programId/dealers',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);const program:any=await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,c.req.param('programId'));if(!program)return c.json({success:false,error:'NOT_FOUND'},404);const rows:any[]=(await c.env.smart_menu_db.prepare('SELECT e.dealer_id,e.status eligibility_status,e.eligible_at,e.disabled_at,d.status dealer_status FROM commission_program_dealers e JOIN line_oa_dealers d ON d.id=e.dealer_id AND d.workspace_id=e.workspace_id AND d.line_account_id=e.line_account_id WHERE e.workspace_id=? AND e.line_account_id=? AND e.program_id=? ORDER BY e.created_at ASC,e.id ASC').bind(workspaceId,lineAccountId,program.id).all()).results||[];return c.json({success:true,dealers:rows.map(publicCommissionProgramDealerRow)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_PROGRAM_DEALER_LIST_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/commission-programs/:programId/dealers',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),body:any=await c.req.json(),lineAccountId=text(body.lineAccountId),dealerId=text(body.dealerId);if(!lineAccountId||!dealerId)return c.json({success:false,error:'LINE_ACCOUNT_AND_DEALER_REQUIRED'},400);const program:any=await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,c.req.param('programId'));if(!program)return c.json({success:false,error:'NOT_FOUND'},404);const dealer:any=await c.env.smart_menu_db.prepare('SELECT id,status FROM line_oa_dealers WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(dealerId,workspaceId,lineAccountId).first();if(!dealer)return c.json({success:false,error:'DEALER_NOT_FOUND'},404);if(dealer.status!=='ACTIVE')return c.json({success:false,error:'DEALER_NOT_ACTIVE'},409);let eligibility:any=await c.env.smart_menu_db.prepare('SELECT * FROM commission_program_dealers WHERE program_id=? AND dealer_id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(program.id,dealer.id,workspaceId,lineAccountId).first();if(eligibility)return c.json({success:true,eligibilityStatus:eligibility.status,idempotent:true});const eligibilityId=id('cpd');try{await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare('INSERT INTO commission_program_dealers(id,workspace_id,line_account_id,program_id,dealer_id,status) VALUES(?,?,?,?,?,?)').bind(eligibilityId,workspaceId,lineAccountId,program.id,dealer.id,'ELIGIBLE'),c.env.smart_menu_db.prepare('INSERT INTO commission_program_dealer_status_events(id,workspace_id,line_account_id,program_id,dealer_id,from_status,to_status,actor_user_id) VALUES(?,?,?,?,?,?,?,?)').bind(id('cpdse'),workspaceId,lineAccountId,program.id,dealer.id,null,'ELIGIBLE',text(c.get('userId'))||null)]);}catch{eligibility=await c.env.smart_menu_db.prepare('SELECT * FROM commission_program_dealers WHERE program_id=? AND dealer_id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(program.id,dealer.id,workspaceId,lineAccountId).first();if(eligibility)return c.json({success:true,eligibilityStatus:eligibility.status,idempotent:true});throw new Error('DEALER_ENROLL_FAILED');}return c.json({success:true,eligibilityStatus:'ELIGIBLE'} ,201);}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_PROGRAM_DEALER_ENROLL_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/commission-programs/:programId/dealers/:dealerId/status',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),body:any=await c.req.json(),next=text(body.status);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!isDealerEligibilityStatus(next))return c.json({success:false,error:'INVALID_ELIGIBILITY_STATUS'},400);const program:any=await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,c.req.param('programId'));if(!program)return c.json({success:false,error:'NOT_FOUND'},404);const eligibility:any=await c.env.smart_menu_db.prepare('SELECT e.*,d.status dealer_status FROM commission_program_dealers e JOIN line_oa_dealers d ON d.id=e.dealer_id AND d.workspace_id=e.workspace_id AND d.line_account_id=e.line_account_id WHERE e.program_id=? AND e.dealer_id=? AND e.workspace_id=? AND e.line_account_id=? LIMIT 1').bind(program.id,c.req.param('dealerId'),workspaceId,lineAccountId).first();if(!eligibility)return c.json({success:false,error:'NOT_FOUND'},404);if(eligibility.status===next)return c.json({success:true,eligibilityStatus:eligibility.status,idempotent:true});if(eligibility.status!=='ELIGIBLE'&&eligibility.status!=='DISABLED')return c.json({success:false,error:'INVALID_ELIGIBILITY_TRANSITION'},409);if(next==='ELIGIBLE'&&eligibility.dealer_status!=='ACTIVE')return c.json({success:false,error:'DEALER_NOT_ACTIVE'},409);await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare("UPDATE commission_program_dealers SET status=?,eligible_at=CASE WHEN ?='ELIGIBLE' THEN CURRENT_TIMESTAMP ELSE eligible_at END,disabled_at=CASE WHEN ?='DISABLED' THEN CURRENT_TIMESTAMP ELSE disabled_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND line_account_id=? AND status=?").bind(next,next,next,eligibility.id,workspaceId,lineAccountId,eligibility.status),c.env.smart_menu_db.prepare('INSERT INTO commission_program_dealer_status_events(id,workspace_id,line_account_id,program_id,dealer_id,from_status,to_status,actor_user_id) VALUES(?,?,?,?,?,?,?,?)').bind(id('cpdse'),workspaceId,lineAccountId,program.id,eligibility.dealer_id,eligibility.status,next,text(c.get('userId'))||null)]);return c.json({success:true,eligibilityStatus:next});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_PROGRAM_DEALER_STATUS_UPDATE_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});

async function resolvedDealerPayoutContext(c:any) { const verified=await verifiedDealerLedgerMember(c); if(!verified.memberId)return {verified,dealer:null}; const dealer:any=await c.env.smart_menu_db.prepare(`SELECT id,status FROM line_oa_dealers WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1`).bind(verified.account.workspace_id,verified.account.id,verified.memberId).first(); return {verified,dealer}; }

const dealerPayoutHandleScope = (context: any) => ({ workspaceId: context.verified.account.workspace_id, lineAccountId: context.verified.account.id, dealerId: context.dealer.id });
async function publicDealerPayoutRequestWithHandle(secret: string, scope: { workspaceId: string; lineAccountId: string; dealerId: string }, row: any) {
  return { ...publicDealerPayoutRequestRow(row), payoutRequestHandle: await createDealerPayoutRequestHandle(secret, { ...scope, payoutRequestId: text(row.id, 120) }) };
}
async function dealerPayoutRequestForHandle(db: D1Database, secret: string, scope: { workspaceId: string; lineAccountId: string; dealerId: string }, payoutRequestHandle: string) {
  const handle = await verifyDealerPayoutRequestHandle(secret, payoutRequestHandle);
  const rows: any[] = (await db.prepare(`SELECT id,settlement_id,status,amount_minor,currency_code,requested_at,reviewed_at,rejection_reason_code FROM commission_payout_requests WHERE workspace_id=? AND line_account_id=? AND dealer_id=? ORDER BY requested_at DESC,id DESC`).bind(scope.workspaceId, scope.lineAccountId, scope.dealerId).all()).results || [];
  for (const row of rows) if ((await dealerPayoutRequestHandleReference(secret, { ...scope, payoutRequestId: text(row.id, 120) })) === handle.reference) return row;
  throw new Error('DEALER_PAYOUT_REQUEST_HANDLE_INVALID');
}

app.get('/api/member/dealer/settlements',async c=>{try{const context=await resolvedDealerPayoutContext(c);const days=commissionLedgerPeriod(c.req.query('period'));if(!context.dealer)return c.json({success:true,status:'NOT_ENROLLED',period:{days,from:null,to:null},summary:{settlementCount:0,earnedByCurrency:[],itemCount:0},settlements:[]});const to=new Date(),from=new Date(to.getTime()-days*86400000),scope={workspaceId:context.verified.account.workspace_id,lineAccountId:context.verified.account.id,dealerId:context.dealer.id,from:from.toISOString()},rows=await dealerFinalizedSettlementRows(c.env.smart_menu_db,scope),secret=text(c.env.MEMBER_IDENTITY_HMAC_SECRET),settlements=await Promise.all(rows.map(async row=>publicDealerSettlementRow({...row,settlementHandle:await createDealerSettlementHandle(secret,{workspaceId:scope.workspaceId,lineAccountId:scope.lineAccountId,dealerId:scope.dealerId,settlementId:row.settlementId})}))),earnedByCurrency=Object.values(rows.reduce((out:any,row)=>{const current=out[row.currencyCode]||{currencyCode:row.currencyCode,amountMinor:0};current.amountMinor+=row.amountMinor;out[row.currencyCode]=current;return out},{}));return c.json({success:true,status:'ENROLLED',period:{days,from:from.toISOString(),to:to.toISOString()},summary:{settlementCount:settlements.length,earnedByCurrency,itemCount:rows.reduce((total,row)=>total+row.entryCount,0)},settlements});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.get('/api/member/dealer/payment-status',async c=>{try{const context=await resolvedDealerPayoutContext(c);if(!context.dealer)return c.json({success:true,status:'NOT_ENROLLED',payments:[]});const scope=context.verified.account,rows:any[]=(await c.env.smart_menu_db.prepare(`SELECT r.id payout_request_id,r.status payout_request_status,r.amount_minor,r.currency_code,a.status payment_status FROM commission_payout_requests r LEFT JOIN commission_payment_attempts a ON a.id=(SELECT id FROM commission_payment_attempts WHERE payout_request_id=r.id ORDER BY attempt_no DESC LIMIT 1) WHERE r.workspace_id=? AND r.line_account_id=? AND r.dealer_id=? ORDER BY r.requested_at DESC,r.id DESC`).bind(scope.workspace_id,scope.id,context.dealer.id).all()).results||[];return c.json({success:true,status:'ENROLLED',payments:rows.map(publicDealerPaymentStatusRow)});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.get('/api/commission-payment-attempts',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),payoutRequestId=text(c.req.query('payoutRequestId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await commissionProgramAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const rows:any[]=(await c.env.smart_menu_db.prepare(`SELECT id,payout_request_id,attempt_no,provider_code,status,amount_minor,currency_code,failure_reason_code,started_at,completed_at FROM commission_payment_attempts WHERE workspace_id=? AND line_account_id=? ${payoutRequestId?'AND payout_request_id=?':''} ORDER BY created_at DESC,attempt_no DESC`).bind(...(payoutRequestId?[workspaceId,lineAccountId,payoutRequestId]:[workspaceId,lineAccountId])).all()).results||[];return c.json({success:true,attempts:rows.map(publicPaymentAttemptRow)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'PAYMENT_ATTEMPT_LIST_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/commission-payment-attempts/:attemptId',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);const row:any=await c.env.smart_menu_db.prepare(`SELECT id,payout_request_id,attempt_no,provider_code,status,amount_minor,currency_code,failure_reason_code,started_at,completed_at FROM commission_payment_attempts WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(c.req.param('attemptId'),workspaceId,lineAccountId).first();if(!row)return c.json({success:false,error:'NOT_FOUND'},404);const events:any[]=(await c.env.smart_menu_db.prepare(`SELECT from_status,to_status,occurred_at,reason_code FROM commission_payment_attempt_status_events WHERE payment_attempt_id=? ORDER BY occurred_at ASC,id ASC`).bind(row.id).all()).results||[];const transaction:any=await c.env.smart_menu_db.prepare(`SELECT status,confirmed_at FROM commission_payment_transactions WHERE payment_attempt_id=? LIMIT 1`).bind(row.id).first();return c.json({success:true,attempt:publicPaymentAttemptRow(row),statusHistory:events.map(x=>({fromStatus:x.from_status||null,toStatus:x.to_status,occurredAt:x.occurred_at,reasonCode:x.reason_code||null})),transaction:transaction?{status:transaction.status,confirmedAt:transaction.confirmed_at,executionMode:'SIMULATED'}:null});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'PAYMENT_ATTEMPT_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/commission-payout-requests/:requestId/execute',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),body:any=await c.req.json().catch(()=>({})),key=text(body.idempotencyKey,256),outcome=text(body.simulationOutcome);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!key)return c.json({success:false,error:'IDEMPOTENCY_KEY_REQUIRED'},400);if(outcome&&outcome!=='SUCCEEDED'&&outcome!=='FAILED')return c.json({success:false,error:'INVALID_SIMULATION_OUTCOME'},400);const payout:any=await c.env.smart_menu_db.prepare(`SELECT id,status,amount_minor,currency_code FROM commission_payout_requests WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(c.req.param('requestId'),workspaceId,lineAccountId).first();if(!payout)return c.json({success:false,error:'NOT_FOUND'},404);if(payout.status!=='APPROVED')return c.json({success:false,error:'PAYOUT_REQUEST_NOT_APPROVED'},409);const hash=await paymentIdempotencyKeyHash({workspaceId,lineAccountId,payoutRequestId:payout.id,key});const same:any=await c.env.smart_menu_db.prepare(`SELECT id,payout_request_id,attempt_no,provider_code,status,amount_minor,currency_code,failure_reason_code,started_at,completed_at FROM commission_payment_attempts WHERE payout_request_id=? AND idempotency_key_hash=? LIMIT 1`).bind(payout.id,hash).first();if(same)return c.json({success:true,idempotent:true,attempt:publicPaymentAttemptRow(same)});const succeeded:any=await c.env.smart_menu_db.prepare(`SELECT id FROM commission_payment_transactions WHERE payout_request_id=? LIMIT 1`).bind(payout.id).first();if(succeeded)return c.json({success:false,error:'PAYMENT_ALREADY_SUCCEEDED'},409);const previous:any=await c.env.smart_menu_db.prepare(`SELECT COALESCE(MAX(attempt_no),0) attempt_no FROM commission_payment_attempts WHERE payout_request_id=?`).bind(payout.id).first(),attemptNo=Number(previous?.attempt_no||0)+1,attemptId=id('cpa'),now=new Date().toISOString();const providerResult=await internalTestPaymentProvider.executePayment({amountMinor:Number(payout.amount_minor),currencyCode:'TWD',outcome:outcome==='FAILED'?'FAILED':'SUCCEEDED'});if(!canTransitionPaymentAttemptStatus('PENDING','PROCESSING')||!canTransitionPaymentAttemptStatus('PROCESSING',providerResult.status))throw new Error('INVALID_PAYMENT_STATE');const statements:any[]=[c.env.smart_menu_db.prepare(`INSERT INTO commission_payment_attempts(id,workspace_id,line_account_id,payout_request_id,attempt_no,provider_code,status,amount_minor,currency_code,idempotency_key_hash,started_at) VALUES(?,?,?,?,?,'INTERNAL_TEST','PENDING',?,'TWD',?,?)`).bind(attemptId,workspaceId,lineAccountId,payout.id,attemptNo,Number(payout.amount_minor),hash,now),c.env.smart_menu_db.prepare(`INSERT INTO commission_payment_attempt_status_events(id,workspace_id,line_account_id,payment_attempt_id,from_status,to_status,occurred_at) VALUES(?,?,?,?,?,?,?)`).bind(id('cpase'),workspaceId,lineAccountId,attemptId,null,'PENDING',now),c.env.smart_menu_db.prepare(`UPDATE commission_payment_attempts SET status='PROCESSING' WHERE id=? AND status='PENDING'`).bind(attemptId),c.env.smart_menu_db.prepare(`INSERT INTO commission_payment_attempt_status_events(id,workspace_id,line_account_id,payment_attempt_id,from_status,to_status,occurred_at) VALUES(?,?,?,?,?,?,?)`).bind(id('cpase'),workspaceId,lineAccountId,attemptId,'PENDING','PROCESSING',now)];if(providerResult.status==='SUCCEEDED'){statements.push(c.env.smart_menu_db.prepare(`UPDATE commission_payment_attempts SET status='SUCCEEDED',completed_at=? WHERE id=? AND status='PROCESSING'`).bind(now,attemptId),c.env.smart_menu_db.prepare(`INSERT INTO commission_payment_attempt_status_events(id,workspace_id,line_account_id,payment_attempt_id,from_status,to_status,occurred_at) VALUES(?,?,?,?,?,?,?)`).bind(id('cpase'),workspaceId,lineAccountId,attemptId,'PROCESSING','SUCCEEDED',now),c.env.smart_menu_db.prepare(`INSERT INTO commission_payment_transactions(id,payment_attempt_id,payout_request_id,provider_code,provider_transaction_ref,amount_minor,currency_code,status,confirmed_at) VALUES(?,?,?,'INTERNAL_TEST',? ,?,'TWD','SUCCEEDED',?)`).bind(id('cpt'),attemptId,payout.id,`simulated_${attemptId}`,Number(payout.amount_minor),now));}else{const failure=String(providerResult.failureReasonCode||'TECHNICAL_FAILURE');if(!isPaymentFailureReasonCode(failure))throw new Error('INVALID_PAYMENT_STATE');statements.push(c.env.smart_menu_db.prepare(`UPDATE commission_payment_attempts SET status='FAILED',failure_reason_code=?,completed_at=? WHERE id=? AND status='PROCESSING'`).bind(failure,now,attemptId),c.env.smart_menu_db.prepare(`INSERT INTO commission_payment_attempt_status_events(id,workspace_id,line_account_id,payment_attempt_id,from_status,to_status,occurred_at,reason_code) VALUES(?,?,?,?,?,?,?,?)`).bind(id('cpase'),workspaceId,lineAccountId,attemptId,'PROCESSING','FAILED',now,failure));}try{await c.env.smart_menu_db.batch(statements);}catch(e:any){if(String(e?.message||'').includes('UNIQUE')){const existing:any=await c.env.smart_menu_db.prepare(`SELECT id,payout_request_id,attempt_no,provider_code,status,amount_minor,currency_code,failure_reason_code,started_at,completed_at FROM commission_payment_attempts WHERE payout_request_id=? AND idempotency_key_hash=? LIMIT 1`).bind(payout.id,hash).first();if(existing)return c.json({success:true,idempotent:true,attempt:publicPaymentAttemptRow(existing)});return c.json({success:false,error:'PAYMENT_ALREADY_SUCCEEDED'},409)}throw e}const created:any=await c.env.smart_menu_db.prepare(`SELECT id,payout_request_id,attempt_no,provider_code,status,amount_minor,currency_code,failure_reason_code,started_at,completed_at FROM commission_payment_attempts WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(attemptId,workspaceId,lineAccountId).first();return c.json({success:true,attempt:publicPaymentAttemptRow(created)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'PAYMENT_EXECUTION_SIMULATION_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:400)}});
app.get('/api/member/dealer/payout-requests',async c=>{try{const context=await resolvedDealerPayoutContext(c);if(!context.dealer)return c.json({success:true,status:'NOT_ENROLLED',requests:[]});const scope=dealerPayoutHandleScope(context),secret=text(c.env.MEMBER_IDENTITY_HMAC_SECRET),rows:any[]=(await c.env.smart_menu_db.prepare(`SELECT id,settlement_id,status,amount_minor,currency_code,requested_at,reviewed_at,rejection_reason_code FROM commission_payout_requests WHERE workspace_id=? AND line_account_id=? AND dealer_id=? ORDER BY requested_at DESC,id DESC`).bind(scope.workspaceId,scope.lineAccountId,scope.dealerId).all()).results||[];return c.json({success:true,status:'ENROLLED',requests:await Promise.all(rows.map(row=>publicDealerPayoutRequestWithHandle(secret,scope,row)))});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.post('/api/member/dealer/payout-requests',async c=>{try{const body:any=await c.req.json().catch(()=>({})),settlementHandle=text(body.settlementHandle,4096);if(!settlementHandle)return c.json({success:false,error:'SETTLEMENT_HANDLE_REQUIRED'},400);const context=await resolvedDealerPayoutContext(c);if(!context.dealer)return c.json({success:false,error:'NOT_ENROLLED'},409);if(context.dealer.status!=='ACTIVE')return c.json({success:false,error:'DEALER_NOT_ACTIVE'},409);const scope=context.verified.account,handle=await verifyDealerSettlementHandle(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),settlementHandle),candidates=await dealerFinalizedSettlementRows(c.env.smart_menu_db,{workspaceId:scope.workspace_id,lineAccountId:scope.id,dealerId:context.dealer.id}),candidate=await (async()=>{for(const row of candidates){if((await dealerSettlementHandleReference(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),{workspaceId:scope.workspace_id,lineAccountId:scope.id,dealerId:context.dealer.id,settlementId:row.settlementId}))===handle.reference)return row}return null})(),settlementId=candidate?.settlementId;if(!settlementId)return c.json({success:false,error:'SETTLEMENT_HANDLE_INVALID'},400);const settlement:any=await c.env.smart_menu_db.prepare(`SELECT id,status,currency_code FROM commission_settlements WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(settlementId,scope.workspace_id,scope.id).first();if(!settlement)return c.json({success:false,error:'NOT_FOUND'},404);if(settlement.status!=='FINALIZED')return c.json({success:false,error:'SETTLEMENT_NOT_FINALIZED'},409);const ownership:any=await c.env.smart_menu_db.prepare(`SELECT COALESCE(SUM(amount_minor),0) amount_minor,MIN(currency_code) currency_code FROM commission_settlement_items WHERE settlement_id=? AND dealer_id=?`).bind(settlement.id,context.dealer.id).first();const amountMinor=Number(ownership?.amount_minor||0);if(!Number.isSafeInteger(amountMinor)||amountMinor<=0||ownership?.currency_code!=='TWD')return c.json({success:false,error:'SETTLEMENT_OWNERSHIP_REQUIRED'},409);const requestId=id('cpr');try{await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare(`INSERT INTO commission_payout_requests(id,workspace_id,line_account_id,settlement_id,dealer_id,status,amount_minor,currency_code) VALUES(?,?,?,?,?,'REQUESTED',?,'TWD')`).bind(requestId,scope.workspace_id,scope.id,settlement.id,context.dealer.id,amountMinor),c.env.smart_menu_db.prepare(`INSERT INTO commission_payout_request_status_events(id,workspace_id,line_account_id,payout_request_id,from_status,to_status,actor_type,actor_user_id) VALUES(?,?,?,?,?,?,?,?)`).bind(id('cprse'),scope.workspace_id,scope.id,requestId,null,'REQUESTED','DEALER',null)]);}catch(e:any){if(String(e?.message||'').includes('ACTIVE_PAYOUT_REQUEST_EXISTS'))return c.json({success:false,error:'ACTIVE_PAYOUT_REQUEST_EXISTS'},409);throw e}const created:any=await c.env.smart_menu_db.prepare(`SELECT id,settlement_id,status,amount_minor,currency_code,requested_at,reviewed_at,rejection_reason_code FROM commission_payout_requests WHERE id=? AND workspace_id=? AND line_account_id=? AND dealer_id=?`).bind(requestId,scope.workspace_id,scope.id,context.dealer.id).first();return c.json({success:true,request:await publicDealerPayoutRequestWithHandle(text(c.env.MEMBER_IDENTITY_HMAC_SECRET),dealerPayoutHandleScope(context),created)},201);}catch(e:any){return c.json({success:false,error:e?.message==='DEALER_NOT_ACTIVE'?'DEALER_NOT_ACTIVE':'PAYOUT_REQUEST_CREATE_FAILED'},e?.message==='DEALER_NOT_ACTIVE'?409:400)}});
app.post('/api/member/dealer/payout-requests/cancel',async c=>{try{const body:any=await c.req.json().catch(()=>({})),payoutRequestHandle=text(body.payoutRequestHandle,4096);if(!payoutRequestHandle)return c.json({success:false,error:'PAYOUT_REQUEST_HANDLE_REQUIRED'},400);const context=await resolvedDealerPayoutContext(c);if(!context.dealer)return c.json({success:false,error:'NOT_ENROLLED'},409);const scope=dealerPayoutHandleScope(context),secret=text(c.env.MEMBER_IDENTITY_HMAC_SECRET),row:any=await dealerPayoutRequestForHandle(c.env.smart_menu_db,secret,scope,payoutRequestHandle);if(row.status!=='REQUESTED')return c.json({success:false,error:'INVALID_PAYOUT_REQUEST_TRANSITION'},409);const now=new Date().toISOString();await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare(`UPDATE commission_payout_requests SET status='CANCELLED' WHERE id=? AND workspace_id=? AND line_account_id=? AND dealer_id=? AND status='REQUESTED'`).bind(row.id,scope.workspaceId,scope.lineAccountId,scope.dealerId),c.env.smart_menu_db.prepare(`INSERT INTO commission_payout_request_status_events(id,workspace_id,line_account_id,payout_request_id,from_status,to_status,actor_type,actor_user_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id('cprse'),scope.workspaceId,scope.lineAccountId,row.id,'REQUESTED','CANCELLED','DEALER',null,now)]);const updated:any=await c.env.smart_menu_db.prepare(`SELECT id,settlement_id,status,amount_minor,currency_code,requested_at,reviewed_at,rejection_reason_code FROM commission_payout_requests WHERE id=? AND workspace_id=? AND line_account_id=? AND dealer_id=?`).bind(row.id,scope.workspaceId,scope.lineAccountId,scope.dealerId).first();return c.json({success:true,request:await publicDealerPayoutRequestWithHandle(secret,scope,updated)});}catch(e:any){const error=text(e?.message,120);if(error==='DEALER_PAYOUT_REQUEST_HANDLE_INVALID'||error==='DEALER_PAYOUT_REQUEST_HANDLE_EXPIRED')return c.json({success:false,error},400);return c.json({success:false,error:'PAYOUT_REQUEST_CANCEL_FAILED'},400)}});
app.get('/api/commission-payout-requests',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),status=text(c.req.query('status'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(status&&!isPayoutRequestStatus(status))return c.json({success:false,error:'INVALID_STATUS_FILTER'},400);if(!await commissionProgramAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const rows:any[]=(await c.env.smart_menu_db.prepare(`SELECT id,settlement_id,status,amount_minor,currency_code,requested_at,reviewed_at,rejection_reason_code FROM commission_payout_requests WHERE workspace_id=? AND line_account_id=? ${status?'AND status=?':''} ORDER BY requested_at DESC,id DESC`).bind(...(status?[workspaceId,lineAccountId,status]:[workspaceId,lineAccountId])).all()).results||[];return c.json({success:true,requests:rows.map(publicPayoutRequestRow)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'PAYOUT_REQUEST_LIST_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/commission-payout-requests/:requestId',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);const row:any=await c.env.smart_menu_db.prepare(`SELECT id,settlement_id,status,amount_minor,currency_code,requested_at,reviewed_at,rejection_reason_code FROM commission_payout_requests WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(c.req.param('requestId'),workspaceId,lineAccountId).first();if(!row)return c.json({success:false,error:'NOT_FOUND'},404);const events:any[]=(await c.env.smart_menu_db.prepare(`SELECT from_status,to_status,actor_type,occurred_at,reason_code FROM commission_payout_request_status_events WHERE payout_request_id=? ORDER BY occurred_at ASC,id ASC`).bind(row.id).all()).results||[];return c.json({success:true,request:publicPayoutRequestRow(row),statusHistory:events.map(x=>({fromStatus:x.from_status||null,toStatus:x.to_status,actorType:x.actor_type,occurredAt:x.occurred_at,reasonCode:x.reason_code||null}))});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'PAYOUT_REQUEST_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/commission-payout-requests/:requestId/status',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),body:any=await c.req.json().catch(()=>({})),next=text(body.status),reasonCode=text(body.reasonCode);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(next!=='APPROVED'&&next!=='REJECTED')return c.json({success:false,error:'INVALID_PAYOUT_REQUEST_STATUS'},400);if(next==='REJECTED'&&!isPayoutRejectionReasonCode(reasonCode))return c.json({success:false,error:'INVALID_REJECTION_REASON'},400);const row:any=await c.env.smart_menu_db.prepare(`SELECT * FROM commission_payout_requests WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(c.req.param('requestId'),workspaceId,lineAccountId).first();if(!row)return c.json({success:false,error:'NOT_FOUND'},404);if(row.status===next)return c.json({success:true,idempotent:true,request:publicPayoutRequestRow(row)});if(!canTransitionPayoutRequestStatus(row.status,next))return c.json({success:false,error:'INVALID_PAYOUT_REQUEST_TRANSITION'},409);const now=new Date().toISOString(),actor=text(c.get('userId'))||null;await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare(`UPDATE commission_payout_requests SET status=?,reviewed_at=?,reviewed_by_user_id=?,rejection_reason_code=? WHERE id=? AND workspace_id=? AND line_account_id=? AND status='REQUESTED'`).bind(next,now,actor,next==='REJECTED'?reasonCode:null,row.id,workspaceId,lineAccountId),c.env.smart_menu_db.prepare(`INSERT INTO commission_payout_request_status_events(id,workspace_id,line_account_id,payout_request_id,from_status,to_status,actor_type,actor_user_id,occurred_at,reason_code) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id('cprse'),workspaceId,lineAccountId,row.id,'REQUESTED',next,'TENANT_ADMIN',actor,now,next==='REJECTED'?reasonCode:null)]);const updated:any=await c.env.smart_menu_db.prepare(`SELECT id,settlement_id,status,amount_minor,currency_code,requested_at,reviewed_at,rejection_reason_code FROM commission_payout_requests WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1`).bind(row.id,workspaceId,lineAccountId).first();return c.json({success:true,request:publicPayoutRequestRow(updated)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'PAYOUT_REQUEST_STATUS_UPDATE_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/commission-settlements',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await commissionProgramAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const rows:any[]=(await c.env.smart_menu_db.prepare(`SELECT s.*,p.period_start,p.period_end,p.locked_at,p.finalized_at,p.cancelled_at FROM commission_settlements s JOIN commission_settlement_periods p ON p.id=s.settlement_period_id WHERE s.workspace_id=? AND s.line_account_id=? ORDER BY p.period_start DESC,s.created_at DESC`).bind(workspaceId,lineAccountId).all()).results||[];return c.json({success:true,settlements:rows.map(publicSettlementRow)});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_SETTLEMENT_LIST_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/commission-settlements',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),body:any=await c.req.json().catch(()=>({})),periodStart=text(body.periodStart,40),periodEnd=text(body.periodEnd,40);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!isValidSettlementPeriod(periodStart,periodEnd))return c.json({success:false,error:'INVALID_SETTLEMENT_PERIOD'},400);if(!await commissionProgramAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);const overlap:any=await c.env.smart_menu_db.prepare(`SELECT id FROM commission_settlement_periods WHERE workspace_id=? AND line_account_id=? AND status IN ('DRAFT','LOCKED') AND period_start<? AND period_end>? LIMIT 1`).bind(workspaceId,lineAccountId,periodEnd,periodStart).first();if(overlap)return c.json({success:false,error:'SETTLEMENT_PERIOD_OVERLAP'},409);const periodId=id('sper'),settlementId=id('cset'),actor=text(c.get('userId'))||null;await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare(`INSERT INTO commission_settlement_periods(id,workspace_id,line_account_id,period_start,period_end,status,created_by_user_id) VALUES(?,?,?,?,?,'DRAFT',?)`).bind(periodId,workspaceId,lineAccountId,periodStart,periodEnd,actor),c.env.smart_menu_db.prepare(`INSERT INTO commission_settlements(id,settlement_period_id,workspace_id,line_account_id,status,currency_code,total_amount_minor,entry_count) VALUES(?,?,?,?, 'DRAFT','TWD',0,0)`).bind(settlementId,periodId,workspaceId,lineAccountId),c.env.smart_menu_db.prepare(`INSERT INTO commission_settlement_status_events(id,workspace_id,line_account_id,settlement_id,from_status,to_status,actor_user_id) VALUES(?,?,?,?,?,?,?)`).bind(id('csse'),workspaceId,lineAccountId,settlementId,null,'DRAFT',actor)]);const created:any=await c.env.smart_menu_db.prepare(`SELECT s.*,p.period_start,p.period_end,p.locked_at,p.finalized_at,p.cancelled_at FROM commission_settlements s JOIN commission_settlement_periods p ON p.id=s.settlement_period_id WHERE s.id=? AND s.workspace_id=? AND s.line_account_id=?`).bind(settlementId,workspaceId,lineAccountId).first();return c.json({success:true,settlement:publicSettlementRow(created)},201);}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_SETTLEMENT_CREATE_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/commission-settlements/:settlementId',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);const row:any=await c.env.smart_menu_db.prepare(`SELECT s.*,p.period_start,p.period_end,p.locked_at,p.finalized_at,p.cancelled_at FROM commission_settlements s JOIN commission_settlement_periods p ON p.id=s.settlement_period_id WHERE s.id=? AND s.workspace_id=? AND s.line_account_id=?`).bind(c.req.param('settlementId'),workspaceId,lineAccountId).first();if(!row)return c.json({success:false,error:'NOT_FOUND'},404);const items:any[]=(await c.env.smart_menu_db.prepare(`SELECT i.amount_minor,i.currency_code,i.ledger_effective_at,p.name program_name FROM commission_settlement_items i JOIN commission_programs p ON p.id=i.program_id WHERE i.settlement_id=? ORDER BY i.ledger_effective_at ASC,i.id ASC`).bind(row.id).all()).results||[];const events:any[]=(await c.env.smart_menu_db.prepare(`SELECT from_status,to_status,occurred_at FROM commission_settlement_status_events WHERE settlement_id=? ORDER BY occurred_at ASC,id ASC`).bind(row.id).all()).results||[];return c.json({success:true,settlement:publicSettlementRow(row),items:items.map(publicSettlementItem),statusHistory:events.map(x=>({fromStatus:x.from_status||null,toStatus:x.to_status,occurredAt:x.occurred_at}))});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_SETTLEMENT_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.post('/api/commission-settlements/:settlementId/status',async c=>{try{requireRole(c,'admin');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),body:any=await c.req.json().catch(()=>({})),next=text(body.status);if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!isSettlementStatus(next))return c.json({success:false,error:'INVALID_SETTLEMENT_STATUS'},400);const row:any=await c.env.smart_menu_db.prepare(`SELECT s.*,p.period_start,p.period_end FROM commission_settlements s JOIN commission_settlement_periods p ON p.id=s.settlement_period_id WHERE s.id=? AND s.workspace_id=? AND s.line_account_id=?`).bind(c.req.param('settlementId'),workspaceId,lineAccountId).first();if(!row)return c.json({success:false,error:'NOT_FOUND'},404);if(row.status===next)return c.json({success:true,idempotent:true,settlement:publicSettlementRow(row)});if(!canTransitionSettlementStatus(row.status,next))return c.json({success:false,error:'INVALID_SETTLEMENT_TRANSITION'},409);const actor=text(c.get('userId'))||null,now=new Date().toISOString();if(next==='LOCKED'){const eligible:any[]=(await c.env.smart_menu_db.prepare(SETTLEMENT_ELIGIBLE_LEDGER_SQL).bind(workspaceId,lineAccountId,row.period_start,row.period_end,row.id).all()).results||[];if(!eligible.length)return c.json({success:false,error:'NO_ELIGIBLE_LEDGER_ENTRIES'},409);const total=eligible.reduce((sum,item)=>sum+Number(item.amount_minor||0),0);if(!Number.isSafeInteger(total)||total<=0)return c.json({success:false,error:'INVALID_SETTLEMENT_AMOUNT'},409);const statements:any[]=[];for(const item of eligible)statements.push(c.env.smart_menu_db.prepare(`INSERT INTO commission_settlement_items(id,settlement_id,ledger_entry_id,dealer_id,program_id,amount_minor,currency_code,ledger_effective_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id('cseti'),row.id,item.id,item.dealer_id,item.program_id,Number(item.amount_minor),'TWD',item.effective_at));statements.push(c.env.smart_menu_db.prepare(`UPDATE commission_settlements SET status='LOCKED',total_amount_minor=?,entry_count=?,snapshot_at=?,updated_at=? WHERE id=? AND workspace_id=? AND line_account_id=? AND status='DRAFT'`).bind(total,eligible.length,now,now,row.id,workspaceId,lineAccountId),c.env.smart_menu_db.prepare(`UPDATE commission_settlement_periods SET status='LOCKED',locked_at=? WHERE id=? AND workspace_id=? AND line_account_id=? AND status='DRAFT'`).bind(now,row.settlement_period_id,workspaceId,lineAccountId),c.env.smart_menu_db.prepare(`INSERT INTO commission_settlement_status_events(id,workspace_id,line_account_id,settlement_id,from_status,to_status,actor_user_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id('csse'),workspaceId,lineAccountId,row.id,'DRAFT','LOCKED',actor,now));await c.env.smart_menu_db.batch(statements);}else{const timestampColumn=next==='FINALIZED'?'finalized_at':'cancelled_at';await c.env.smart_menu_db.batch([c.env.smart_menu_db.prepare(`UPDATE commission_settlements SET status=?,updated_at=? WHERE id=? AND workspace_id=? AND line_account_id=? AND status=?`).bind(next,now,row.id,workspaceId,lineAccountId,row.status),c.env.smart_menu_db.prepare(`UPDATE commission_settlement_periods SET status=?,${timestampColumn}=? WHERE id=? AND workspace_id=? AND line_account_id=? AND status=?`).bind(next,now,row.settlement_period_id,workspaceId,lineAccountId,row.status),c.env.smart_menu_db.prepare(`INSERT INTO commission_settlement_status_events(id,workspace_id,line_account_id,settlement_id,from_status,to_status,actor_user_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id('csse'),workspaceId,lineAccountId,row.id,row.status,next,actor,now)]);}const updated:any=await c.env.smart_menu_db.prepare(`SELECT s.*,p.period_start,p.period_end,p.locked_at,p.finalized_at,p.cancelled_at FROM commission_settlements s JOIN commission_settlement_periods p ON p.id=s.settlement_period_id WHERE s.id=? AND s.workspace_id=? AND s.line_account_id=?`).bind(row.id,workspaceId,lineAccountId).first();return c.json({success:true,settlement:publicSettlementRow(updated)});}catch(e:any){const code=String(e?.message||'');return c.json({success:false,error:code==='FORBIDDEN_ROLE'?'FORBIDDEN':code.includes('LEDGER_ALREADY_SETTLED')?'LEDGER_ALREADY_SETTLED':'COMMISSION_SETTLEMENT_STATUS_UPDATE_FAILED'},code==='FORBIDDEN_ROLE'?403:code.includes('LEDGER_ALREADY_SETTLED')?409:500)}});
app.get('/api/commission-ledger',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),programId=text(c.req.query('programId')),days=commissionLedgerPeriod(c.req.query('period'));if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);if(!await commissionProgramAccount(c.env.smart_menu_db,workspaceId,lineAccountId))return c.json({success:false,error:'NOT_FOUND'},404);if(programId&&!await scopedCommissionProgram(c.env.smart_menu_db,workspaceId,lineAccountId,programId))return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,...await commissionLedgerSnapshot(c.env.smart_menu_db,{workspaceId,lineAccountId,days,programId:programId||undefined})});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_LEDGER_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/commission-attributions',async c=>{try{requireRole(c,'viewer');const workspaceId=workspaceIdOf(c),lineAccountId=text(c.req.query('lineAccountId')),programId=text(c.req.query('programId')),days=commissionAttributionPeriod(c.req.query('period')),db=c.env.smart_menu_db;if(!lineAccountId)return c.json({success:false,error:'LINE_ACCOUNT_REQUIRED'},400);const account:any=await db.prepare('SELECT id FROM workspace_line_accounts WHERE id=? AND workspace_id=? LIMIT 1').bind(lineAccountId,workspaceId).first();if(!account)return c.json({success:false,error:'NOT_FOUND'},404);if(programId&&!await db.prepare('SELECT id FROM commission_programs WHERE id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(programId,workspaceId,lineAccountId).first())return c.json({success:false,error:'NOT_FOUND'},404);return c.json({success:true,...await commissionAttributionSnapshot(db,{workspaceId,lineAccountId,days,programId:programId||undefined})});}catch(e:any){return c.json({success:false,error:e?.message==='FORBIDDEN_ROLE'?'FORBIDDEN':'COMMISSION_ATTRIBUTION_READ_FAILED'},e?.message==='FORBIDDEN_ROLE'?403:500)}});
app.get('/api/member/dealer/commission-attributions',async c=>{try{const lineAccountId=text(c.req.query('lineAccountId')),days=commissionAttributionPeriod(c.req.query('period')),verified=await verifiedReferralMember(c,{lineAccountId,liffAccessToken:text(c.req.header('Authorization')).replace(/^Bearer\s+/i,'')}),dealer:any=await c.env.smart_menu_db.prepare('SELECT id FROM line_oa_dealers WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1').bind(verified.account.workspace_id,verified.account.id,verified.memberId).first();if(!dealer)return c.json({success:true,status:'NOT_ENROLLED',period:{days,from:null,to:null},summary:{attributedConversions:0},trend:[],programs:[],sources:[]});const snapshot=await commissionAttributionSnapshot(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,days,dealerId:dealer.id});return c.json({success:true,status:'ENROLLED',period:snapshot.period,summary:snapshot.summary,trend:snapshot.trend,programs:snapshot.programs.map((row:any)=>({programName:row.programName,attributedConversions:row.attributedConversions})),sources:snapshot.sources});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.get('/api/member/dealer/commission-ledger',async c=>{try{const days=commissionLedgerPeriod(c.req.query('period')),verified=await verifiedDealerLedgerMember(c);if(!verified.memberId)return c.json({success:true,status:'NOT_ENROLLED',period:{days,from:null,to:null},earnedByCurrency:[],trend:[],programBreakdown:[]});const dealer:any=await c.env.smart_menu_db.prepare('SELECT id FROM line_oa_dealers WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1').bind(verified.account.workspace_id,verified.account.id,verified.memberId).first();if(!dealer)return c.json({success:true,status:'NOT_ENROLLED',period:{days,from:null,to:null},earnedByCurrency:[],trend:[],programBreakdown:[]});const snapshot=await commissionLedgerSnapshot(c.env.smart_menu_db,{workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,days,dealerId:dealer.id});return c.json({success:true,status:'ENROLLED',period:snapshot.period,earnedByCurrency:snapshot.earnedByCurrency,trend:snapshot.trend,programBreakdown:snapshot.programBreakdown.map((row:any)=>({programName:row.programName,currencyCode:row.currencyCode,earnedAmountMinor:row.earnedAmountMinor,attributionCount:row.attributionCount}))});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
app.post('/api/member/conversion-referral-context',async c=>{try{const body:any=await c.req.json(),verified=await verifiedReferralMember(c,body),issued=await issueConversionReferralContext(c.env.smart_menu_db,{secret:text(c.env.MEMBER_IDENTITY_HMAC_SECRET),workspaceId:verified.account.workspace_id,lineAccountId:verified.account.id,memberId:verified.memberId});if(!issued)return c.json({success:true,status:'NOT_ATTRIBUTABLE'});return c.json({success:true,status:'READY',conversionReferralContext:issued.token,expiresAt:issued.expiresAt});}catch{return c.json({success:false,error:'MEMBER_CONTEXT_REQUIRED'},401)}});
