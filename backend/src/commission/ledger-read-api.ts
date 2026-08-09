export const commissionLedgerPeriod = (value: unknown) => String(value) === '7d' ? 7 : 30;

const count = (value: unknown) => Number(value || 0);

export async function commissionLedgerSnapshot(db: D1Database, input: { workspaceId: string; lineAccountId: string; days: number; programId?: string; dealerId?: string; now?: Date }) {
  const now = input.now || new Date();
  const from = new Date(now.getTime() - input.days * 86400000).toISOString();
  const to = now.toISOString();
  const programFilter = input.programId ? ' AND l.program_id=?' : '';
  const dealerFilter = input.dealerId ? ' AND l.dealer_id=?' : '';
  const args = [input.workspaceId, input.lineAccountId, from, to, ...(input.programId ? [input.programId] : []), ...(input.dealerId ? [input.dealerId] : [])];
  const base = ` FROM commission_ledger_entries l`;
  const where = ` WHERE l.workspace_id=? AND l.line_account_id=? AND l.entry_type='COMMISSION_EARNED' AND l.effective_at>=? AND l.effective_at<=?${programFilter}${dealerFilter}`;
  const earnedRows: any[] = (await db.prepare(`SELECT l.currency_code,COALESCE(SUM(l.amount_minor),0) amount_minor,COUNT(*) attribution_count${base}${where} GROUP BY l.currency_code ORDER BY l.currency_code`).bind(...args).all()).results || [];
  const trendRows: any[] = (await db.prepare(`SELECT substr(l.effective_at,1,10) day,l.currency_code,COALESCE(SUM(l.amount_minor),0) amount_minor,COUNT(*) attribution_count${base}${where} GROUP BY substr(l.effective_at,1,10),l.currency_code ORDER BY day,l.currency_code`).bind(...args).all()).results || [];
  const programRows: any[] = (await db.prepare(`SELECT l.program_id,p.name program_name,l.currency_code,COALESCE(SUM(l.amount_minor),0) amount_minor,COUNT(*) attribution_count${base} JOIN commission_programs p ON p.id=l.program_id AND p.workspace_id=l.workspace_id AND p.line_account_id=l.line_account_id${where} GROUP BY l.program_id,p.name,l.currency_code ORDER BY amount_minor DESC,p.name ASC,l.currency_code ASC`).bind(...args).all()).results || [];
  const dealerRows: any[] = input.dealerId ? [] : (await db.prepare(`SELECT l.dealer_id,l.currency_code,COALESCE(SUM(l.amount_minor),0) amount_minor,COUNT(*) attribution_count${base}${where} GROUP BY l.dealer_id,l.currency_code ORDER BY amount_minor DESC,l.dealer_id ASC,l.currency_code ASC`).bind(...args).all()).results || [];
  return {
    period: { days: input.days, from, to },
    earnedByCurrency: earnedRows.map(row => ({ currencyCode: String(row.currency_code), amountMinor: count(row.amount_minor), attributionCount: count(row.attribution_count) })),
    trend: trendRows.map(row => ({ date: String(row.day), currencyCode: String(row.currency_code), amountMinor: count(row.amount_minor), attributionCount: count(row.attribution_count) })),
    programBreakdown: programRows.map(row => ({ programId: String(row.program_id), programName: String(row.program_name), currencyCode: String(row.currency_code), earnedAmountMinor: count(row.amount_minor), attributionCount: count(row.attribution_count) })),
    dealerBreakdown: dealerRows.map((row, index) => ({ publicSafeLabel: `Dealer #${index + 1}`, currencyCode: String(row.currency_code), earnedAmountMinor: count(row.amount_minor), attributionCount: count(row.attribution_count) })),
  };
}
