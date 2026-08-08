import type { GuideArea, GuideContext } from '../types.ts';
import type { RecommendationCandidate, RecommendationRule } from './types.ts';

const actionTarget = (area: GuideArea, field: string) => `project-area-${area.id}-${field}`;

const projectCandidate = (
  context: GuideContext,
  candidate: Omit<RecommendationCandidate, 'stableKey' | 'entityType' | 'entityId'>,
): RecommendationCandidate => ({
  ...candidate,
  stableKey: context.project.id,
  entityType: 'project',
  entityId: context.project.id,
});

const actionCounts = (areas: GuideArea[]) => ({
  uri: areas.filter(area => area.actionType === 'uri').length,
  message: areas.filter(area => area.actionType === 'message').length,
  postback: areas.filter(area => area.actionType === 'postback').length,
  richmenuswitch: areas.filter(area => area.actionType === 'richmenuswitch').length,
});

const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return {
      protocol: url.protocol.toLowerCase(),
      hostname: url.hostname.toLowerCase(),
      publicPath: `${url.origin}${url.pathname}`,
    };
  } catch {
    return null;
  }
};

const duplicateGroups = (areas: GuideArea[], valueOf: (area: GuideArea) => string) => {
  const groups = new Map<string, GuideArea[]>();
  for (const area of areas) {
    const value = valueOf(area).trim();
    if (!value) continue;
    const members = groups.get(value) || [];
    members.push(area);
    groups.set(value, members);
  }
  return [...groups.entries()].filter(([, members]) => members.length >= 2);
};

const labelsMessage = (areas: GuideArea[]) => areas.map(area => `「${area.label}」`).join('與');

const R001: RecommendationRule = {
  code: 'R001',
  order: 1,
  evaluate(context) {
    const counts = actionCounts(context.areas);
    if (
      context.areas.length < 3
      || counts.uri !== context.areas.length
      || !context.completeness.allAreasConfigured
      || context.completeness.hasInvalidActions
    ) return [];
    return [projectCandidate(context, {
      category: 'engagement',
      priority: 'medium',
      title: '互動方式較單一',
      message: '目前所有選單入口都會開啟網址，可評估將部分功能改為文字訊息或 Postback，讓使用者留在 LINE 內完成更多操作。',
      reason: '所有有效區域目前都使用 URI Action。',
      target: 'project-areas',
      suggestedAction: { type: 'review', target: 'project-areas' },
      evidence: [
        { key: 'areaCount', value: context.areas.length },
        { key: 'uriCount', value: counts.uri },
        { key: 'messageCount', value: counts.message },
        { key: 'postbackCount', value: counts.postback },
      ],
    })];
  },
};

const R002: RecommendationRule = {
  code: 'R002',
  order: 2,
  evaluate(context) {
    const counts = actionCounts(context.areas);
    if (
      context.areas.length < 3
      || counts.message
      || counts.postback
      || counts.richmenuswitch
      || !context.completeness.allAreasConfigured
      || context.completeness.hasInvalidActions
    ) return [];
    return [projectCandidate(context, {
      category: 'engagement',
      priority: 'medium',
      title: '尚未使用 LINE 互動 Action',
      message: '可評估加入 Message、Postback 或切換頁 Action，增加 LINE 內互動。',
      reason: '目前 Rich Menu 主要作為外部連結入口。',
      target: 'project-areas',
      suggestedAction: { type: 'review', target: 'project-areas' },
      evidence: [
        { key: 'areaCount', value: context.areas.length },
        { key: 'messageCount', value: counts.message },
        { key: 'postbackCount', value: counts.postback },
        { key: 'richMenuSwitchCount', value: counts.richmenuswitch },
      ],
    })];
  },
};

const R003: RecommendationRule = {
  code: 'R003',
  order: 3,
  evaluate(context) {
    const counts = actionCounts(context.areas);
    if (context.areas.length < 6 || counts.richmenuswitch > 0) return [];
    return [projectCandidate(context, {
      category: 'navigation',
      priority: 'medium',
      title: '可評估多頁選單',
      message: '目前首頁入口較多，可評估將次要功能整理至第二頁，降低單頁資訊密度。',
      reason: '此專案有較多入口，但目前沒有使用切換頁 Action。',
      evidence: [
        { key: 'areaCount', value: context.areas.length },
        { key: 'richMenuSwitchCount', value: counts.richmenuswitch },
      ],
      suggestedAction: { type: 'none' },
    })];
  },
};

