export type SafeSystemWorkspaceSummary = {
  slug: string;
  name: string;
  company_name: string | null;
  status: string;
  member_count: number;
  active_webhook_count: number;
};

export function safeSystemWorkspaceSummaries(rows: Record<string, unknown>[]): SafeSystemWorkspaceSummary[] {
  return rows.map(row => ({
    slug: String(row.slug || ''),
    name: String(row.name || ''),
    company_name: row.company_name ? String(row.company_name) : null,
    status: String(row.status || ''),
    member_count: Number(row.member_count || 0),
    active_webhook_count: Number(row.active_webhook_count || 0),
  }));
}

export async function resolveSystemWorkspaceInternalId(
  db: D1Database,
  safeWorkspaceReference: string,
): Promise<string | null> {
  const workspace = await db.prepare(`
    SELECT id
    FROM workspaces
    WHERE slug = ? AND deleted_at IS NULL
    LIMIT 1
  `).bind(safeWorkspaceReference).first<{ id: string }>();
  return workspace?.id ? String(workspace.id) : null;
}
