PRAGMA foreign_keys = ON;

-- 1) 補上既有 Workspace 缺少的 LINE account
INSERT INTO workspace_line_accounts (
  id,
  workspace_id,
  status,
  webhook_token,
  webhook_enabled,
  created_at,
  updated_at
)
SELECT
  'lineacct_' || lower(hex(randomblob(8))),
  w.id,
  'disconnected',
  lower(hex(randomblob(32))),
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM workspaces w
WHERE w.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_line_accounts la
    WHERE la.workspace_id = w.id
  );

-- 2) 補 System A（position = 1）
INSERT INTO workspace_webhook_targets (
  id,
  workspace_id,
  name,
  target_type,
  endpoint_url,
  position,
  enabled,
  can_reply,
  forward_signature,
  timeout_ms,
  created_at,
  updated_at
)
SELECT
  'wht_' || lower(hex(randomblob(8))),
  w.id,
  'System A',
  'primary',
  NULL,
  1,
  0,
  1,
  1,
  8000,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM workspaces w
WHERE w.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_webhook_targets t
    WHERE t.workspace_id = w.id
      AND t.position = 1
  );

-- 3) 補 System B（position = 2）
INSERT INTO workspace_webhook_targets (
  id,
  workspace_id,
  name,
  target_type,
  endpoint_url,
  position,
  enabled,
  can_reply,
  forward_signature,
  timeout_ms,
  created_at,
  updated_at
)
SELECT
  'wht_' || lower(hex(randomblob(8))),
  w.id,
  'System B',
  'secondary',
  NULL,
  2,
  0,
  0,
  1,
  8000,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM workspaces w
WHERE w.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_webhook_targets t
    WHERE t.workspace_id = w.id
      AND t.position = 2
  );

-- 4) 把每個 Workspace 的預設 target 指到 System A
UPDATE workspace_line_accounts
SET default_target_id = (
  SELECT t.id
  FROM workspace_webhook_targets t
  WHERE t.workspace_id = workspace_line_accounts.workspace_id
    AND t.position = 1
  LIMIT 1
)
WHERE default_target_id IS NULL;
