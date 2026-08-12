export const canManageTravelSellerPermissions = role => ['owner', 'admin'].includes(role);

export const travelSellerStatusLabel = status => ({
  ACTIVE: '啟用',
  REVOKED: '已撤銷',
  NOT_GRANTED: '未啟用',
})[status] || '狀態未確認';

export const travelSellerEligibilityLabel = sellerEligible => sellerEligible ? '符合資格' : '目前不符合資格';

export const travelSellerErrorMessage = code => ({
  TRAVEL_SELLER_PERMISSION_ALREADY_ACTIVE: '旅遊銷售權限已啟用',
  TRAVEL_SELLER_DEALER_NOT_ACTIVE: '此銷售夥伴目前不符合旅遊銷售資格。',
  TRAVEL_SELLER_NOT_FOUND: '找不到可管理的銷售夥伴。',
  TRAVEL_LINE_ACCOUNT_NOT_FOUND: '找不到可管理的銷售夥伴。',
  TRAVEL_SELLER_PERMISSION_NOT_FOUND: '找不到可管理的銷售夥伴。',
  FORBIDDEN: '你沒有權限執行此操作。',
})[code] || '旅遊銷售權限更新失敗，請稍後再試。';
