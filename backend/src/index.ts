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
  setDefaultRichMenu,
  upsertRichMenuAlias,
} from './line-rich-menu.mjs';
import { buildGuideContext, toPublicGuideContext } from './guide/context';
import { evaluateGuide } from './guide/rules';
import { buildGuideWorkflow } from './guide/workflow';
import { emptyRecommendationResult, evaluateRecommendations } from './guide/recommendations/engine';
import { explainRecommendation, findRecommendationById } from './guide/explanations/engine';
import { GEMINI_MODEL, requestGeminiContent } from './gemini';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  GEMINI_API_KEY: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  TENANT_MODE?: string;
  DEV_WORKSPACE_ID?: string;
  AUTH_DEV_TOKEN?: string;
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

function areaStyle(x: number, y: number, width: number, height: number) {
  return {
    left: `${(x / 2500) * 100}%`,
    top: `${(y / 1686) * 100}%`,
    width: `${(width / 2500) * 100}%`,
    height: `${(height / 1686) * 100}%`,
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
    SELECT *
    FROM projects
    WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
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
    SELECT id FROM assets
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
    if (!c.env.GEMINI_API_KEY) {
      return c.json({ success: false, error: 'GEMINI_API_KEY 尚未設定。' }, 500);
    }

    const base64Image = arrayBufferToBase64(await image.arrayBuffer());
    const mimeType = image.type || 'image/png';
    const prompt = `你是一個 LINE 官方帳號 Rich Menu 專業座標分析器。分析圖片中的可點擊功能區塊。整張圖片固定換算為 2500x1686，左上角為 0,0。每個區塊回傳 id,label,x,y,width,height。座標使用整數，區塊不得超界或重疊，label 使用繁體中文，可辨識規則或不規則版型。只輸出符合 JSON Schema 的資料。`;

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
    if (!response.ok) return c.json({ success: false, error: result?.error?.message || 'Gemini API 呼叫失敗' }, 500);

    const outputText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outputText) throw new Error('Gemini 沒有回傳辨識結果');
    const parsed = JSON.parse(outputText);
    if (!Array.isArray(parsed.areas)) throw new Error('Gemini 回傳資料缺少 areas');

    const areas = parsed.areas.map((area: any, index: number) => {
      const x = Math.max(0, Math.round(num(area.x)));
      const y = Math.max(0, Math.round(num(area.y)));
      const width = Math.max(1, Math.round(num(area.width, 1)));
      const height = Math.max(1, Math.round(num(area.height, 1)));
      return { id: num(area.id, index + 1), label: text(area.label || `區塊 ${index + 1}`), x, y, width, height, style: areaStyle(x, y, width, height) };
    });

    return c.json({ success: true, provider: 'gemini', model: GEMINI_MODEL, areas });
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
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
      return c.json({ success: false, error: '只支援 PNG、JPG、WEBP。' }, 400);
    }
    if (image.size > 10 * 1024 * 1024) return c.json({ success: false, error: '圖片不可超過 10MB。' }, 400);

    const assetId = id('asset');
    const storageKey = `templates/${workspaceIdOf(c)}/${assetId}/image.${safeExt(image.name)}`;
    await c.env.smart_menu_assets.put(storageKey, await image.arrayBuffer(), {
      httpMetadata: { contentType: image.type || 'image/png' },
      customMetadata: { assetId, workspaceId: workspaceIdOf(c) },
    });
    await c.env.smart_menu_db.prepare(`
      INSERT INTO assets (id, workspace_id, storage_key, original_filename, content_type, size_bytes, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ready')
    `).bind(assetId, workspaceIdOf(c), storageKey, image.name, image.type || 'image/png', image.size).run();

    return c.json({ success: true, asset: { id: assetId, storageKey, imageUrl: `/api/assets/${assetId}` } });
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
    if (!assetId || !(await ensureAsset(c.env, workspaceIdOf(c), assetId))) return c.json({ success: false, error: '模板圖片 Asset 不存在。' }, 400);
    if (!areas.length) return c.json({ success: false, error: '模板至少需要一個熱區。' }, 400);

    const templateId = id('tpl');
    const statements: D1PreparedStatement[] = [
      c.env.smart_menu_db.prepare(`
        INSERT INTO templates (
          id, workspace_id, name, industry, status, asset_id, area_count, page_count, ai_provider, ai_model, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        templateId, workspaceIdOf(c), name, text(body.industry || '待分類'), text(body.status || 'draft'), assetId,
        areas.length, Math.max(1, Math.round(num(body.pageCount, 1))), text(body.aiProvider || 'gemini'), text(body.aiModel || 'gemini-3.6-flash')
      ),
      ...areas.map((area: any, index: number) => areaInsertStatement(c.env, workspaceIdOf(c), templateId, area, index)),
    ];
    await c.env.smart_menu_db.batch(statements);
    return c.json({ success: true, template: { id: templateId, name, assetId, areaCount: areas.length, imageUrl: `/api/assets/${assetId}` } });
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
    if (!assetId || !(await ensureAsset(c.env, workspaceIdOf(c), assetId))) return c.json({ success: false, error: '模板圖片 Asset 不存在。' }, 400);
    if (!areas.length) return c.json({ success: false, error: '模板至少需要一個熱區。' }, 400);

    const statements: D1PreparedStatement[] = [
      c.env.smart_menu_db.prepare(`
        UPDATE templates SET
          name = ?, industry = ?, status = ?, asset_id = ?, area_count = ?, page_count = ?,
          ai_provider = ?, ai_model = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).bind(
        name, text(body.industry || '待分類'), text(body.status || 'draft'), assetId, areas.length,
        Math.max(1, Math.round(num(body.pageCount, 1))), text(body.aiProvider || 'gemini'), text(body.aiModel || 'gemini-3.6-flash'),
        templateId, workspaceIdOf(c)
      ),
      c.env.smart_menu_db.prepare(`DELETE FROM template_areas WHERE template_id = ? AND workspace_id = ?`).bind(templateId, workspaceIdOf(c)),
      ...areas.map((area: any, index: number) => areaInsertStatement(c.env, workspaceIdOf(c), templateId, area, index)),
    ];
    await c.env.smart_menu_db.batch(statements);
    return c.json({ success: true, template: { id: templateId, name, assetId, areaCount: areas.length, imageUrl: `/api/assets/${assetId}` } });
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
        t.updated_at
      FROM templates t
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
          w.slug AS workspace_slug
        FROM templates t
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
             t.ai_provider, t.ai_model, t.created_at, t.updated_at
      FROM templates t
      WHERE t.workspace_id = ? AND t.deleted_at IS NULL
      ORDER BY t.updated_at DESC, t.created_at DESC
    `).bind(workspaceIdOf(c)).all();

    const templates = (result.results || []).map((row: any) => ({
      id: row.id, name: row.name, industry: row.industry, status: row.status,
      assetId: row.asset_id, areaCount: row.area_count, pageCount: row.page_count,
      aiProvider: row.ai_provider, aiModel: row.ai_model,
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
      SELECT * FROM templates WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1
    `).bind(templateId, workspaceIdOf(c)).first();
    if (!template) return c.json({ success: false, error: '找不到模板。' }, 404);

    const areaResult = await c.env.smart_menu_db.prepare(`
      SELECT * FROM template_areas WHERE template_id = ? AND workspace_id = ? ORDER BY area_index ASC
    `).bind(templateId, workspaceIdOf(c)).all();

    const areas = (areaResult.results || []).map((row: any) => {
      const action: any = { type: row.action_type || 'none' };
      if (action.type === 'uri') action.uri = row.action_uri || '';
      if (action.type === 'message') action.text = row.action_text || '';
      if (action.type === 'postback') { action.data = row.action_data || ''; action.displayText = row.action_display_text || ''; }
      if (action.type === 'richmenuswitch') { action.data = row.action_data || ''; action.targetPageId = row.target_page_id || ''; }
      const x = num(row.x), y = num(row.y), width = num(row.width), height = num(row.height);
      return { id: row.area_index, areaId: row.id, label: row.label, x, y, width, height, action, style: areaStyle(x, y, width, height) };
    });

    return c.json({
      success: true,
      template: {
        id: template.id, name: template.name, industry: template.industry, status: template.status,
        assetId: template.asset_id, areaCount: template.area_count, pageCount: template.page_count,
        aiProvider: template.ai_provider, aiModel: template.ai_model,
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
      SELECT *
      FROM templates
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
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
        COUNT(pa.id) AS area_count
      FROM projects p
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

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
      return c.json({ success: false, error: '只支援 PNG、JPG、WEBP。' }, 400);
    }

    if (image.size > 10 * 1024 * 1024) {
      return c.json({ success: false, error: '圖片不可超過 10MB。' }, 400);
    }

    const assetId = id('asset');
    const storageKey = `projects/${workspaceIdOf(c)}/${projectId}/${assetId}/image.${safeExt(image.name)}`;

    await c.env.smart_menu_assets.put(
      storageKey,
      await image.arrayBuffer(),
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
          id, workspace_id, storage_key, original_filename, content_type, size_bytes, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'ready')
      `).bind(
        assetId,
        workspaceIdOf(c),
        storageKey,
        image.name,
        image.type || 'image/png',
        image.size
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
      SELECT id
      FROM projects
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
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

      ...areas.map((area: any, index: number) =>
        projectAreaInsertStatement(c.env, workspaceIdOf(c), projectId, area, index)
      ),
    ];

    await c.env.smart_menu_db.batch(statements);

    return c.json({
      success: true,
      project: {
        id: projectId,
        name,
        areaCount: areas.length,
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
      SELECT *
      FROM projects
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
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
        style: areaStyle(x, y, width, height),
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

    const explanation = await explainRecommendation(recommendation, {
      apiKey: c.env.GEMINI_API_KEY,
      timeoutMs: 8000,
      logger: event => console.log(JSON.stringify(event)),
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

app.post('/api/projects/:projectId/publish', async (c) => {
  const projectId = c.req.param('projectId');

  try {
    requireRole(c, 'editor');

    if (!c.env.LINE_CHANNEL_ACCESS_TOKEN) {
      return c.json({
        success: false,
        error: 'LINE_CHANNEL_ACCESS_TOKEN 尚未設定。',
      }, 500);
    }

    const workspaceId = workspaceIdOf(c);
    const project: any = await getProjectForPublish(c.env, workspaceId, projectId);

    if (!project) {
      return c.json({ success: false, error: '找不到專案。' }, 404);
    }

    if (project.status === 'disabled') {
      return c.json({ success: false, error: '此專案已停用，請先啟用後再發布。' }, 409);
    }

    if (!project.asset_id) {
      return c.json({ success: false, error: '專案尚未設定圖片。' }, 400);
    }

    if (!project.areas?.length) {
      return c.json({ success: false, error: '專案沒有可發布的熱區。' }, 400);
    }

    const switchTargetIds = [...new Set(
      project.areas
        .filter((area: any) => area.action?.type === 'richmenuswitch')
        .map((area: any) => text(area.action?.targetPageId))
        .filter(Boolean)
    )] as string[];

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

      if ((targetResult.results || []).length !== switchTargetIds.length) {
        return c.json({ success: false, error: '切換目標不存在、已停用或不屬於目前 Workspace。' }, 400);
      }
    }

    const lineAreas = project.areas.map((area: any) => ({
      bounds: {
        x: Math.max(0, Math.round(num(area.x))),
        y: Math.max(0, Math.round(num(area.y))),
        width: Math.max(1, Math.round(num(area.width, 1))),
        height: Math.max(1, Math.round(num(area.height, 1))),
      },
      action: buildLineAction(area.action),
    }));

    const richMenuObject = {
      size: {
        width: 2500,
        height: 1686,
      },
      selected: true,
      name: text(project.name).slice(0, 300) || 'Smart Menu',
      chatBarText: '選單',
      areas: lineAreas,
    };

    // 1. Create a new immutable LINE Rich Menu version.
    const createRes = await fetch(
      'https://api.line.me/v2/bot/richmenu',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(richMenuObject),
      }
    );

    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`建立 LINE Rich Menu 失敗：${detail}`);
    }

    const createData: any = await createRes.json();
    const richMenuId = text(createData.richMenuId);

    if (!richMenuId) {
      throw new Error('LINE 未回傳 richMenuId');
    }

    // 2. Upload the image before creating or updating the alias.
    const { asset, object } = await getProjectImageObject(c.env, workspaceId, project.asset_id);
    const imageContentType = asset.content_type === 'image/png' ? 'image/png' : 'image/jpeg';
    const uploadRes = await fetch(
      `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          'Content-Type': imageContentType,
        },
        body: object.body,
      }
    );

    if (!uploadRes.ok) {
      const detail = await uploadRes.text();
      throw new Error(`上傳 LINE Rich Menu 圖片失敗：${detail}`);
    }

    // 3. Point the stable Project alias to the newly published Rich Menu.
    const richMenuAliasId = richMenuAliasIdForProject(projectId);
    const alias = await upsertRichMenuAlias(
      fetch,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      richMenuAliasId,
      richMenuId,
    );

    // 4. A republished home Project must remain the default; other Projects never replace it.
    if (project.status === 'default') {
      await setDefaultRichMenu(fetch, c.env.LINE_CHANNEL_ACCESS_TOKEN, richMenuId);
    }

    // 5. Store only lifecycle state. LINE alias remains the source of the current richMenuId mapping.
    await c.env.smart_menu_db.prepare(`
      UPDATE projects
      SET
        status = CASE WHEN status = 'default' THEN 'default' ELSE 'published' END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
    `).bind(projectId, workspaceId).run();

    return c.json({
      success: true,
      project: {
        id: projectId,
        name: project.name,
        status: project.status === 'default' ? 'default' : 'published',
        isDefault: project.status === 'default',
        richMenuAliasId,
        richMenuId,
      },
      alias,
      richMenu: richMenuObject,
    });
  } catch (e: any) {
    console.error('publish-project:', e);
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 editor、admin 或 owner。' }, 403);
    }
    return c.json({
      success: false,
      error: e?.message || '發布至 LINE 失敗',
    }, 500);
  }
});

