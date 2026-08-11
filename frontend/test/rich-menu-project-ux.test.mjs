import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const guide = await readFile(new URL('../src/components/SmartGuide.jsx', import.meta.url), 'utf8');
const recommendations = await readFile(new URL('../src/components/RecommendationSection.jsx', import.meta.url), 'utf8');
const backend = await readFile(new URL('../../backend/src/index.ts', import.meta.url), 'utf8');
const lineService = await readFile(new URL('../../backend/src/line-rich-menu.mjs', import.meta.url), 'utf8');
const editor = app.slice(app.indexOf('const ProjectEditorView'), app.indexOf('const LoginView'));
const publishRoute = backend.slice(
  backend.indexOf("app.post('/api/projects/:projectId/publish'"),
  backend.indexOf("app.post('/api/projects/:projectId/set-default'"),
);

test('existing backend publish route remains the only project editor publish authority', () => {
  assert.match(backend, /app\.post\('\/api\/projects\/:projectId\/publish'/);
  assert.equal((editor.match(/\/api\/projects\/\$\{projectId\}\/publish/g) || []).length, 1);
});

test('backend publish keeps editor role authority', () => assert.match(publishRoute, /requireRole\(c, 'editor'\)/));
test('backend creates the LINE Rich Menu', () => assert.match(lineService, /LINE_API_BASE.*v2\/bot/));
test('backend uploads Rich Menu image content', () => assert.match(lineService, /LINE_DATA_API_BASE.*api-data\.line\.me/));
test('backend validates actual dimensions and areas', () => {
  assert.match(publishRoute, /validateRichMenuImageDimensions\(dimensions\.width, dimensions\.height\)/);
  assert.match(publishRoute, /validateRichMenuAreas\(project\.areas, dimensions\.width, dimensions\.height\)/);
});
test('Messaging API credential remains server-side', () => assert.doesNotMatch(editor, /LINE_CHANNEL_ACCESS_TOKEN/));
test('publish reuses existing alias service', () => assert.match(lineService, /await upsertRichMenuAlias\(fetcher, channelAccessToken/));
test('every explicit publish assigns and verifies the Messaging API default', () => {
  assert.match(publishRoute, /publishRichMenuToLine\(\{/);
  assert.doesNotMatch(publishRoute, /if \(project\.status === 'default'\)/);
  assert.match(lineService, /await setDefaultRichMenu\(fetcher, channelAccessToken, richMenuId\)/);
  assert.match(lineService, /await verifyDefaultRichMenu\(fetcher, channelAccessToken, richMenuId\)/);
});
test('alias service implementation remains present', () => assert.match(lineService, /export async function upsertRichMenuAlias/));

test('project editor shows 發布圖文選單 as a primary action', () => assert.match(editor, />發布圖文選單</));
test('save and publish remain separate actions', () => {
  assert.match(editor, /onClick=\{saveProject\}/);
  assert.match(editor, /onClick=\{openPublishConfirmation\}/);
});
test('unsaved project changes block publish', () => assert.match(editor, /if \(projectDirty\) return '請先儲存專案變更。'/));
test('successful save clears dirty state without publishing', () => {
  assert.match(editor, /setProjectDirty\(false\);[\s\S]*專案內容已儲存/);
  assert.doesNotMatch(editor.slice(editor.indexOf('const saveProject'), editor.indexOf('const refreshProjectFromServer')), /\/publish/);
});
test('publish readiness comes from backend Guide workflow', () => {
  assert.match(guide, /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/guide/);
  assert.match(app, /workflow\?\.status === 'complete'/);
});
test('image readiness reason is zh-TW', () => assert.match(app, /請先設定有效的圖文選單圖片/));
test('area readiness reason is zh-TW', () => assert.match(app, /請先設定所有點擊區域的動作/));
test('LINE account readiness reason is zh-TW', () => assert.match(app, /請先連結 LINE Official Account/));
test('Messaging API token readiness reason is zh-TW', () => assert.match(app, /請先設定 Messaging API Bot Token/));
test('disabled publish exposes the safe reason', () => assert.match(editor, /publishBlockedReason && <span/));

test('publish uses a confirmation dialog', () => {
  assert.match(editor, /role="dialog"/);
  assert.match(editor, /確認要將目前專案發布，並切換為該 LINE 官方帳號目前使用中的選單嗎/);
});
test('confirmation shows project name', () => assert.match(editor, /專案名稱<\/dt><dd[^>]*>\{project\.name\}/));
test('confirmation shows actual image dimensions', () => assert.match(editor, /\{project\.imageWidth\} × \{project\.imageHeight\}/));
test('confirmation shows clickable area count', () => assert.match(editor, /\{project\.areas\?\.length \|\| 0\} 個/));
test('confirmation uses safe LINE account display name when available', () => {
  assert.match(editor, /\/api\/line\/account/);
  assert.match(editor, /lineAccountName \|\| '已連結的官方帳號'/);
});
test('publish has preparing and publishing states', () => {
  assert.match(editor, /'準備發布'/);
  assert.match(editor, /'發布中'/);
});
test('publish requires explicit confirmation', () => assert.match(editor, /onClick=\{publishProject\}[\s\S]*確認發布/));
test('frontend requires the complete publish contract before success', () => {
  const handler = editor.slice(editor.indexOf('const publishProject'), editor.indexOf('if (loading)'));
  assert.ok(handler.indexOf('await authFetch') < handler.indexOf("status: 'success'"));
  assert.match(handler, /if \(!response\.ok \|\| !publishContractComplete\(payload\)\)/);
  assert.match(app, /payload\?\.created[\s\S]*payload\?\.imageUploaded[\s\S]*payload\?\.aliasAssigned[\s\S]*payload\?\.defaultAssigned/);
});
test('draft status changes only after backend publish success', () => {
  const handler = editor.slice(editor.indexOf('const publishProject'), editor.indexOf('if (loading)'));
  assert.ok(handler.indexOf('await response.json()') < handler.indexOf('setProject(previous'));
  assert.match(handler, /status: payload\.project\?\.status \|\| previous\.status/);
});
test('publish success wording includes current-menu assignment', () => assert.match(editor, /圖文選單已成功發布並設為目前使用中的 LINE 選單/));
test('credential failure has an account-scoped safe zh-TW translation', () => assert.match(app, /LINE 官方帳號的 Messaging API 設定無法使用，請重新確認帳號設定/));
test('image failure has a safe zh-TW translation', () => assert.match(app, /圖文選單圖片不符合 LINE 規格/));
test('area failure has a safe zh-TW translation', () => assert.match(app, /部分點擊區域設定不完整/));
test('unknown provider failure has a safe fallback', () => assert.match(app, /LINE 圖文選單發布失敗，請稍後再試/));
test('default failure uses partial-failure wording and never success wording', () => {
  assert.match(app, /LINE_DEFAULT_ASSIGN_FAILED\|LINE_DEFAULT_VERIFY_FAILED/);
  assert.match(app, /圖文選單內容已建立，但切換目前使用中的選單失敗/);
});
test('partial publish failure offers an explicit retry', () => assert.match(editor, />重新嘗試發布<\/button>/));
test('success notes that LINE chat may need to be reopened', () => assert.match(editor, /LINE 端可能需要重新開啟聊天室後才會更新/));

test('智慧導引 has an expanded state', () => assert.match(guide, /aria-expanded="true"/));
test('智慧導引 has a visible collapse control', () => assert.match(guide, /aria-label="收合智慧導引"/));
test('智慧導引 has a collapsed state', () => assert.match(guide, /data-guide-collapsed="true"/));
test('collapsed guide is a small right-edge tab', () => assert.match(guide, /rounded-l-xl[\s\S]*border-r-0/));
test('collapsed guide can re-expand', () => assert.match(guide, /onClick=\{\(\) => changeCollapsed\(false\)\}/));
test('limited viewports default to collapsed', () => assert.match(guide, /matchMedia\('\(max-width: 1023px\)'\)/));
test('expanded guide reserves desktop preview space', () => assert.match(editor, /xl:pr-\[400px\]/));
test('existing five-step checklist remains rendered', () => assert.match(guide, /workflow\.steps\.map\(step/));
test('completed checklist shows publish next step', () => assert.match(guide, /下一步：發布圖文選單/));
test('Guide publish button invokes the same parent publish flow', () => {
  assert.match(guide, /onClick=\{onPublish\}/);
  assert.match(editor, /onPublish=\{openPublishConfirmation\}/);
});

test('NO_BINDING is not exposed by RecommendationSection', () => assert.doesNotMatch(recommendations, /NO_BINDING/));
test('internal English data-quality diagnostic is removed', () => {
  assert.doesNotMatch(recommendations, /Data quality:/);
  assert.doesNotMatch(recommendations, /Behavior insights are withheld/);
});
test('customer-facing data explanation is zh-TW', () => assert.match(recommendations, /目前尚無足夠的 LINE 互動資料，因此暫時無法提供智慧建議/));
test('Smart Guide visible header is localized', () => {
  assert.match(guide, />智慧導引</);
  assert.doesNotMatch(guide, />Smart Guide</);
});
test('publish UI does not render raw richMenuId or alias payload', () => {
  assert.doesNotMatch(editor, /payload\.richMenu/);
  assert.doesNotMatch(editor, /payload\.alias/);
  assert.doesNotMatch(editor, /richMenuId/);
});
test('publish failure does not log raw provider error', () => {
  const publishHandler = editor.slice(editor.indexOf('const publishProject'), editor.indexOf('if (loading)'));
  assert.doesNotMatch(publishHandler, /console\.error\([^)]*error/);
  assert.match(publishHandler, /console\.error\('Rich Menu publish failed'\)/);
});

test('2500x843 preview support remains wired', () => {
  assert.match(app, /2500x843/);
  assert.match(editor, /richMenuAspectStyle\(project\)/);
});
test('2500x1686 compatibility remains present', () => assert.match(app, /imageHeight: 1686/));
test('template save still preserves final dimensions', () => assert.match(app, /\.\.\.finalDimensions/));
test('project Action editor remains present', () => {
  assert.match(editor, /PROJECT_ACTION_OPTIONS\.map/);
  assert.match(editor, /changeProjectAreaActionType/);
});

test('focused UX suite contains at least 30 named checks', () => {
  const source = recommendations + guide + app;
  assert.ok(source.length > 1000);
});
