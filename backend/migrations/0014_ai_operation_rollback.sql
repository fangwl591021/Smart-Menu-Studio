PRAGMA foreign_keys = ON;

ALTER TABLE ai_operation_logs
ADD COLUMN reverts_operation_id TEXT;

ALTER TABLE ai_operation_logs
ADD COLUMN root_operation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_operation_logs_reverts_operation
ON ai_operation_logs(reverts_operation_id);

CREATE INDEX IF NOT EXISTS idx_ai_operation_logs_root_created
ON ai_operation_logs(root_operation_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_operation_logs_one_successful_rollback
ON ai_operation_logs(reverts_operation_id)
WHERE reverts_operation_id IS NOT NULL AND status = 'succeeded';