app.post('/api/projects/:projectId/set-default', async (c) => {
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
    if (project.status === 'disabled') {
      return c.json({ success: false, error: '停用中的專案不可設為首頁。' }, 409);
    }

    const richMenuAliasId = richMenuAliasIdForProject(projectId);
    const alias: any = await getRichMenuAlias(fetch, c.env.LINE_CHANNEL_ACCESS_TOKEN, richMenuAliasId);
    const richMenuId = text(alias?.richMenuId);

    if (!richMenuId) {
      return c.json({ success: false, error: '此專案尚未發布或 Alias 不存在，請先發布。' }, 409);
    }

    await setDefaultRichMenu(fetch, c.env.LINE_CHANNEL_ACCESS_TOKEN, richMenuId);
    await c.env.smart_menu_db.batch([
      c.env.smart_menu_db.prepare(`
        UPDATE projects
        SET status = 'published', updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND status = 'default' AND id <> ? AND deleted_at IS NULL
      `).bind(workspaceId, projectId),
      c.env.smart_menu_db.prepare(`
        UPDATE projects
        SET status = 'default', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).bind(projectId, workspaceId),
    ]);

    return c.json({
      success: true,
      project: { id: projectId, name: project.name, status: 'default', isDefault: true },
      richMenuAliasId,
      richMenuId,
    });
  } catch (e: any) {
    console.error('set-default-project:', e);
    if (e?.message === 'FORBIDDEN_ROLE') {
      return c.json({ success: false, error: '權限不足，需要 editor、admin 或 owner。' }, 403);
    }
    return c.json({ success: false, error: e?.message || '設定首頁失敗' }, 500);
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
      let selectedTarget: any = null;
      let matchedRoute: any = null;

      if (event?.type === 'message' && event?.message?.type === 'text') {
        const messageText = text(event.message.text);

        matchedRoute = keywordRoutes.find(route =>
          keywordMatches(messageText, route.keyword, route.match_type)
        ) || null;

        if (matchedRoute) {
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
      content_type, size_bytes, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newAssetId,
    destinationWorkspaceId,
    destinationKey,
    asset.original_filename || filename,
    asset.content_type || object.httpMetadata?.contentType || 'application/octet-stream',
    Number(asset.size_bytes || object.size || 0),
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
      const sourceTemplate: any = await c.env.smart_menu_db.prepare(`
        SELECT *
        FROM templates
        WHERE id = ?
          AND workspace_id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `).bind(sourceTemplateId, sourceWorkspaceId).first();

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
      templateMap.set(sourceTemplateId, newTemplateId);

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
      `).bind(sourceTemplateId, sourceWorkspaceId).all();

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

export default app;
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