const R004: RecommendationRule = {
  code: 'R004',
  order: 4,
  evaluate(context) {
    if (context.areas.length < 8) return [];
    return [projectCandidate(context, {
      category: 'structure',
      priority: 'high',
      title: '單頁功能較密集',
      message: '目前這張 Rich Menu 有較多可點擊區域，建議檢查按鈕辨識度與功能分組。',
      reason: '單頁互動區域達到 Smart Menu Studio 的密度提醒門檻。',
      target: 'project-areas',
      suggestedAction: { type: 'review', target: 'project-areas' },
      evidence: [{ key: 'areaCount', value: context.areas.length }],
    })];
  },
};

const R005: RecommendationRule = {
  code: 'R005',
  order: 5,
  evaluate(context) {
    return duplicateGroups(
      context.areas.filter(area => area.actionType === 'uri'),
      area => area.uri,
    ).map(([uri, areas]) => {
      const parsed = safeUrl(uri);
      return {
        stableKey: areas.map(area => area.id).sort().join('|'),
        category: 'maintainability',
        priority: 'low',
        title: '多個區域使用相同網址',
        message: `${labelsMessage(areas)}目前導向相同網址，請確認是否為預期設定。`,
        reason: '重複入口可能是刻意配置，也可能增加後續維護成本。',
        entityType: 'project_area',
        entityId: areas[0].id,
        target: actionTarget(areas[0], 'uri'),
        suggestedAction: { type: 'focus', target: actionTarget(areas[0], 'uri') },
        evidence: [
          { key: 'areaLabels', value: areas.map(area => area.label).join('、') },
          { key: 'duplicateCount', value: areas.length },
          { key: 'uriPath', value: parsed?.publicPath || '無法解析的網址' },
        ],
      };
    });
  },
};

const R006: RecommendationRule = {
  code: 'R006',
  order: 6,
  evaluate(context) {
    return duplicateGroups(
      context.areas.filter(area => area.actionType === 'message'),
      area => area.text,
    ).map(([text, areas]) => ({
      stableKey: areas.map(area => area.id).sort().join('|'),
      category: 'maintainability',
      priority: 'low',
      title: '多個區域傳送相同文字',
      message: `${labelsMessage(areas)}目前傳送相同文字，請確認是否為刻意配置。`,
      reason: '相同文字可能讓不同入口的用途不易區分。',
      entityType: 'project_area',
      entityId: areas[0].id,
      target: actionTarget(areas[0], 'message'),
      suggestedAction: { type: 'focus', target: actionTarget(areas[0], 'message') },
      evidence: [
        { key: 'areaLabels', value: areas.map(area => area.label).join('、') },
        { key: 'duplicateCount', value: areas.length },
        { key: 'messageLength', value: text.length },
      ],
    }));
  },
};

const R007: RecommendationRule = {
  code: 'R007',
  order: 7,
  evaluate(context) {
    return duplicateGroups(
      context.areas.filter(area => area.actionType === 'postback'),
      area => area.data,
    ).map(([data, areas]) => ({
      stableKey: areas.map(area => area.id).sort().join('|'),
      category: 'maintainability',
      priority: 'medium',
      title: '多個 Postback 使用相同 Data',
      message: `${labelsMessage(areas)}目前使用相同 Postback Data，請確認下游流程是否需要區分點擊來源。`,
      reason: '相同 Data 可能讓 downstream routing 無法辨識不同入口。',
      entityType: 'project_area',
      entityId: areas[0].id,
      target: actionTarget(areas[0], 'postback-data'),
      suggestedAction: { type: 'focus', target: actionTarget(areas[0], 'postback-data') },
      evidence: [
        { key: 'areaLabels', value: areas.map(area => area.label).join('、') },
        { key: 'duplicateCount', value: areas.length },
        { key: 'hasPostbackData', value: true },
      ],
    }));
  },
};

const R008: RecommendationRule = {
  code: 'R008',
  order: 8,
  evaluate(context) {
    return context.areas.flatMap(area => {
      if (area.actionType !== 'uri') return [];
      const parsed = safeUrl(area.uri);
      if (parsed?.protocol !== 'http:') return [];
      return [{
        stableKey: area.id,
        category: 'maintainability',
        priority: 'high',
        title: '網址未使用 HTTPS',
        message: '建議確認服務是否支援 HTTPS，以降低傳輸與導頁風險。',
        reason: `「${area.label}」目前使用 HTTP 網址。`,
        entityType: 'project_area',
        entityId: area.id,
        target: actionTarget(area, 'uri'),
        suggestedAction: { type: 'focus', target: actionTarget(area, 'uri') },
        evidence: [
          { key: 'areaLabel', value: area.label },
          { key: 'uriHost', value: parsed.hostname },
          { key: 'uriPath', value: parsed.publicPath },
          { key: 'usesHttps', value: false },
        ],
      }];
    });
  },
};

