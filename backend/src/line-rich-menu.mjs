const LINE_API_BASE = 'https://api.line.me/v2/bot';
const LINE_DATA_API_BASE = 'https://api-data.line.me/v2/bot';

const authorizationHeaders = (channelAccessToken, includeJson = false) => ({
  Authorization: `Bearer ${channelAccessToken}`,
  ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
});

function lineError(response, code, fallback) {
  const error = new Error(fallback);
  error.code = code;
  error.status = response.status;
  return error;
}

export async function getRichMenuAlias(fetcher, channelAccessToken, aliasId) {
  const response = await fetcher(`${LINE_API_BASE}/richmenu/alias/${encodeURIComponent(aliasId)}`, {
    headers: authorizationHeaders(channelAccessToken),
  });

  if (response.status === 404) return null;
  if (!response.ok) throw lineError(response, 'LINE_ALIAS_READ_FAILED', '讀取 LINE Rich Menu Alias 失敗');
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
    throw lineError(response, 'LINE_ALIAS_ASSIGN_FAILED', existing ? '更新 LINE Rich Menu Alias 失敗' : '建立 LINE Rich Menu Alias 失敗');
  }

  return { operation: existing ? 'updated' : 'created', aliasId, richMenuId };
}

export async function deleteRichMenuAlias(fetcher, channelAccessToken, aliasId) {
  const response = await fetcher(`${LINE_API_BASE}/richmenu/alias/${encodeURIComponent(aliasId)}`, {
    method: 'DELETE',
    headers: authorizationHeaders(channelAccessToken),
  });

  if (response.status === 404) return { deleted: false, aliasId };
  if (!response.ok) throw lineError(response, 'LINE_ALIAS_DELETE_FAILED', '刪除 LINE Rich Menu Alias 失敗');
  return { deleted: true, aliasId };
}

export async function setDefaultRichMenu(fetcher, channelAccessToken, richMenuId) {
  const response = await fetcher(`${LINE_API_BASE}/user/all/richmenu/${encodeURIComponent(richMenuId)}`, {
    method: 'POST',
    headers: authorizationHeaders(channelAccessToken),
  });

  if (!response.ok) throw lineError(response, 'LINE_DEFAULT_ASSIGN_FAILED', '設定 LINE 預設 Rich Menu 失敗');
}

export async function getDefaultRichMenu(fetcher, channelAccessToken) {
  const response = await fetcher(`${LINE_API_BASE}/user/all/richmenu`, {
    headers: authorizationHeaders(channelAccessToken),
  });

  if (!response.ok) throw lineError(response, 'LINE_DEFAULT_VERIFY_FAILED', '驗證 LINE 預設 Rich Menu 失敗');
  const data = await response.json();
  return { richMenuId: String(data?.richMenuId ?? '').trim() };
}

export async function verifyDefaultRichMenu(fetcher, channelAccessToken, expectedRichMenuId) {
  const current = await getDefaultRichMenu(fetcher, channelAccessToken);
  return Boolean(current.richMenuId) && current.richMenuId === String(expectedRichMenuId ?? '').trim();
}

const emptyPublishProgress = () => ({
  created: false,
  imageUploaded: false,
  aliasAssigned: false,
  defaultAssigned: false,
});

function publishError(code, progress) {
  const error = new Error(code);
  error.code = code;
  error.progress = { ...progress };
  return error;
}

export async function publishRichMenuToLine({
  fetcher,
  channelAccessToken,
  richMenuObject,
  imageBody,
  imageContentType,
  richMenuAliasId,
}) {
  const progress = emptyPublishProgress();
  const createResponse = await fetcher(`${LINE_API_BASE}/richmenu`, {
    method: 'POST',
    headers: authorizationHeaders(channelAccessToken, true),
    body: JSON.stringify(richMenuObject),
  });

  if (!createResponse.ok) {
    throw publishError(
      createResponse.status === 401 || createResponse.status === 403
        ? 'LINE_ACCOUNT_TOKEN_UNUSABLE'
        : 'LINE_RICH_MENU_CREATE_FAILED',
      progress,
    );
  }

  let richMenuId = '';
  try {
    richMenuId = String((await createResponse.json())?.richMenuId ?? '').trim();
  } catch {
    throw publishError('LINE_RICH_MENU_CREATE_FAILED', progress);
  }
  if (!richMenuId) throw publishError('LINE_RICH_MENU_CREATE_FAILED', progress);
  progress.created = true;

  const uploadResponse = await fetcher(`${LINE_DATA_API_BASE}/richmenu/${encodeURIComponent(richMenuId)}/content`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      'Content-Type': imageContentType,
    },
    body: imageBody,
  });
  if (!uploadResponse.ok) {
    throw publishError(
      uploadResponse.status === 401 || uploadResponse.status === 403
        ? 'LINE_ACCOUNT_TOKEN_UNUSABLE'
        : 'LINE_RICH_MENU_UPLOAD_FAILED',
      progress,
    );
  }
  progress.imageUploaded = true;

  try {
    await upsertRichMenuAlias(fetcher, channelAccessToken, richMenuAliasId, richMenuId);
  } catch {
    throw publishError('LINE_ALIAS_ASSIGN_FAILED', progress);
  }
  progress.aliasAssigned = true;

  try {
    await setDefaultRichMenu(fetcher, channelAccessToken, richMenuId);
  } catch {
    throw publishError('LINE_DEFAULT_ASSIGN_FAILED', progress);
  }

  let verified = false;
  try {
    verified = await verifyDefaultRichMenu(fetcher, channelAccessToken, richMenuId);
  } catch {
    throw publishError('LINE_DEFAULT_VERIFY_FAILED', progress);
  }
  if (!verified) throw publishError('LINE_DEFAULT_VERIFY_FAILED', progress);
  progress.defaultAssigned = true;

  return { ...progress, richMenuId };
}
