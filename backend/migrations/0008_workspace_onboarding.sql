PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug_active
ON workspaces(slug)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_status
ON users(status);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_status
ON workspace_members(workspace_id, status);