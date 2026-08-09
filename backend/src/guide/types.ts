export type GuideStatus = 'complete' | 'incomplete' | 'blocked';

export type GuideActionType = 'navigate' | 'focus' | 'open_tab' | 'select_entity' | 'none';

export type GuidePriority = 'high' | 'medium' | 'low';

export type GuideIssueSeverity = 'blocking' | 'warning';

export type GuideArea = {
  recordId: string;
  id: string;
  label: string;
  actionType: string;
  uri: string;
  text: string;
  data: string;
  displayText: string;
  targetPageId: string;
};

export type GuideContext = {
  workspaceId: string;
  userId: string;
  route: string;
  page: {
    key: 'project_detail';
    title: 'Project Detail';
  };
  workspace: {
    id: string;
    name: string;
  };
  project: {
    id: string;
    name: string;
    status: string;
    templateId: string | null;
    assetId: string | null;
    areaCount: number;
  };
  selectedArea: {
    id: string;
    label: string;
    actionType: string;
  } | null;
  areas: GuideArea[];
  lineAccount: {
    exists: boolean;
    hasBotToken: boolean;
    hasBotSecret: boolean;
    webhookEnabled: boolean;
  };
  behavior?: any;
  completeness: {
    projectHasImage: boolean;
    allAreasConfigured: boolean;
    lineAccountReady: boolean;
    hasInvalidActions: boolean;
  };
};

export type GuideIssue = {
  code: string;
  severity: GuideIssueSeverity;
  message: string;
  target: string;
};

export type GuideNextAction = {
  type: GuideActionType;
  target: string;
  message: string;
  priority: GuidePriority;
};

export type GuideEvaluation = {
  status: GuideStatus;
  currentStep: string;
  progress: {
    completed: number;
    total: 5;
    percent: number;
  };
  nextAction: GuideNextAction;
  issues: GuideIssue[];
  recommendations: string[];
};

export type GuideWorkflowStatus = 'in_progress' | 'complete';

export type GuideWorkflowStepStatus = 'pending' | 'active' | 'complete' | 'blocked';

export type GuideWorkflowStepId =
  | 'PROJECT_IMAGE'
  | 'PROJECT_ACTIONS'
  | 'LINE_ACCOUNT'
  | 'LINE_BOT_TOKEN'
  | 'BASIC_VALIDATION';

export type GuideWorkflowStepDefinition = {
  id: GuideWorkflowStepId;
  title: string;
  optional: boolean;
  issueCodes: string[];
};

export type GuideWorkflowDefinition = {
  id: string;
  title: string;
  steps: GuideWorkflowStepDefinition[];
};

export type GuideWorkflowStep = GuideWorkflowStepDefinition & {
  status: GuideWorkflowStepStatus;
  action: GuideNextAction;
};

export type GuideWorkflow = {
  id: string;
  title: string;
  status: GuideWorkflowStatus;
  currentStepId: GuideWorkflowStepId;
  progress: {
    completed: number;
    total: number;
    percent: number;
  };
  steps: GuideWorkflowStep[];
  message: string;
};

export type BuildGuideContextInput = {
  db: D1Database;
  workspaceId: string;
  userId: string;
  route: string;
  entityType: 'project';
  entityId: string;
  selectedAreaId?: string;
};
