import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProjectAreaAction,
  projectAreaActionFromRow,
  richMenuAliasIdForProject,
} from '../src/project-actions.mjs';

test('template action is copied without mutating the template source', () => {
  const templateArea = Object.freeze({
    action: Object.freeze({ type: 'uri', uri: 'https://example.com' }),
  });
  const projectAction = normalizeProjectAreaAction(templateArea);
  assert.deepEqual(projectAction, { type: 'uri', uri: 'https://example.com' });
  assert.deepEqual(templateArea.action, { type: 'uri', uri: 'https://example.com' });
});

test('project action can transition from URI to Message to Postback', () => {
  assert.deepEqual(normalizeProjectAreaAction({ type: 'message', text: '我要了解中騰保全' }), {
    type: 'message',
    text: '我要了解中騰保全',
  });
  assert.deepEqual(normalizeProjectAreaAction({
    type: 'postback',
    data: 'action=security_info',
    displayText: '查看中騰保全',
  }), {
    type: 'postback',
    data: 'action=security_info',
    displayText: '查看中騰保全',
  });
});

test('Rich Menu Switch derives Sakura-compatible alias and data from target page', () => {
  const targetPageId = 'prj_1786173716184_3b7ed4a73f9e';
  const action = normalizeProjectAreaAction(
    { type: 'richmenuswitch', targetPageId },
    { allowedTargetPageIds: new Set([targetPageId]) },
  );
  assert.deepEqual(action, {
    type: 'richmenuswitch',
    targetPageId,
    richMenuAliasId: richMenuAliasIdForProject(targetPageId),
    data: `switch:${richMenuAliasIdForProject(targetPageId)}`,
  });
});

test('cross-workspace or unknown switch target is rejected', () => {
  assert.throws(
    () => normalizeProjectAreaAction(
      { type: 'richmenuswitch', targetPageId: 'workspace-b-project' },
      { allowedTargetPageIds: new Set(['workspace-a-project']) },
    ),
    /INVALID_SWITCH_TARGET/,
  );
});

test('D1 project area rows normalize to the same action schema', () => {
  assert.deepEqual(projectAreaActionFromRow({
    action_type: 'postback',
    action_data: 'action=security_info',
    action_display_text: '',
  }), {
    type: 'postback',
    data: 'action=security_info',
  });
});