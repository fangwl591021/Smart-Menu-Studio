-- 0044 LINE Campaign execution and immutable delivery authority.
-- Additive only. No backfill, seed data, provider call, or existing-row mutation.
PRAGMA foreign_keys = ON;

-- Internal provider target vault. Raw provider recipient IDs never leave server-side storage.
-- Existing members are intentionally not backfilled; a later verified LINE session records the target.
CREATE TABLE IF NOT EXISTS line_member_delivery_targets (
  workspace_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  line_member_id TEXT NOT NULL,
  provider_recipient_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspace_id,line_account_id,line_member_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(line_member_id) REFERENCES line_oa_members(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,line_account_id,provider_recipient_id)
);
CREATE TRIGGER IF NOT EXISTS line_member_delivery_targets_scope_guard_insert
BEFORE INSERT ON line_member_delivery_targets
WHEN NOT EXISTS (
  SELECT 1 FROM line_oa_members m
  WHERE m.id=NEW.line_member_id
    AND m.workspace_id=NEW.workspace_id
    AND m.line_account_id=NEW.line_account_id
)
BEGIN SELECT RAISE(ABORT,'LINE_MEMBER_DELIVERY_TARGET_SCOPE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS line_member_delivery_targets_scope_guard_update
BEFORE UPDATE ON line_member_delivery_targets
WHEN NOT EXISTS (
  SELECT 1 FROM line_oa_members m
  WHERE m.id=NEW.line_member_id
    AND m.workspace_id=NEW.workspace_id
    AND m.line_account_id=NEW.line_account_id
)
BEGIN SELECT RAISE(ABORT,'LINE_MEMBER_DELIVERY_TARGET_SCOPE_INVALID'); END;

CREATE TABLE IF NOT EXISTS campaign_executions (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  audience_version_no INTEGER NOT NULL CHECK(audience_version_no > 0),
  content_version_no INTEGER NOT NULL CHECK(content_version_no > 0),
  line_account_id TEXT NOT NULL,
  action_reference_hash TEXT NOT NULL CHECK(length(action_reference_hash)=64),
  status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','COMPLETED','PARTIAL_FAILED','FAILED','CANCELLED')),
  total_recipient_count INTEGER NOT NULL CHECK(total_recipient_count >= 0),
  eligible_recipient_count INTEGER NOT NULL CHECK(eligible_recipient_count >= 0),
  queued_count INTEGER NOT NULL CHECK(queued_count >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK(sent_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0),
  cancelled_count INTEGER NOT NULL DEFAULT 0 CHECK(cancelled_count >= 0),
  safe_error_code TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,audience_id,audience_version_no) REFERENCES campaign_audience_snapshots(workspace_id,audience_id,snapshot_no) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,campaign_id,content_version_no) REFERENCES campaign_content_versions(workspace_id,campaign_id,version_no) ON DELETE RESTRICT,
  FOREIGN KEY(line_account_id) REFERENCES workspace_line_accounts(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,campaign_id,audience_version_no,content_version_no,action_reference_hash),
  CHECK(total_recipient_count >= eligible_recipient_count),
  CHECK(queued_count + sent_count + failed_count + skipped_count + cancelled_count <= eligible_recipient_count)
);
CREATE INDEX IF NOT EXISTS idx_campaign_executions_history
  ON campaign_executions(workspace_id,campaign_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_executions_one_per_prepared_version
  ON campaign_executions(workspace_id,campaign_id,audience_version_no,content_version_no);CREATE TRIGGER IF NOT EXISTS campaign_executions_line_account_scope_guard_insert
BEFORE INSERT ON campaign_executions
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_line_accounts a
  WHERE a.id=NEW.line_account_id AND a.workspace_id=NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_EXECUTION_LINE_ACCOUNT_SCOPE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS campaign_executions_line_account_scope_guard_update
BEFORE UPDATE ON campaign_executions
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_line_accounts a
  WHERE a.id=NEW.line_account_id AND a.workspace_id=NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_EXECUTION_LINE_ACCOUNT_SCOPE_INVALID'); END;

-- One immutable logical recipient authority per execution. Attempt history is separate below.
CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  execution_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  audience_id TEXT NOT NULL,
  audience_version_no INTEGER NOT NULL CHECK(audience_version_no > 0),
  crm_person_id TEXT NOT NULL,
  line_member_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','SENDING','SENT','FAILED','CANCELLED','SKIPPED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1)),
  provider_retry_key TEXT NOT NULL CHECK(length(provider_retry_key)=36),
  provider_request_hash TEXT NOT NULL CHECK(length(provider_request_hash)=64),
  provider_status_code INTEGER,
  safe_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempted_at TEXT,
  succeeded_at TEXT,
  failed_at TEXT,
  FOREIGN KEY(workspace_id,execution_id) REFERENCES campaign_executions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,audience_id,audience_version_no) REFERENCES campaign_audience_snapshots(workspace_id,audience_id,snapshot_no) ON DELETE RESTRICT,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE RESTRICT,
  FOREIGN KEY(line_member_id) REFERENCES line_oa_members(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,execution_id,crm_person_id),
  UNIQUE(workspace_id,line_member_id,provider_retry_key)
);
CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_work
  ON campaign_deliveries(workspace_id,execution_id,status,retryable,attempt_count,created_at);CREATE TRIGGER IF NOT EXISTS campaign_deliveries_recipient_scope_guard_insert
