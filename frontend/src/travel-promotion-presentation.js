export const TRAVEL_PROMOTION_FORMATS = Object.freeze([
  { value: 'SINGLE', label: '單張', min: 1, max: 1 },
  { value: 'CAROUSEL', label: '輪播', min: 2, max: 10 },
  { value: 'LIST', label: '列表', min: 2, max: 10 },
  { value: 'TRAVEL_4_GRID', label: '四格', min: 4, max: 4 },
  { value: 'TRAVEL_6_GRID', label: '六宮格', min: 6, max: 6 },
]);

const STATUS_LABELS = Object.freeze({ DRAFT: '草稿', ACTIVE: '使用中', ARCHIVED: '已封存' });

export const canManageTravelPromotions = role => ['owner', 'admin'].includes(String(role || '').toLowerCase());

export function travelPromotionStatusLabel(promotion) {
  if (promotion?.status === 'ACTIVE' && promotion?.isExpired === true) return '已過期';
  return STATUS_LABELS[promotion?.status] || '未知狀態';
}

export function travelPromotionFormat(value) {
  return TRAVEL_PROMOTION_FORMATS.find(item => item.value === value) || TRAVEL_PROMOTION_FORMATS[0];
}

export function isTravelPromotionFormatCountValid(format, count) {
  const contract = travelPromotionFormat(format);
  return Number.isInteger(count) && count >= contract.min && count <= contract.max;
}

export function travelPromotionFormatCountHint(format) {
  const contract = travelPromotionFormat(format);
  return contract.min === contract.max ? `請選擇 ${contract.min} 份素材。` : `請選擇 ${contract.min}–${contract.max} 份素材。`;
}

export function travelPromotionUiAuthority({ travelEnabled, campaignEnabled }) {
  const travelAvailable = travelEnabled === true;
  return Object.freeze({
    travelAvailable,
    previewAvailable: travelAvailable,
    campaignHandoffAvailable: travelAvailable && campaignEnabled === true,
  });
}

export function travelPromotionErrorMessage(code) {
  const labels = {
    TRAVEL_PROMOTION_AI_DISABLED: '此工作區尚未啟用 AI 功能。',
    MODULE_NOT_ENABLED: '此工作區尚未啟用此功能模組。',
    MODULE_DEPENDENCY_NOT_ENABLED: '此工作區尚未啟用此功能模組。',
    TRAVEL_PROMOTION_NOT_FOUND: '找不到此推廣素材。',
    TRAVEL_PROMOTION_NOT_AVAILABLE: '此推廣素材已過期。',
    TRAVEL_PROMOTION_ALREADY_ARCHIVED: '此推廣素材已封存。',
    TRAVEL_PROMOTION_COMPOSE_COUNT_INVALID: '目前選取的素材數量不符合此格式。',
    TRAVEL_PROMOTION_FORMAL_LINK_INPUT_INVALID: '無法連結指定的正式行程。',
    TRAVEL_PROMOTION_FORMAL_LINK_TARGET_NOT_FOUND: '無法連結指定的正式行程。',
    TRAVEL_PROMOTION_FORMAL_LINK_TARGET_MISMATCH: '無法連結指定的正式行程。',
    TRAVEL_PROMOTION_SOURCE_REQUIRED: '請上傳 DM 圖片或貼上 DM 文字。',
    TRAVEL_PROMOTION_HIGH_RISK_CONTENT: '請移除身分證、護照、健康或金融個資後再試。',
    CAMPAIGN_NAME_REQUIRED: '請輸入活動名稱。',
    CAMPAIGN_NAME_CONFLICT: '已有相同名稱的活動。',
  };
  return labels[code] || '操作未完成，請稍後再試。';
}

export const promotionListText = value => Array.isArray(value) ? value.join('\n') : '';
export const parsePromotionListText = (value, maximum) => String(value || '').split(/\r?\n/u).map(item => item.trim()).filter(Boolean).slice(0, maximum);

export function formatPromotionDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
