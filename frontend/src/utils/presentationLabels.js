const byKey = (map, value, fallback = '未提供') => map[String(value || '').toUpperCase()] || fallback;

const status = {
  ACTIVE: '啟用中', INACTIVE: '停用中', ARCHIVED: '已封存', PENDING: '待處理',
  OPEN: '進行中', COMPLETED: '已完成', CANCELLED: '已取消', FAILED: '失敗',
  DRAFT: '草稿', REVIEWED: '已審閱', REJECTED: '已拒絕', SUPERSEDED: '已取代',
};
const role = { OWNER: '擁有者', ADMIN: '管理員', EDITOR: '編輯者', VIEWER: '檢視者' };
const source = {
  LINE_ORGANIC: 'LINE 自然加入', KEYWORD: '關鍵字', RICH_MENU: '圖文選單', QR: 'QR Code',
  LINE_SHARE: 'LINE 分享', REFERRAL_SHARE: '推薦分享', PERSONAL_CARD_SHARE: '個人名片分享',
  EVENT: '活動', CSV_IMPORT: 'CSV 匯入', XLSX_IMPORT: 'Excel 匯入', OCR_IMPORT: '名片 OCR', API_IMPORT: 'API 匯入',
};
const operator = { EQ: '等於', NEQ: '不等於', IN: '包含於', NOT_IN: '不包含於', IS_TRUE: '是', IS_FALSE: '否', BEFORE: '早於', AFTER: '晚於' };
const zodiac = { ARIES: '牡羊座', TAURUS: '金牛座', GEMINI: '雙子座', CANCER: '巨蟹座', LEO: '獅子座', VIRGO: '處女座', LIBRA: '天秤座', SCORPIO: '天蠍座', SAGITTARIUS: '射手座', CAPRICORN: '摩羯座', AQUARIUS: '水瓶座', PISCES: '雙魚座' };

export const labelStatus = (value) => byKey(status, value);
export const labelRole = (value) => byKey(role, value);
export const labelAcquisitionSource = (value) => byKey(source, value);
export const labelSegmentOperator = (value) => byKey(operator, value);
export const labelZodiac = (value) => byKey(zodiac, value);
