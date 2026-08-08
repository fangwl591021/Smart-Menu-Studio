PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO workspaces (
  id, name, slug, status, plan
) VALUES (
  'ws_test_b',
  'Test Workspace B',
  'test-workspace-b',
  'active',
  'starter'
);

INSERT OR IGNORE INTO users (
  id, username, email, display_name, status
) VALUES (
  'usr_test_b_owner',
  'test-b-owner',
  'test-b-owner@local.invalid',
  'Workspace B Owner',
  'active'
);

INSERT OR IGNORE INTO workspace_members (
  id, workspace_id, user_id, role, status
) VALUES (
  'wsm_test_b_owner',
  'ws_test_b',
  'usr_test_b_owner',
  'owner',
  'active'
);