const LONG_MESSAGE_HEURISTIC = 100;

const R009: RecommendationRule = {
  code: 'R009',
  order: 9,
  evaluate(context) {
    return context.areas.flatMap(area => {
      // Smart Menu Studio UX heuristic, not a LINE Messaging API hard limit.
      if (area.actionType !== 'message' || area.text.length <= LONG_MESSAGE_HEURISTIC) return [];
      return [{
        stableKey: area.id,
        category: 'engagement',
        priority: 'low',
        title: '訊息內容較長',
        message: '此點擊訊息較長，可評估精簡內容，讓使用者更快理解下一步。',
        reason: `「${area.label}」的 Message Action 超過 ${LONG_MESSAGE_HEURISTIC} 字 UX 提醒門檻。`,
        entityType: 'project_area',
        entityId: area.id,
        target: actionTarget(area, 'message'),
        suggestedAction: { type: 'focus', target: actionTarget(area, 'message') },
        evidence: [
          { key: 'areaLabel', value: area.label },
          { key: 'messageLength', value: area.text.length },
          { key: 'heuristicThreshold', value: LONG_MESSAGE_HEURISTIC },
        ],
      }];
    });
  },
};

const R010: RecommendationRule = {
  code: 'R010',
  order: 10,
  evaluate(context) {
    return context.areas.flatMap(area => {
      if (area.actionType !== 'postback' || !area.data || area.displayText) return [];
      return [{
        stableKey: area.id,
        category: 'engagement',
        priority: 'low',
        title: 'Postback 沒有顯示文字',
        message: '若希望使用者點擊後在聊天室看到操作文字，可設定顯示文字。',
        reason: `「${area.label}」已有 Postback Data，但未設定 optional displayText。`,
        entityType: 'project_area',
        entityId: area.id,
        target: actionTarget(area, 'postback-data'),
        suggestedAction: { type: 'focus', target: actionTarget(area, 'postback-data') },
        evidence: [
          { key: 'areaLabel', value: area.label },
          { key: 'hasPostbackData', value: true },
          { key: 'hasDisplayText', value: false },
        ],
      }];
    });
  },
};

const R011: RecommendationRule = {
  code: 'R011',
  order: 11,
  evaluate(context) {
    const uriAreas = context.areas.filter(area => area.actionType === 'uri');
    const hostnames = new Set(uriAreas.map(area => safeUrl(area.uri)?.hostname).filter(Boolean));
    if (uriAreas.length < 3 || hostnames.size < 3) return [];
    return [projectCandidate(context, {
      category: 'maintainability',
      priority: 'low',
      title: '選單導向多個外部網域',
      message: '建議確認品牌一致性、使用者是否會頻繁離開 LINE，以及各網站是否都由可信來源維護。',
      reason: '選單中的 URI Action 導向三個以上不同 hostname。',
      target: 'project-areas',
      suggestedAction: { type: 'review', target: 'project-areas' },
      evidence: [
        { key: 'uriCount', value: uriAreas.length },
        { key: 'domainCount', value: hostnames.size },
      ],
    })];
  },
};

const R012: RecommendationRule = {
  code: 'R012',
  order: 12,
  evaluate(context) {
    const counts = actionCounts(context.areas);
    const onlyExternalOrSwitch = context.areas.every(area =>
      area.actionType === 'uri' || area.actionType === 'richmenuswitch');
    if (
      context.areas.length < 4
      || !onlyExternalOrSwitch
      || counts.message
      || counts.postback
      || !context.completeness.allAreasConfigured
      || context.completeness.hasInvalidActions
    ) return [];
    return [projectCandidate(context, {
      category: 'conversion',
      priority: 'low',
      title: '缺少 LINE 內轉換入口',
      message: '目前沒有 Message 或 Postback 類型的入口；若此選單有諮詢、預約、加入會員等目標，可評估加入 LINE 內互動流程。',
      reason: '目前只使用 URI 或切換頁 Action，未配置 Message 或 Postback。',
      target: 'project-areas',
      suggestedAction: { type: 'review', target: 'project-areas' },
      evidence: [
        { key: 'areaCount', value: context.areas.length },
        { key: 'messageCount', value: counts.message },
        { key: 'postbackCount', value: counts.postback },
      ],
    })];
  },
};

export const RECOMMENDATION_RULES: RecommendationRule[] = [
  R001, R002, R003, R004, R005, R006,
  R007, R008, R009, R010, R011, R012,
];
