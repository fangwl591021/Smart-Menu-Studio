export const COMMISSION_CALCULATION_TYPE = 'FIXED_PER_ATTRIBUTION' as const;
export const SUPPORTED_COMMISSION_CURRENCIES = ['TWD'] as const;
export const MAX_FIXED_COMMISSION_AMOUNT_MINOR = 100_000_000;

type Database = Pick<D1Database, 'prepare' | 'batch'>;

type RuleRow = {
  id: string;
  version_no: number;
  calculation_type: string;
  fixed_amount_minor: number;
  currency_code: string;
  effective_from: string;
  created_at: string;
};

type AttributionRow = {
  id: string;
  workspace_id: string;
  line_account_id: string;
  program_id: string;
  dealer_id: string;
  conversion_at: string;
};

export function isCommissionCalculationType(value: unknown): value is typeof COMMISSION_CALCULATION_TYPE {
  return value === COMMISSION_CALCULATION_TYPE;
}

export function isFixedCommissionAmountMinor(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_FIXED_COMMISSION_AMOUNT_MINOR;
}

export function isSupportedCommissionCurrency(value: unknown): value is typeof SUPPORTED_COMMISSION_CURRENCIES[number] {
  return typeof value === 'string' && (SUPPORTED_COMMISSION_CURRENCIES as readonly string[]).includes(value);
}

export function publicCommissionRuleVersion(row: RuleRow) {
  return {
    ruleVersionId: String(row.id),
    versionNo: Number(row.version_no),
    calculationType: String(row.calculation_type),
    fixedAmountMinor: Number(row.fixed_amount_minor),
    currencyCode: String(row.currency_code),
    effectiveFrom: String(row.effective_from),
    createdAt: String(row.created_at),
  };
}

export async function listCommissionRuleVersions(db: Database, input: { workspaceId: string; lineAccountId: string; programId: string }) {
  const rows: RuleRow[] = (await db.prepare(`SELECT id,version_no,calculation_type,fixed_amount_minor,currency_code,effective_from,created_at
    FROM commission_rule_versions
    WHERE workspace_id=? AND line_account_id=? AND program_id=?
    ORDER BY version_no DESC`).bind(input.workspaceId, input.lineAccountId, input.programId).all()).results as RuleRow[] || [];
  return rows.map(publicCommissionRuleVersion);
}

