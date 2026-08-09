export const commissionAttributionPeriod = (value: unknown) => String(value) === '7d' ? 7 : 30;
const count = (value: unknown) => Number(value || 0);

export async function commissionAttributionSnapshot(db: D1Database, input: { workspaceId: string; lineAccountId: string; days: number; programId?: string; dealerId?: string; now?: Date }) {
  const now = input.now || new Date();
  const from = new Date(now.getTime() - input.days * 86400000).toISOString();
  const programFilter = input.programId ? ' AND a.program_id=?' : '';
  const dealerFilter = input.dealerId ? ' AND a.dealer_id=?' : '';
  const args = [input.workspaceId, input.lineAccountId, from, ...(input.programId ? [input.programId] : []), ...(input.dealerId ? [input.dealerId] : [])];
  const base = ` FROM commission_attributions a JOIN line_conversion_events c ON c.id=a.conversion_event_id AND c.workspace_id=a.workspace_id`;
  const where = ` WHERE a.workspace_id=? AND a.line_account_id=? AND c.occurred_at>=?${programFilter}${dealerFilter}`;
  const summary: any = await db.prepare(`SELECT COUNT(*) count${base}${where}`).bind(...args).first();
  const trendRows: any[] = (await db.prepare(`SELECT substr(c.occurred_at,1,10) day,COUNT(*) count${base}${where} GROUP BY substr(c.occurred_at,1,10) ORDER BY day`).bind(...args).all()).results || [];
  const programRows: any[] = (await db.prepare(`SELECT a.program_id,p.name program_name,COUNT(*) count${base} JOIN commission_programs p ON p.id=a.program_id AND p.workspace_id=a.workspace_id AND p.line_account_id=a.line_account_id${where} GROUP BY a.program_id,p.name ORDER BY count DESC,p.name ASC`).bind(...args).all()).results || [];
  const dealerRows: any[] = (await db.prepare(`SELECT a.dealer_id,COUNT(*) count${base}${where} GROUP BY a.dealer_id ORDER BY count DESC,a.dealer_id ASC`).bind(...args).all()).results || [];
  const sourceRows: any[] = (await db.prepare(`SELECT a.attribution_source source,COUNT(*) count${base}${where} GROUP BY a.attribution_source ORDER BY source`).bind(...args).all()).results || [];
  const recentRows: any[] = input.dealerId ? [] : (await db.prepare(`SELECT a.id attribution_id,a.program_id,p.name program_name,a.attribution_source,c.occurred_at,a.attributed_at${base} JOIN commission_programs p ON p.id=a.program_id AND p.workspace_id=a.workspace_id AND p.line_account_id=a.line_account_id${where} ORDER BY c.occurred_at DESC,a.id DESC LIMIT 20`).bind(...args).all()).results || [];
  return {
    period: { days: input.days, from, to: now.toISOString() },
    summary: { attributedConversions: count(summary?.count) },
    trend: trendRows.map(row => ({ day: String(row.day), attributedConversions: count(row.count) })),
    programs: programRows.map(row => ({ programId: String(row.program_id), programName: String(row.program_name), attributedConversions: count(row.count) })),
    dealers: dealerRows.map((row, index) => ({ publicSafeLabel: `Dealer #${index + 1}`, attributedConversions: count(row.count) })),
    sources: sourceRows.map(row => ({ attributionSource: String(row.source), attributedConversions: count(row.count) })),
    recent: recentRows.map(row => ({ attributionId: String(row.attribution_id), programId: String(row.program_id), programName: String(row.program_name), conversionCategory: 'CONVERSION', attributionSource: String(row.attribution_source), occurredAt: row.occurred_at || null, attributedAt: row.attributed_at || null })),
  };
}
