export const COMMISSION_PROGRAM_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type CommissionProgramStatus = typeof COMMISSION_PROGRAM_STATUSES[number];
export const DEALER_ELIGIBILITY_STATUSES = ['ELIGIBLE', 'DISABLED'] as const;
export type DealerEligibilityStatus = typeof DEALER_ELIGIBILITY_STATUSES[number];

const PROGRAM_TRANSITIONS: Readonly<Record<CommissionProgramStatus, readonly CommissionProgramStatus[]>> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED'],
  PAUSED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function isCommissionProgramStatus(value: unknown): value is CommissionProgramStatus {
  return typeof value === 'string' && (COMMISSION_PROGRAM_STATUSES as readonly string[]).includes(value);
}

export function isDealerEligibilityStatus(value: unknown): value is DealerEligibilityStatus {
  return typeof value === 'string' && (DEALER_ELIGIBILITY_STATUSES as readonly string[]).includes(value);
}

export function isAttributionWindowDays(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 90;
}

export function canTransitionCommissionProgramStatus(from: CommissionProgramStatus, to: CommissionProgramStatus): boolean {
  return PROGRAM_TRANSITIONS[from].includes(to);
}

export function publicCommissionProgramRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    status: String(row.status || ''),
    attributionWindowDays: Number(row.attribution_window_days || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function publicCommissionProgramDealerRow(row: Record<string, unknown>, ordinal: number) {
  return {
    dealerId: String(row.dealer_id || ''),
    publicSafeLabel: `Dealer #${ordinal + 1}`,
    eligibilityStatus: String(row.eligibility_status || ''),
    dealerStatus: String(row.dealer_status || ''),
    eligibleAt: row.eligible_at || null,
    disabledAt: row.disabled_at || null,
  };
}