BEFORE INSERT ON campaign_deliveries
WHEN NOT EXISTS (
  SELECT 1 FROM crm_people p
  WHERE p.id=NEW.crm_person_id AND p.workspace_id=NEW.workspace_id
) OR (
  NEW.line_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM line_oa_members m
    JOIN campaign_executions e ON e.id=NEW.execution_id AND e.workspace_id=NEW.workspace_id
    WHERE m.id=NEW.line_member_id
      AND m.workspace_id=NEW.workspace_id
      AND m.line_account_id=e.line_account_id
  )
)
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_DELIVERY_RECIPIENT_SCOPE_INVALID'); END;

CREATE TABLE IF NOT EXISTS campaign_delivery_attempts (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  audience_version_no INTEGER NOT NULL CHECK(audience_version_no > 0),
  attempt_no INTEGER NOT NULL CHECK(attempt_no BETWEEN 1 AND 3),
  status TEXT NOT NULL CHECK(status IN ('SENT','FAILED')),
  provider_request_hash TEXT NOT NULL CHECK(length(provider_request_hash)=64),
  provider_status_code INTEGER,
  safe_error_code TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1)),
  attempted_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id,execution_id) REFERENCES campaign_executions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,delivery_id) REFERENCES campaign_deliveries(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,delivery_id,attempt_no)
);
CREATE INDEX IF NOT EXISTS idx_campaign_delivery_attempts_history
  ON campaign_delivery_attempts(workspace_id,execution_id,delivery_id,attempt_no DESC);

CREATE TRIGGER IF NOT EXISTS campaign_executions_version_binding_immutable
BEFORE UPDATE ON campaign_executions
WHEN NEW.workspace_id<>OLD.workspace_id
  OR NEW.campaign_id<>OLD.campaign_id
  OR NEW.audience_id<>OLD.audience_id
  OR NEW.audience_version_no<>OLD.audience_version_no
  OR NEW.content_version_no<>OLD.content_version_no
  OR NEW.line_account_id<>OLD.line_account_id
  OR NEW.action_reference_hash<>OLD.action_reference_hash
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_EXECUTION_BINDING_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_deliveries_recipient_immutable
BEFORE UPDATE ON campaign_deliveries
WHEN NEW.workspace_id<>OLD.workspace_id
  OR NEW.execution_id<>OLD.execution_id
  OR NEW.campaign_id<>OLD.campaign_id
  OR NEW.audience_id<>OLD.audience_id
  OR NEW.audience_version_no<>OLD.audience_version_no
  OR NEW.crm_person_id<>OLD.crm_person_id
  OR NEW.line_member_id IS NOT OLD.line_member_id
  OR NEW.provider_retry_key<>OLD.provider_retry_key
  OR NEW.provider_request_hash<>OLD.provider_request_hash
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_DELIVERY_RECIPIENT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS campaign_deliveries_sent_terminal
BEFORE UPDATE ON campaign_deliveries
WHEN OLD.status='SENT' AND NEW.status<>'SENT'
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_DELIVERY_SENT_TERMINAL'); END;

CREATE TRIGGER IF NOT EXISTS campaign_delivery_attempts_no_update
BEFORE UPDATE ON campaign_delivery_attempts
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_DELIVERY_ATTEMPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS campaign_delivery_attempts_no_delete
BEFORE DELETE ON campaign_delivery_attempts
BEGIN SELECT RAISE(ABORT,'CAMPAIGN_DELIVERY_ATTEMPT_IMMUTABLE'); END;
