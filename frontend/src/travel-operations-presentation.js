export const canManageTravelOperations = role => ['owner', 'admin'].includes(role);

export const travelReadinessLabel = value => ({
  READY: '營運狀態良好', ATTENTION: '需要留意', BLOCKED: '尚不可進行',
}[value] || '營運狀態待確認');

export const travelReadinessWarningLabel = value => ({
  MIN_GROUP_NOT_REACHED: '尚未達最低成團人數',
  UNPAID_BOOKINGS_EXIST: '尚有未付款訂單',
  DEPOSIT_ONLY_BOOKINGS_EXIST: '尚有僅完成訂金的訂單',
  DEPARTURE_CANCELLED: '此出發日已取消',
  BOOKING_WINDOW_OPEN: '目前仍在報名期間',
  SOLD_OUT: '名額已滿',
}[value] || '請留意目前營運狀態');

export const travelOperationPaymentLabel = value => ({
  UNPAID: '未付款', DEPOSIT_COMPLETED: '訂金完成', FULLY_PAID: '款項已付清', CANCELLED: '已取消',
}[value] || '付款狀態待確認');

export const travelMemberPaymentLabel = value => ({
  PENDING_PAYMENT: '未付款', DEPOSIT_PAID: '訂金完成', FULLY_PAID: '款項已付清', CANCELLED: '已取消',
}[value] || '付款狀態待確認');

export const travelFulfillmentLabel = value => ({
  PENDING: '等待出團確認', CONFIRMED: '已確認出團', COMPLETED: '旅程服務已完成', CANCELLED: '已取消',
}[value] || '履約進度待確認');

export const travelOperationErrorMessage = (code, action = 'read') => {
  if (code === 'FORBIDDEN') return '你沒有權限執行此操作。';
  if (code === 'TRAVEL_DEPARTURE_NOT_FOUND') return '找不到此出發日。';
  if (code === 'TRAVEL_OPERATION_NOT_CONFIRMED') return '目前無法將此出發日標記為服務完成。';
  if (code === 'TRAVEL_OPERATION_DEPARTURE_INVALID') return action === 'complete'
    ? '目前無法將此出發日標記為服務完成。'
    : '目前無法確認此出發日的營運狀態。';
  return action === 'confirm' ? '目前無法確認此出發日的營運狀態。'
    : action === 'complete' ? '目前無法將此出發日標記為服務完成。'
      : '目前無法讀取營運資訊。';
};