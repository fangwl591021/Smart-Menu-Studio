import type {
  GuideContext,
  GuideEvaluation,
  GuideNextAction,
  GuideWorkflow,
  GuideWorkflowStep,
  GuideWorkflowStepId,
} from './types.ts';
import {
  GUIDE_WORKFLOWS,
  ISSUE_TO_WORKFLOW_STEP,
  RICH_MENU_PROJECT_SETUP_WORKFLOW_ID,
} from './workflow-registry.ts';

const noAction = (message = ''): GuideNextAction => ({
  type: 'none',
  target: '',
  message,
  priority: 'low',
});

function completionByStep(context: GuideContext, guide: GuideEvaluation): Record<GuideWorkflowStepId, boolean> {
  const actionsValid = context.completeness.allAreasConfigured && !context.completeness.hasInvalidActions;
  const basicValidation = context.completeness.projectHasImage
    && actionsValid
    && context.lineAccount.exists
    && context.lineAccount.hasBotToken
    && !guide.issues.some(issue => issue.severity === 'blocking');

  return {
    PROJECT_IMAGE: context.completeness.projectHasImage,
    PROJECT_ACTIONS: actionsValid,
    LINE_ACCOUNT: context.lineAccount.exists,
    LINE_BOT_TOKEN: context.lineAccount.hasBotToken,
    BASIC_VALIDATION: basicValidation,
  };
}

export function buildGuideWorkflow(
  context: GuideContext,
  guide: GuideEvaluation,
  workflowId = RICH_MENU_PROJECT_SETUP_WORKFLOW_ID,
): GuideWorkflow {
  const definition = GUIDE_WORKFLOWS[workflowId];
  if (!definition) throw new Error(`Unknown guide workflow: ${workflowId}`);

  const completion = completionByStep(context, guide);
  const firstIncompleteIndex = definition.steps.findIndex(step => !completion[step.id]);
  const workflowComplete = firstIncompleteIndex === -1;
  const currentStepIndex = workflowComplete ? definition.steps.length - 1 : firstIncompleteIndex;
  const currentStepId = definition.steps[currentStepIndex].id;
  const guideIssueStepId = guide.issues
    .map(issue => ISSUE_TO_WORKFLOW_STEP[issue.code])
    .find(Boolean);

  const steps: GuideWorkflowStep[] = definition.steps.map((step, index) => {
    const isComplete = completion[step.id];
    const isCurrent = index === currentStepIndex;
    const status = isComplete
      ? 'complete'
      : isCurrent && step.id === 'PROJECT_IMAGE'
        ? 'blocked'
        : isCurrent
          ? 'active'
          : 'pending';

    return {
      ...step,
      status,
      action: isCurrent && !workflowComplete && (!guideIssueStepId || guideIssueStepId === step.id)
        ? guide.nextAction
        : noAction(isComplete ? `${step.title}已完成。` : ''),
    };
  });

  const completed = steps.filter(step => step.status === 'complete').length;

  return {
    id: definition.id,
    title: definition.title,
    status: workflowComplete ? 'complete' : 'in_progress',
    currentStepId,
    progress: {
      completed,
      total: steps.length,
      percent: Math.round((completed / steps.length) * 100),
    },
    steps,
    message: workflowComplete
      ? '圖文選單基本設定已完成。'
      : steps[currentStepIndex].action.message,
  };
}
