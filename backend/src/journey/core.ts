type JourneyDailyRow = Record<string, unknown>;

export const JOURNEY_THRESHOLDS = {
  sessionTimeoutMinutes: 30,
  attributionWindowHours: 24,
} as const;

export const rate = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : null;

export function lastObservedTouch(events: any[], at: string) {
  const minimum = Date.parse(at) - JOURNEY_THRESHOLDS.attributionWindowHours * 60 * 60 * 1000;
  return events
    .filter((event) =>
      ['message_action', 'postback_action', 'richmenu_switch'].includes(event.event_type)
      && event.project_area_id
      && Date.parse(event.occurred_at) >= minimum
      && Date.parse(event.occurred_at) <= Date.parse(at),
    )
    .sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))[0] || null;
}

export function funnel(rows: JourneyDailyRow[]) {
  const sum = (key: string) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const observedActions = sum('message_actions') + sum('postback_actions') + sum('switch_actions');
  const keywordMatches = sum('keyword_matches');
  const webhookRoutes = sum('webhook_routes');
  const webhookSuccesses = sum('webhook_successes');
  const conversions = sum('conversions');
  return {
    funnel: { observedActions, keywordMatches, webhookRoutes, webhookSuccesses, conversions },
    rates: {
      actionToKeyword: rate(keywordMatches, observedActions),
      keywordToWebhook: rate(webhookRoutes, keywordMatches),
      webhookSuccessRate: rate(webhookSuccesses, webhookRoutes),
      webhookToConversion: rate(conversions, webhookSuccesses),
    },
  };
}

function dayAfter(date: string) {
  return new Date(Date.parse(date + 'T00:00:00.000Z') + 86_400_000).toISOString();
}

function safeMinor(value: unknown) {
  return Number.isInteger(value) ? Number(value) : 0;
}

export async function rebuildJourneyDaily(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  from: string,
  to: string,
) {
  await db.prepare(
    'DELETE FROM line_journey_daily WHERE workspace_id=? AND project_id=? AND metric_date>=? AND metric_date<=?',
  ).bind(workspaceId, projectId, from, to).run();

  const until = dayAfter(to);
  const events: any[] = (await db.prepare(
    'SELECT project_area_id,substr(occurred_at,1,10) d,event_type,journey_session_id FROM line_journey_events WHERE workspace_id=? AND project_id=? AND occurred_at>=? AND occurred_at<?',
  ).bind(workspaceId, projectId, from, until).all()).results || [];
  const conversions: any[] = (await db.prepare(
    'SELECT attributed_project_area_id,substr(occurred_at,1,10) d,value_minor FROM line_conversion_events WHERE workspace_id=? AND attributed_project_id=? AND occurred_at>=? AND occurred_at<?',
  ).bind(workspaceId, projectId, from, until).all()).results || [];

  const metricDates = new Set([...events.map((row) => String(row.d)), ...conversions.map((row) => String(row.d))]);
  const keys = new Set<string>();
  for (const day of metricDates) {
    keys.add(day + '|');
    for (const event of events.filter((row) => row.d === day && row.project_area_id)) keys.add(day + '|' + event.project_area_id);
    for (const conversion of conversions.filter((row) => row.d === day && row.attributed_project_area_id)) keys.add(day + '|' + conversion.attributed_project_area_id);
  }

  for (const key of keys) {
    const [metricDate, projectAreaId] = key.split('|');
    const eventRows = events.filter((row) => row.d === metricDate && (!projectAreaId || row.project_area_id === projectAreaId));
    const conversionRows = conversions.filter((row) => row.d === metricDate && (!projectAreaId || row.attributed_project_area_id === projectAreaId));
    const count = (eventType: string) => eventRows.filter((row) => row.event_type === eventType).length;
    const sessions = new Set(eventRows.map((row) => String(row.journey_session_id || '')).filter(Boolean));
    await db.prepare(
      'INSERT INTO line_journey_daily (workspace_id,project_id,project_area_id,metric_date,observed_sessions,message_actions,postback_actions,switch_actions,keyword_matches,webhook_routes,webhook_successes,webhook_failures,conversions,conversion_value_minor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(
      workspaceId,
      projectId,
      projectAreaId,
      metricDate,
      sessions.size,
      count('message_action'),
      count('postback_action'),
      count('richmenu_switch'),
      count('keyword_match'),
      count('webhook_route'),
      count('webhook_success'),
      count('webhook_failure'),
      conversionRows.length,
      conversionRows.reduce((total, row) => total + safeMinor(row.value_minor), 0),
    ).run();
  }
}
