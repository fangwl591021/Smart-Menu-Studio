export type GuideStatus = 'complete' | 'incomplete' | 'blocked';

export type GuideActionType = 'navigate' | 'focus' | 'open_tab' | 'select_entity' | 'none';

export type GuidePriority = 'high' | 'medium' | 'low';

export type GuideIssueSeverity = 'blocking' | 'warning';

export type GuideArea = {
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

export type BuildGuideContextInput = {
  db: D1Database;
  workspaceId: string;
  userId: string;
  route: string;
  entityType: 'project';
  entityId: string;
  selectedAreaId?: string;
};
