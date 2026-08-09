export const PAYMENT_ATTEMPT_STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type PaymentAttemptStatus = typeof PAYMENT_ATTEMPT_STATUSES[number];
export const PAYMENT_FAILURE_REASON_CODES = ['PROVIDER_UNAVAILABLE', 'PROVIDER_REJECTED', 'INVALID_PAYMENT_STATE', 'IDEMPOTENCY_CONFLICT', 'TECHNICAL_FAILURE'] as const;
export const INTERNAL_TEST_PROVIDER = 'INTERNAL_TEST' as const;

const TRANSITIONS: Readonly<Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]>> = {
  PENDING: ['PROCESSING', 'CANCELLED'], PROCESSING: ['SUCCEEDED', 'FAILED'], SUCCEEDED: [], FAILED: [], CANCELLED: [],
};

export function isPaymentAttemptStatus(value: unknown): value is PaymentAttemptStatus { return typeof value === 'string' && (PAYMENT_ATTEMPT_STATUSES as readonly string[]).includes(value); }
export function canTransitionPaymentAttemptStatus(from: PaymentAttemptStatus, to: PaymentAttemptStatus): boolean { return TRANSITIONS[from].includes(to); }
export function isPaymentFailureReasonCode(value: unknown): boolean { return typeof value === 'string' && (PAYMENT_FAILURE_REASON_CODES as readonly string[]).includes(value); }

export type SimulatedPaymentProvider = { code: typeof INTERNAL_TEST_PROVIDER; executePayment(input: { amountMinor: number; currencyCode: string; outcome?: 'SUCCEEDED' | 'FAILED' }): Promise<{ status: 'SUCCEEDED' | 'FAILED'; failureReasonCode?: string; providerTransactionRef?: string }> };
export const internalTestPaymentProvider: SimulatedPaymentProvider = { code: INTERNAL_TEST_PROVIDER, async executePayment(input) { if (input.outcome === 'FAILED') return { status: 'FAILED', failureReasonCode: 'TECHNICAL_FAILURE' }; return { status: 'SUCCEEDED', providerTransactionRef: `simulated_${input.amountMinor}_${input.currencyCode}` }; } };

export async function paymentIdempotencyKeyHash(input: { workspaceId: string; lineAccountId: string; payoutRequestId: string; key: string }): Promise<string> { const payload = new TextEncoder().encode(`smart-menu-payment-execution:v1:${input.workspaceId}:${input.lineAccountId}:${input.payoutRequestId}:${input.key}`); const digest = await crypto.subtle.digest('SHA-256', payload); return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join(''); }

export function publicPaymentAttemptRow(row: Record<string, unknown>) { return { attemptId: String(row.id || ''), payoutRequestId: String(row.payout_request_id || ''), attemptNo: Number(row.attempt_no || 0), providerCode: INTERNAL_TEST_PROVIDER, status: String(row.status || ''), amountMinor: Number(row.amount_minor || 0), currencyCode: 'TWD', failureReasonCode: row.failure_reason_code || null, startedAt: row.started_at || null, completedAt: row.completed_at || null, executionMode: 'SIMULATED' as const }; }
export function publicDealerPaymentStatusRow(row: Record<string, unknown>) { return { payoutRequestId: String(row.payout_request_id || ''), payoutRequestStatus: String(row.payout_request_status || ''), paymentStatus: row.payment_status || null, amountMinor: Number(row.amount_minor || 0), currencyCode: 'TWD', executionMode: row.payment_status ? 'SIMULATED' as const : null }; }
