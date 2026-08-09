export const DEALER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;
export type DealerStatus = typeof DEALER_STATUSES[number];

export function isDealerStatus(value: unknown): value is DealerStatus {
  return typeof value === 'string' && (DEALER_STATUSES as readonly string[]).includes(value);
}

export type DealerApplyDecision = 'CREATE_PENDING' | 'IDEMPOTENT' | 'REAPPLY_PENDING' | 'SUSPENDED_BLOCKED';

export function dealerApplyDecision(current: DealerStatus | null): DealerApplyDecision {
  if (current === null) return 'CREATE_PENDING';
  if (current === 'REJECTED') return 'REAPPLY_PENDING';
  if (current === 'SUSPENDED') return 'SUSPENDED_BLOCKED';
  return 'IDEMPOTENT';
}

const TENANT_TRANSITIONS: Readonly<Record<DealerStatus, readonly DealerStatus[]>> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
  REJECTED: [],
};

export function canTenantTransitionDealerStatus(from: DealerStatus, to: DealerStatus): boolean {
  return TENANT_TRANSITIONS[from].includes(to);
}

export function publicDealerRow(row: Record<string, unknown>, ordinal: number) {
  return {
    id: String(row.id || ''),
    publicSafeLabel: `Dealer #${ordinal + 1}`,
    status: String(row.status || ''),
    appliedAt: row.applied_at || null,
    approvedAt: row.approved_at || null,
    suspendedAt: row.suspended_at || null,
    rejectedAt: row.rejected_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
