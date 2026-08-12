export const commissionSourceLabel = source => source?.sourceDomain === 'TRAVEL'
  ? '來源：旅遊報名'
  : source?.attributionSource === 'REFERRAL_EVIDENCE'
    ? '推薦證據'
    : '已驗證歸因來源';

export const commissionSourceKey = source => `${source?.attributionSource || 'UNKNOWN'}:${source?.sourceDomain === 'TRAVEL' ? 'TRAVEL' : 'DEFAULT'}`;
