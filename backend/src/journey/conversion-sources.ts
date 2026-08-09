export const CONVERSION_SOURCE_REGISTRY = Object.freeze({
  LIFF_REGISTRATION: { sourceCode: 'LIFF_REGISTRATION', category: 'registration', displayName: 'LIFF Registration', allowedConversionTypes: ['registration', 'signup'], supportsValue: false, requiresExternalEventId: true, integrationMode: 'server_to_server' },
  SIGNUP: { sourceCode: 'SIGNUP', category: 'signup', displayName: 'Signup', allowedConversionTypes: ['signup', 'registration'], supportsValue: false, requiresExternalEventId: true, integrationMode: 'server_to_server' },
  BOOKING: { sourceCode: 'BOOKING', category: 'booking', displayName: 'Booking', allowedConversionTypes: ['booking'], supportsValue: false, requiresExternalEventId: true, integrationMode: 'server_to_server' },
  PURCHASE: { sourceCode: 'PURCHASE', category: 'purchase', displayName: 'Purchase', allowedConversionTypes: ['purchase'], supportsValue: true, requiresExternalEventId: true, integrationMode: 'server_to_server' },
  CUSTOM: { sourceCode: 'CUSTOM', category: 'custom', displayName: 'Custom', allowedConversionTypes: [], supportsValue: true, requiresExternalEventId: true, integrationMode: 'server_to_server' },
});

const sensitive = /(token|secret|password|authorization|cookie|uid|user.?id|line.?user.?id|source.?user.?hash|hash|email|phone|address)/i;

export function conversionSource(sourceCode: string, conversionType: string) {
  const source = (CONVERSION_SOURCE_REGISTRY as any)[String(sourceCode || '').trim().toUpperCase()];
  if (!source) return null;
  const type = String(conversionType || '').trim();
  if (!/^[a-z][a-z0-9_-]{0,29}$/i.test(type)) return null;
  if (source.sourceCode !== 'CUSTOM' && !source.allowedConversionTypes.includes(type.toLowerCase())) return null;
  return source;
}

export function sanitizeConversionMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => !sensitive.test(key) && (item === null || ['string', 'number', 'boolean'].includes(typeof item)))
    .slice(0, 20));
}

export function conversionSourceHealthRows(rows: Array<{ conversion_source?: string | null; event_count?: number; last_event_at?: string | null; conversions?: number; conversion_value_minor?: number }>, now = Date.now(), configured = true) {
  const bySource = new Map<string, any>();
  for (const row of rows) bySource.set(row.conversion_source || 'LEGACY', row);
  const healthRows = Object.values(CONVERSION_SOURCE_REGISTRY).map((source: any) => {
    const row = bySource.get(source.sourceCode);
    const eventCount = Number(row?.event_count || 0);
    const lastEventAt = row?.last_event_at || null;
    const status = !configured ? 'NOT_CONFIGURED' : !eventCount ? 'NO_EVENTS' : !lastEventAt || now - Date.parse(lastEventAt) > 3 * 86_400_000 ? 'STALE' : 'ACTIVE';
    return { sourceCode: source.sourceCode, displayName: source.displayName, status, eventCount, lastEventAt, conversions: Number(row?.conversions || 0), conversionValueMinor: Number(row?.conversion_value_minor || 0) };
  });
  const legacy = bySource.get('LEGACY');
  if (legacy) healthRows.push({ sourceCode: null, displayName: 'Legacy / 未記錄來源', status: Number(legacy.event_count || 0) ? 'ACTIVE' : 'NO_EVENTS', eventCount: Number(legacy.event_count || 0), lastEventAt: legacy.last_event_at || null, conversions: Number(legacy.conversions || 0), conversionValueMinor: Number(legacy.conversion_value_minor || 0) });
  return healthRows;
}
