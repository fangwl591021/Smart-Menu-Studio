export type ProjectLinePublishCredential = {
  projectId: string;
  workspaceId: string;
  lineAccountId: string;
  channelAccessToken: string;
};

export type ProjectLinePublishCredentialResult =
  | { ok: true; credential: ProjectLinePublishCredential }
  | {
      ok: false;
      code: 'PROJECT_NOT_FOUND' | 'LINE_ACCOUNT_NOT_CONNECTED' | 'LINE_ACCOUNT_TOKEN_MISSING';
    };

const clean = (value: unknown) => String(value ?? '').trim();

export async function resolveProjectLinePublishCredential(
  db: D1Database,
  workspaceId: string,
  projectId: string,
): Promise<ProjectLinePublishCredentialResult> {
  const row = await db.prepare(`
    SELECT
      p.id AS project_id,
      p.workspace_id,
      account.id AS line_account_id,
      account.line_bot_channel_access_token
    FROM projects p
    LEFT JOIN workspace_line_accounts account
      ON account.workspace_id = p.workspace_id
    WHERE p.id = ?
      AND p.workspace_id = ?
      AND p.deleted_at IS NULL
    LIMIT 1
  `).bind(projectId, workspaceId).first<Record<string, unknown>>();

  if (!row) return { ok: false, code: 'PROJECT_NOT_FOUND' };

  const lineAccountId = clean(row.line_account_id);
  if (!lineAccountId) return { ok: false, code: 'LINE_ACCOUNT_NOT_CONNECTED' };

  const channelAccessToken = clean(row.line_bot_channel_access_token);
  if (!channelAccessToken) return { ok: false, code: 'LINE_ACCOUNT_TOKEN_MISSING' };

  return {
    ok: true,
    credential: {
      projectId: clean(row.project_id),
      workspaceId: clean(row.workspace_id),
      lineAccountId,
      channelAccessToken,
    },
  };
}
