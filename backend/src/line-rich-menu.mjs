const LINE_API_BASE = 'https://api.line.me/v2/bot';

const authorizationHeaders = (channelAccessToken, includeJson = false) => ({
  Authorization: `Bearer ${channelAccessToken}`,
  ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
});

async function lineError(response, fallback) {
  const detail = await response.text();
  return new Error(detail ? `${fallback}：${detail}` : fallback);
}

export async function getRichMenuAlias(fetcher, channelAccessToken, aliasId) {
  const response = await fetcher(`${LINE_API_BASE}/richmenu/alias/${encodeURIComponent(aliasId)}`, {
    headers: authorizationHeaders(channelAccessToken),
  });

  if (response.status === 404) return null;
  if (!response.ok) throw await lineError(response, '讀取 LINE Rich Menu Alias 失敗');
  return response.json();
}

export async function upsertRichMenuAlias(fetcher, channelAccessToken, aliasId, richMenuId) {
  const existing = await getRichMenuAlias(fetcher, channelAccessToken, aliasId);
  const response = await fetcher(
    existing
      ? `${LINE_API_BASE}/richmenu/alias/${encodeURIComponent(aliasId)}`
      : `${LINE_API_BASE}/richmenu/alias`,
    {
      method: 'POST',
      headers: authorizationHeaders(channelAccessToken, true),
      body: JSON.stringify(
        existing
          ? { richMenuId }
          : { richMenuAliasId: aliasId, richMenuId },
      ),
    },
  );

  if (!response.ok) {
    throw await lineError(response, existing ? '更新 LINE Rich Menu Alias 失敗' : '建立 LINE Rich Menu Alias 失敗');
  }

  return { operation: existing ? 'updated' : 'created', aliasId, richMenuId };
}

export async function deleteRichMenuAlias(fetcher, channelAccessToken, aliasId) {
  const response = await fetcher(`${LINE_API_BASE}/richmenu/alias/${encodeURIComponent(aliasId)}`, {
    method: 'DELETE',
    headers: authorizationHeaders(channelAccessToken),
  });

  if (response.status === 404) return { deleted: false, aliasId };
  if (!response.ok) throw await lineError(response, '刪除 LINE Rich Menu Alias 失敗');
  return { deleted: true, aliasId };
}

export async function setDefaultRichMenu(fetcher, channelAccessToken, richMenuId) {
  const response = await fetcher(`${LINE_API_BASE}/user/all/richmenu/${encodeURIComponent(richMenuId)}`, {
    method: 'POST',
    headers: authorizationHeaders(channelAccessToken),
  });

  if (!response.ok) throw await lineError(response, '設定 LINE 預設 Rich Menu 失敗');
}
