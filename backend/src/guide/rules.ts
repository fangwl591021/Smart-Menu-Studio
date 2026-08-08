import type {
  GuideArea,
  GuideContext,
  GuideEvaluation,
  GuideIssue,
  GuideNextAction,
} from './types.ts';

const configuredActionTypes = new Set(['uri', 'message', 'postback', 'richmenuswitch']);

const areaTarget = (area: GuideArea, field: string) => `project-area-${area.id}-${field}`;

function actionIssue(area: GuideArea): GuideIssue | null {
  if (!configuredActionTypes.has(area.actionType)) {
    return {
      code: 'PROJECT_AREA_ACTION_INCOMPLETE',
      severity: 'warning',
      message: `「${area.label}」尚未設定動作。`,
      target: areaTarget(area, 'action-type'),
    };
  }

  if (area.actionType === 'uri' && !area.uri) {
    return {
      code: 'ACTION_URI_MISSING',
      severity: 'warning',
      message: `「${area.label}」尚未設定網址。`,
      target: areaTarget(area, 'uri'),
    };
  }

  if (area.actionType === 'message' && !area.text) {
    return {
      code: 'ACTION_MESSAGE_MISSING',
      severity: 'warning',
      message: `「${area.label}」尚未設定訊息文字。`,
      target: areaTarget(area, 'message'),
    };
  }

  if (area.actionType === 'postback' && !area.data) {
    return {
      code: 'ACTION_POSTBACK_DATA_MISSING',
      severity: 'warning',
      message: `「${area.label}」尚未設定 Postback data。`,
      target: areaTarget(area, 'postback-data'),
    };
  }

  if (area.actionType === 'richmenuswitch' && !area.targetPageId) {
    return {
      code: 'ACTION_SWITCH_TARGET_MISSING',
      severity: 'warning',
      message: `「${area.label}」尚未選擇切換目標。`,
      target: areaTarget(area, 'switch-target'),
    };
  }

  return null;
}

function focusAction(issue: GuideIssue): GuideNextAction {
  return {
    type: 'focus',
    target: issue.target,
    message: issue.code === 'PROJECT_IMAGE_MISSING'
      ? '請先設定 Rich Menu 圖片。'
      : '還有區域尚未設定動作。',
    priority: issue.severity === 'blocking' ? 'high' : 'medium',
  };
}

export function evaluateGuide(context: GuideContext): GuideEvaluation {
  const issues: GuideIssue[] = [];

  if (!context.completeness.projectHasImage) {
    issues.push({
      code: 'PROJECT_IMAGE_MISSING',
      severity: 'blocking',
      message: '此專案尚未設定 Rich Menu 圖片。',
      target: 'project-image',
    });
  }

  const areaIssues = context.areas.map(actionIssue).filter((issue): issue is GuideIssue => Boolean(issue));
  if (!context.areas.length) {
    areaIssues.push({
      code: 'PROJECT_AREA_ACTION_INCOMPLETE',
      severity: 'warning',
      message: '此專案尚未建立可設定的區域。',
      target: 'project-areas',
    });
  } else if (areaIssues.length && !areaIssues.some(issue => issue.code === 'PROJECT_AREA_ACTION_INCOMPLETE')) {
    areaIssues.unshift({
      code: 'PROJECT_AREA_ACTION_INCOMPLETE',
      severity: 'warning',
      message: '還有區域尚未完成動作設定。',
      target: areaIssues[0].target,
    });
  }
  issues.push(...areaIssues);

  if (!context.lineAccount.exists) {
    issues.push({
      code: 'LINE_ACCOUNT_MISSING',
      severity: 'warning',
      message: '尚未設定 LINE Official Account。',
      target: 'line-account-settings',
    });
  } else if (!context.lineAccount.hasBotToken) {
    issues.push({
      code: 'LINE_BOT_TOKEN_MISSING',
      severity: 'warning',
      message: 'LINE Bot Channel Access Token 尚未設定。',
      target: 'line-account-settings',
    });
  }

  const progressChecks = [
    context.completeness.projectHasImage,
    context.completeness.allAreasConfigured,
    context.lineAccount.exists,
    context.lineAccount.hasBotToken,
    !context.completeness.hasInvalidActions,
  ];
  const completed = progressChecks.filter(Boolean).length;
  const progress = { completed, total: 5 as const, percent: completed * 20 };

  const blockingIssue = issues.find(issue => issue.severity === 'blocking');
  if (blockingIssue) {
    return {
      status: 'blocked',
      currentStep: 'project_image',
      progress,
      nextAction: focusAction(blockingIssue),
      issues,
      recommendations: ['完成阻塞項目後，Smart Guide 會重新評估下一步。'],
    };
  }

  const firstAreaIssue = areaIssues.find(issue => issue.code !== 'PROJECT_AREA_ACTION_INCOMPLETE') || areaIssues[0];
  if (firstAreaIssue) {
    return {
      status: 'incomplete',
      currentStep: 'project_actions',
      progress,
      nextAction: focusAction(firstAreaIssue),
      issues,
      recommendations: ['先完成第一個未設定區域，再依序處理其餘區域。'],
    };
  }

  const lineIssue = issues.find(issue => issue.code === 'LINE_ACCOUNT_MISSING' || issue.code === 'LINE_BOT_TOKEN_MISSING');
  if (lineIssue) {
    return {
      status: 'incomplete',
      currentStep: lineIssue.code === 'LINE_ACCOUNT_MISSING' ? 'line_account' : 'bot_token',
      progress,
      nextAction: {
        type: 'navigate',
        target: 'line-hub',
        message: lineIssue.code === 'LINE_ACCOUNT_MISSING'
          ? '請先設定 LINE Official Account。'
          : '請前往 LINE 設定補上 Bot Token。',
        priority: 'high',
      },
      issues,
      recommendations: ['Guide 只會帶你前往設定頁，不會自動填入或修改憑證。'],
    };
  }

  return {
    status: 'complete',
    currentStep: 'basic_setup_complete',
    progress,
    nextAction: {
      type: 'none',
      target: '',
      message: '基本設定已完成，可進行下一階段檢查。',
      priority: 'low',
    },
    issues: [],
    recommendations: ['基本設定已完成，可進行下一階段檢查。'],
  };
}
