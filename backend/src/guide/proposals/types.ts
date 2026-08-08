export type ProposalType =
  | 'postback-display-text'
  | 'https-upgrade-candidate'
  | 'duplicate-message-review'
  | 'duplicate-postback-review'
  | 'multi-page-structure-draft';

export type ProposalAvailability = {
  available: boolean;
  type: ProposalType | null;
};

export type SafeProposalValue = string | number | boolean | null;

export type ProposalChange = {
  id: string;
  entityType: 'project' | 'project_area';
  entityId: string;
  field: string;
  operation: 'replace' | 'set';
  before: SafeProposalValue;
  after: SafeProposalValue;
  reason: string;
};

export type ProposalWarning = {
  code: string;
  message: string;
};

export type Proposal = {
  id: string;
  recommendationId: string;
  ruleCode: string;
  workspaceId: string;
  projectId: string;
  status: 'preview';
  title: string;
  summary: string;
  changes: ProposalChange[];
  warnings: ProposalWarning[];
  generatedBy: 'rule' | 'rule+ai';
  canApply: false;
};
