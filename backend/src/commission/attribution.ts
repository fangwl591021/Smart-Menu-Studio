export type CommissionAttributionReason = 'ATTRIBUTED' | 'ALREADY_ATTRIBUTED' | 'NOT_ATTRIBUTABLE' | 'PROGRAM_NOT_ACTIVE' | 'AMBIGUOUS_ACTIVE_PROGRAM' | 'NO_DEALER' | 'DEALER_NOT_ACTIVE' | 'DEALER_NOT_ELIGIBLE' | 'OUTSIDE_ATTRIBUTION_WINDOW' | 'SELF_ATTRIBUTION_BLOCKED';

type StatusEvent = { to_status?: string | null; created_at?: string | null };

export function resolveEffectiveStatusAt(events: readonly StatusEvent[], occurredAt: string): string | null {
  const at = Date.parse(occurredAt);
  if (!Number.isFinite(at)) return null;
  return [...events]
    .filter(event => event.to_status && event.created_at && Date.parse(String(event.created_at)) <= at)
    .sort((a, b) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)))
    .at(-1)?.to_status || null;
}

export function isWithinAttributionWindow(qualifiedAt: string, conversionAt: string, days: number): boolean {
  const qualified = Date.parse(qualifiedAt), conversion = Date.parse(conversionAt);
  return Number.isFinite(qualified) && Number.isFinite(conversion) && Number.isInteger(days) && days >= 1 && conversion >= qualified && conversion <= qualified + days * 86400000;
}

async function statusEvents(db: D1Database, table: 'dealer_status_events' | 'commission_program_status_events' | 'commission_program_dealer_status_events', where: string, values: string[]) {
  const rows: any[] = (await db.prepare(`SELECT to_status,created_at FROM ${table} WHERE ${where} ORDER BY created_at ASC,id ASC`).bind(...values).all()).results || [];
  return rows;
}

export async function evaluateCommissionAttribution(db: D1Database, input: { workspaceId: string; lineAccountId: string; conversionReferralEvidenceId: string }) {
  const existing: any = await db.prepare('SELECT id FROM commission_attributions WHERE workspace_id=? AND line_account_id=? AND conversion_referral_evidence_id=? LIMIT 1').bind(input.workspaceId, input.lineAccountId, input.conversionReferralEvidenceId).first();
  if (existing) return { reason: 'ALREADY_ATTRIBUTED' as const };
  const evidence: any = await db.prepare(`SELECT e.id evidence_id,e.conversion_event_id,e.member_referral_attribution_id,c.occurred_at conversion_at,a.inviter_member_id,a.invitee_member_id,a.qualified_at,a.status referral_status
    FROM conversion_referral_evidence e
    JOIN line_conversion_events c ON c.id=e.conversion_event_id AND c.workspace_id=e.workspace_id
    JOIN member_referral_attributions a ON a.id=e.member_referral_attribution_id AND a.workspace_id=e.workspace_id AND a.line_account_id=e.line_account_id
    WHERE e.id=? AND e.workspace_id=? AND e.line_account_id=? AND e.evidence_type='SERVER_CONTEXT' LIMIT 1`).bind(input.conversionReferralEvidenceId, input.workspaceId, input.lineAccountId).first();
  if (!evidence || evidence.referral_status !== 'qualified') return { reason: 'NOT_ATTRIBUTABLE' as const };
  if (evidence.inviter_member_id && evidence.inviter_member_id === evidence.invitee_member_id) return { reason: 'SELF_ATTRIBUTION_BLOCKED' as const };
  const programs: any[] = (await db.prepare('SELECT id,attribution_window_days FROM commission_programs WHERE workspace_id=? AND line_account_id=?').bind(input.workspaceId, input.lineAccountId).all()).results || [];
  const activePrograms: any[] = [];
  for (const program of programs) {
    const events = await statusEvents(db, 'commission_program_status_events', 'workspace_id=? AND line_account_id=? AND program_id=?', [input.workspaceId, input.lineAccountId, program.id]);
    if (resolveEffectiveStatusAt(events, evidence.conversion_at) === 'ACTIVE') activePrograms.push(program);
  }
  if (!activePrograms.length) return { reason: 'PROGRAM_NOT_ACTIVE' as const };
  if (activePrograms.length !== 1) return { reason: 'AMBIGUOUS_ACTIVE_PROGRAM' as const };
  const program = activePrograms[0];
  if (!isWithinAttributionWindow(evidence.qualified_at, evidence.conversion_at, Number(program.attribution_window_days))) return { reason: 'OUTSIDE_ATTRIBUTION_WINDOW' as const };
  const dealer: any = await db.prepare('SELECT id FROM line_oa_dealers WHERE workspace_id=? AND line_account_id=? AND member_id=? LIMIT 1').bind(input.workspaceId, input.lineAccountId, evidence.inviter_member_id).first();
  if (!dealer) return { reason: 'NO_DEALER' as const };
  const dealerEvents = await statusEvents(db, 'dealer_status_events', 'workspace_id=? AND line_account_id=? AND dealer_id=?', [input.workspaceId, input.lineAccountId, dealer.id]);
  if (resolveEffectiveStatusAt(dealerEvents, evidence.conversion_at) !== 'ACTIVE') return { reason: 'DEALER_NOT_ACTIVE' as const };
  const eligibility: any = await db.prepare('SELECT id FROM commission_program_dealers WHERE workspace_id=? AND line_account_id=? AND program_id=? AND dealer_id=? LIMIT 1').bind(input.workspaceId, input.lineAccountId, program.id, dealer.id).first();
  if (!eligibility) return { reason: 'DEALER_NOT_ELIGIBLE' as const };
  const eligibilityEvents = await statusEvents(db, 'commission_program_dealer_status_events', 'workspace_id=? AND line_account_id=? AND program_id=? AND dealer_id=?', [input.workspaceId, input.lineAccountId, program.id, dealer.id]);
  if (resolveEffectiveStatusAt(eligibilityEvents, evidence.conversion_at) !== 'ELIGIBLE') return { reason: 'DEALER_NOT_ELIGIBLE' as const };
  return { reason: 'ATTRIBUTED' as const, conversionEventId: String(evidence.conversion_event_id), memberReferralAttributionId: String(evidence.member_referral_attribution_id), programId: String(program.id), dealerId: String(dealer.id), attributedAt: String(evidence.conversion_at) };
}

export async function establishCommissionAttribution(db: D1Database, input: { workspaceId: string; lineAccountId: string; conversionReferralEvidenceId: string }) {
  const decision = await evaluateCommissionAttribution(db, input);
  if (decision.reason !== 'ATTRIBUTED') return decision;
  const result: any = await db.prepare("INSERT INTO commission_attributions(id,workspace_id,line_account_id,conversion_event_id,conversion_referral_evidence_id,member_referral_attribution_id,program_id,dealer_id,attribution_source,attributed_at) VALUES(?,?,?,?,?,?,?,?, 'REFERRAL_EVIDENCE',?) ON CONFLICT DO NOTHING").bind(`cat_${crypto.randomUUID()}`, input.workspaceId, input.lineAccountId, decision.conversionEventId, input.conversionReferralEvidenceId, decision.memberReferralAttributionId, decision.programId, decision.dealerId, decision.attributedAt).run();
  return Number(result?.meta?.changes || 0) === 1 ? decision : { reason: 'ALREADY_ATTRIBUTED' as const };
}
