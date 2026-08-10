-- 0040 CRM pipeline stages and tenant-only follow-up workflow. Additive only.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stage_category TEXT NOT NULL CHECK(stage_category IN ('OPEN','WON','LOST')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id,stage_key)
);
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_stages_workspace ON crm_pipeline_stages(workspace_id,status,sort_order,name);

CREATE TABLE IF NOT EXISTS crm_person_stage_assignments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  crm_pipeline_stage_id TEXT NOT NULL,
  assigned_by_user_id TEXT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_pipeline_stage_id) REFERENCES crm_pipeline_stages(id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,crm_person_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_person_stage_assignment_stage ON crm_person_stage_assignments(workspace_id,crm_pipeline_stage_id);

CREATE TABLE IF NOT EXISTS crm_person_stage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  from_stage_id TEXT,
  to_stage_id TEXT NOT NULL,
  actor_user_id TEXT,
  reason TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY(from_stage_id) REFERENCES crm_pipeline_stages(id) ON DELETE RESTRICT,
  FOREIGN KEY(to_stage_id) REFERENCES crm_pipeline_stages(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_crm_person_stage_events_history ON crm_person_stage_events(workspace_id,crm_person_id,occurred_at DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS crm_person_stage_events_no_update BEFORE UPDATE ON crm_person_stage_events BEGIN SELECT RAISE(ABORT,'CRM_STAGE_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS crm_person_stage_events_no_delete BEFORE DELETE ON crm_person_stage_events BEGIN SELECT RAISE(ABORT,'CRM_STAGE_EVENT_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS crm_follow_up_tasks (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  crm_person_id TEXT NOT NULL,
  assigned_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED','CANCELLED')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_person_id) REFERENCES crm_people(id) ON DELETE CASCADE,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_crm_follow_up_tasks_person ON crm_follow_up_tasks(workspace_id,crm_person_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_crm_follow_up_tasks_assignee ON crm_follow_up_tasks(workspace_id,assigned_user_id,status,due_at);

CREATE TABLE IF NOT EXISTS crm_follow_up_task_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  crm_follow_up_task_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('CREATED','REASSIGNED','COMPLETED','CANCELLED')),
  actor_user_id TEXT,
  outcome TEXT,
  note TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(crm_follow_up_task_id) REFERENCES crm_follow_up_tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crm_follow_up_task_events_history ON crm_follow_up_task_events(workspace_id,crm_follow_up_task_id,occurred_at DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS crm_follow_up_task_events_no_update BEFORE UPDATE ON crm_follow_up_task_events BEGIN SELECT RAISE(ABORT,'CRM_FOLLOW_UP_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS crm_follow_up_task_events_no_delete BEFORE DELETE ON crm_follow_up_task_events BEGIN SELECT RAISE(ABORT,'CRM_FOLLOW_UP_EVENT_IMMUTABLE'); END;