export async function createCommissionRuleVersion(db: Database, input: {
  workspaceId: string;
  lineAccountId: string;
  programId: string;
  calculationType: unknown;
  fixedAmountMinor: unknown;
  currencyCode: unknown;
  createdByUserId?: string | null;
  now?: string;
}) {
  if (!isCommissionCalculationType(input.calculationType)) throw new Error('UNSUPPORTED_COMMISSION_CALCULATION_TYPE');
  if (!isFixedCommissionAmountMinor(input.fixedAmountMinor)) throw new Error('INVALID_FIXED_COMMISSION_AMOUNT');
  if (!isSupportedCommissionCurrency(input.currencyCode)) throw new Error('UNSUPPORTED_COMMISSION_CURRENCY');
  const current: any = await db.prepare('SELECT COALESCE(MAX(version_no),0) version_no FROM commission_rule_versions WHERE workspace_id=? AND line_account_id=? AND program_id=?').bind(input.workspaceId, input.lineAccountId, input.programId).first();
  const versionNo = Number(current?.version_no || 0) + 1;
  const now = input.now || new Date().toISOString();
  const rule: RuleRow = {
    id: `crv_${crypto.randomUUID()}`,
    version_no: versionNo,
    calculation_type: COMMISSION_CALCULATION_TYPE,
    fixed_amount_minor: Number(input.fixedAmountMinor),
    currency_code: String(input.currencyCode),
    effective_from: now,
    created_at: now,
  };
  await db.prepare(`INSERT INTO commission_rule_versions(id,workspace_id,line_account_id,program_id,version_no,calculation_type,fixed_amount_minor,currency_code,effective_from,created_by_user_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(rule.id, input.workspaceId, input.lineAccountId, input.programId, rule.version_no, rule.calculation_type, rule.fixed_amount_minor, rule.currency_code, rule.effective_from, input.createdByUserId || null, rule.created_at).run();
  return publicCommissionRuleVersion(rule);
}

export async function resolveHistoricalCommissionRule(db: Database, input: { workspaceId: string; lineAccountId: string; programId: string; occurredAt: string }) {
  return await db.prepare(`SELECT id,version_no,calculation_type,fixed_amount_minor,currency_code,effective_from,created_at
    FROM commission_rule_versions
    WHERE workspace_id=? AND line_account_id=? AND program_id=? AND effective_from<=?
    ORDER BY effective_from DESC,version_no DESC LIMIT 1`).bind(input.workspaceId, input.lineAccountId, input.programId, input.occurredAt).first<RuleRow>();
}

async function attributedConversion(db: Database, input: { workspaceId: string; lineAccountId: string; commissionAttributionId: string }) {
  return await db.prepare(`SELECT ca.id,ca.workspace_id,ca.line_account_id,ca.program_id,ca.dealer_id,c.occurred_at conversion_at
    FROM commission_attributions ca
    JOIN line_conversion_events c ON c.id=ca.conversion_event_id AND c.workspace_id=ca.workspace_id
    WHERE ca.id=? AND ca.workspace_id=? AND ca.line_account_id=? LIMIT 1`).bind(input.commissionAttributionId, input.workspaceId, input.lineAccountId).first<AttributionRow>();
}

export async function calculateCommissionForAttribution(db: Database, input: { workspaceId: string; lineAccountId: string; commissionAttributionId: string; now?: string }) {
  const existing: any = await db.prepare('SELECT id FROM commission_calculations WHERE commission_attribution_id=? AND workspace_id=? AND line_account_id=? LIMIT 1').bind(input.commissionAttributionId, input.workspaceId, input.lineAccountId).first();
  if (existing) return { reason: 'ALREADY_CALCULATED' as const, calculationId: String(existing.id) };
  const attribution = await attributedConversion(db, input);
  if (!attribution) return { reason: 'ATTRIBUTION_NOT_FOUND' as const };
  const rule = await resolveHistoricalCommissionRule(db, { workspaceId: input.workspaceId, lineAccountId: input.lineAccountId, programId: attribution.program_id, occurredAt: attribution.conversion_at });
  if (!rule) return { reason: 'NO_COMMISSION_RULE' as const };
  if (!isCommissionCalculationType(rule.calculation_type) || !isFixedCommissionAmountMinor(Number(rule.fixed_amount_minor)) || !isSupportedCommissionCurrency(rule.currency_code)) throw new Error('INVALID_COMMISSION_RULE_SNAPSHOT');
  const calculatedAt = input.now || new Date().toISOString();
  const calculationId = `ccalc_${crypto.randomUUID()}`;
  const ledgerEntryId = `cled_${crypto.randomUUID()}`;
  await db.batch([
    db.prepare(`INSERT INTO commission_calculations(id,workspace_id,line_account_id,commission_attribution_id,program_id,dealer_id,rule_version_id,calculation_type,base_amount_minor,commission_amount_minor,currency_code,calculated_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?)`).bind(calculationId, attribution.workspace_id, attribution.line_account_id, attribution.id, attribution.program_id, attribution.dealer_id, rule.id, COMMISSION_CALCULATION_TYPE, Number(rule.fixed_amount_minor), rule.currency_code, calculatedAt, calculatedAt),
    db.prepare(`INSERT INTO commission_ledger_entries(id,workspace_id,line_account_id,dealer_id,program_id,commission_attribution_id,commission_calculation_id,entry_type,amount_minor,currency_code,effective_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ledgerEntryId, attribution.workspace_id, attribution.line_account_id, attribution.dealer_id, attribution.program_id, attribution.id, calculationId, 'COMMISSION_EARNED', Number(rule.fixed_amount_minor), rule.currency_code, attribution.conversion_at, calculatedAt),
  ]);
  return { reason: 'CALCULATED' as const, calculationId, ledgerEntryId, ruleVersionId: rule.id };
}
