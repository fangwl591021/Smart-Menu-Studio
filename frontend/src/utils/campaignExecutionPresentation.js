export const executionStatusLabels = {
  PENDING: '等待執行',
  RUNNING: '發送中',
  COMPLETED: '已完成',
  PARTIAL_FAILED: '部分失敗',
  FAILED: '發送失敗',
  CANCELLED: '已取消',
};

export const deliveryStatusLabels = {
  PENDING: '待發送',
  SENDING: '發送中',
  SENT: '已發送',
  FAILED: '發送失敗',
  CANCELLED: '已取消',
  SKIPPED: '已略過',
};

const safeDeliveryErrorLabels = {
  LINE_RATE_LIMITED: 'LINE 發送頻率受限，可稍後重試。',
  LINE_TIMEOUT: 'LINE 服務暫時無回應，可稍後重試。',
  LINE_SERVER_ERROR: 'LINE 服務暫時異常，可稍後重試。',
  LINE_INVALID_RECIPIENT: '此收件人目前無法接收 LINE 訊息。',
  LINE_INVALID_CREDENTIAL: 'LINE 官方帳號驗證失敗，請確認 Messaging API 設定。',
  LINE_PAYLOAD_INVALID: '訊息內容格式不符合 LINE 發送規格。',
  LINE_PROVIDER_REJECTED: 'LINE 拒絕此次發送。',
};

export const safeDeliveryErrorLabel = (code) => code
  ? safeDeliveryErrorLabels[code] || '發送失敗，請稍後再試。'
  : '—';

export const formatCampaignExecutionTime = (value) => value
  ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';
