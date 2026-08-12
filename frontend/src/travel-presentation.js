export const travelStatusLabel = value => ({
  DRAFT: '草稿', IN_REVIEW: '審核中', PUBLISHED: '已發布', REJECTED: '已退回', ARCHIVED: '已封存',
  OPEN: '開放報名', CLOSED: '停止報名', SOLD_OUT: '已額滿', CANCELLED: '已取消',
  PENDING_PAYMENT: '待付款', CONFIRMED: '訂位已確認', PENDING: '待處理', PAID: '已付款', FAILED: '付款失敗',
}[value] || '狀態更新');

export const travelerTypeLabel = value => ({ ADULT: '成人', CHILD: '兒童', INFANT: '嬰兒' }[value] || '旅客');
export const paymentLegLabel = value => ({ FULL: '全額', DEPOSIT: '訂金', BALANCE: '尾款' }[value] || '款項');
export const paymentScheduleLabel = value => value === 'DEPOSIT_BALANCE' ? '訂金＋尾款' : '全額付款';
export const travelEventLabel = event => event?.safeEventLabel || ({
  BOOKING_CREATED: '訂位已建立', DEPOSIT_PAID: '訂金已付款', BALANCE_PAID: '尾款已付款',
  FULL_PAYMENT_PAID: '全額已付款', BOOKING_CONFIRMED: '訂位已確認', BOOKING_CANCELLED: '訂位已取消',
  DEPARTURE_OPENED: '出發日開放報名', DEPARTURE_CLOSED: '出發日停止報名',
  DEPARTURE_CANCELLED: '出發日已取消', DEPARTURE_ARCHIVED: '出發日已封存',
  OPERATION_CONFIRMED: '營運已確認', SERVICE_COMPLETED: '服務已完成',
}[event?.eventType] || '旅遊狀態已更新');

export const money = (amount, currency = 'TWD') => currency === 'TWD'
  ? `NT$ ${Number(amount || 0).toLocaleString('zh-TW')}`
  : `${currency} ${Number(amount || 0).toLocaleString('zh-TW')}`;
export const dateTime = value => value ? new Date(value).toLocaleString('zh-TW') : '—';
export const dateOnly = value => value || '—';
export const isBookingFullyPaid = booking => Array.isArray(booking?.paymentSchedule)
  && booking.paymentSchedule.length > 0
  && booking.paymentSchedule.every(item => item.status === 'PAID');
export const isBookingPaymentFailed = booking => (booking?.paymentSchedule || []).some(item => ['FAILED', 'CANCELLED'].includes(item.status));
