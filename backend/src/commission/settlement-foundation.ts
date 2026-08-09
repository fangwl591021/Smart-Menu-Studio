export const SETTLEMENT_STATUSES = ['DRAFT', 'LOCKED', 'FINALIZED', 'CANCELLED'] as const;
export type SettlementStatus = typeof SETTLEMENT_STATUSES[number];

const TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  DRAFT: ['LOCKED', 'CANCELLED'],
  LOCKED: ['FINALIZED', 'CANCELLED'],
  FINALIZED: [],
  CANCELLED: [],
};

export function isSettlementStatus(value: unknown): value is SettlementStatus {
  return typeof value === 'string' && (SETTLEMENT_STATUSES as readonly string[]).includes(value);
}

export function canTransitionSettlementStatus(from: SettlementStatus, to: SettlementStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isValidSettlementPeriod(start: unknown, end: unknown): boolean {
  const from = new Date(String(start));
  const to = new Date(String(end));
  return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from.getTime() < to.getTime();
}

export const SETTLEMENT_ELIGIBLE_LEDGER_SQL = `SELECT l.id,l.dealer_id,l.program_id,l.amount_minor,l.currency_code,l.effective_at
  FROM commission_ledger_entries l
  WHERE l.workspace_id=? AND l.line_account_id=?
    AND l.entry_type='COMMISSION_EARNED'
    AND l.currency_code='TWD'
    AND l.effective_at>=? AND l.effective_at<?
    AND NOT EXISTS (
      SELECT 1 FROM commission_settlement_items claimed_item
      JOIN commission_settlements claimed_settlement ON claimed_settlement.id=claimed_item.settlement_id
      WHERE claimed_item.ledger_entry_id=l.id
        AND claimed_settlement.status IN ('LOCKED','FINALIZED')
        AND claimed_settlement.id<>?
    )
  ORDER BY l.effective_at ASC,l.id ASC`;

export function publicSettlementRow(row: Record<string, unknown>) {
  return { settlementId: String(row.id || ''), periodStart: String(row.period_start || ''), periodEnd: String(row.period_end || ''), status: String(row.status || ''), currencyCode: 'TWD', totalAmountMinor: Number(row.total_amount_minor || 0), entryCount: Number(row.entry_count || 0), snapshotAt: row.snapshot_at || null, createdAt: row.created_at || null, lockedAt: row.locked_at || null, finalizedAt: row.finalized_at || null, cancelledAt: row.cancelled_at || null };
}

export function publicSettlementItem(row: Record<string, unknown>, ordinal: number) {
  return { publicSafeLabel: `Dealer #${ordinal + 1}`, programName: String(row.program_name || ''), amountMinor: Number(row.amount_minor || 0), currencyCode: 'TWD', ledgerEffectiveAt: String(row.ledger_effective_at || '') };
}
