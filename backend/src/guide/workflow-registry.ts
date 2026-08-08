import type { GuideWorkflowDefinition, GuideWorkflowStepId } from './types.ts';

export const RICH_MENU_PROJECT_SETUP_WORKFLOW_ID = 'rich-menu-project-setup' as const;

export const GUIDE_WORKFLOWS: Record<string, GuideWorkflowDefinition> = {
  [RICH_MENU_PROJECT_SETUP_WORKFLOW_ID]: {
    id: RICH_MENU_PROJECT_SETUP_WORKFLOW_ID,
    title: '圖文選單設定',
    steps: [
      {
        id: 'PROJECT_IMAGE',
        title: '設定選單圖片',
        optional: false,
        issueCodes: ['PROJECT_IMAGE_MISSING'],
      },
      {
        id: 'PROJECT_ACTIONS',
        title: '設定區域動作',
        optional: false,
        issueCodes: [
          'PROJECT_AREA_ACTION_INCOMPLETE',
          'ACTION_URI_MISSING',
          'ACTION_MESSAGE_MISSING',
          'ACTION_POSTBACK_DATA_MISSING',
          'ACTION_SWITCH_TARGET_MISSING',
        ],
      },
      {
        id: 'LINE_ACCOUNT',
        title: '連接 LINE Official Account',
        optional: false,
        issueCodes: ['LINE_ACCOUNT_MISSING'],
      },
      {
        id: 'LINE_BOT_TOKEN',
        title: '設定 Messaging API Bot Token',
        optional: false,
        issueCodes: ['LINE_BOT_TOKEN_MISSING'],
      },
      {
        id: 'BASIC_VALIDATION',
        title: '完成基本檢查',
        optional: false,
        issueCodes: [],
      },
    ],
  },
};

export const ISSUE_TO_WORKFLOW_STEP = Object.fromEntries(
  GUIDE_WORKFLOWS[RICH_MENU_PROJECT_SETUP_WORKFLOW_ID].steps.flatMap(step =>
    step.issueCodes.map(code => [code, step.id]),
  ),
) as Record<string, GuideWorkflowStepId>;
