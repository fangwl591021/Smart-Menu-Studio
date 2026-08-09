export const PAYOUT_REQUEST_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type PayoutRequestStatus = typeof PAYOUT_REQUEST_STATUSES[number];
export const PAYOUT_REJECTION_REASON_CODES = ['INVALID_REQUEST', 'SETTLEMENT_MISMATCH', 'DEALER_NOT_ELIGIBLE', 'DUPLICATE_REQUEST', 'OTHER_POLICY'] as const;

const TRANSITIONS: Readonly<Record<PayoutRequestStatus, readonly PayoutRequestStatus[]>> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function isPayoutRequestStatus(value: unknown): value is PayoutRequestStatus {
  return typeof value === 'string' && (PAYOUT_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function canTransitionPayoutRequestStatus(from: PayoutRequestStatus, to: PayoutRequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isPayoutRejectionReasonCode(value: unknown): boolean {
  return typeof value === 'string' && (PAYOUT_REJECTION_REASON_CODES as readonly string[]).includes(value);
}

export function publicPayoutRequestRow(row: Record<string, unknown>, ordinal = 0) {
  return { requestId: String(row.id || ''), settlementId: String(row.settlement_id || ''), publicSafeLabel: `Dealer #${ordinal + 1}`, status: String(row.status || ''), amountMinor: Number(row.amount_minor || 0), currencyCode: 'TWD', requestedAt: row.requested_at || null, reviewedAt: row.reviewed_at || null, rejectionReasonCode: row.rejection_reason_code || null };
}

export function publicDealerPayoutRequestRow(row: Record<string, unknown>) {
  return { requestId: String(row.id || ''), settlementId: String(row.settlement_id || ''), status: String(row.status || ''), amountMinor: Number(row.amount_minor || 0), currencyCode: 'TWD', requestedAt: row.requested_at || null, reviewedAt: row.reviewed_at || null, rejectionReasonCode: row.rejection_reason_code || null };
}
