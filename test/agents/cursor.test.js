'use strict';

// The Cursor adapter: its own hook names, text only with a tool result or at the end of a turn.
const test = require('node:test');
const assert = require('node:assert/strict');
const adapter = require('../../src/agents/cursor');

const payload = (hook_event_name, extra = {}) => ({
  hook_event_name,
  conversation_id: 'c1',
  cursor_version: '1.0',
  ...extra,
});

test('Cursor payloads are recognised by cursor_version and mapped, with the hooks that cannot inject marked', () => {
  assert.equal(adapter.detect(payload('sessionStart')), true);
  assert.equal(adapter.detect({ hook_event_name: 'SessionStart' }), false);
  assert.equal(adapter.normalize(payload('sessionStart')).kind, 'session_start');
  const prompt = adapter.normalize(payload('beforeSubmitPrompt'));
  assert.deepEqual([prompt.kind, prompt.injects], ['turn_start', false]);
  const ok = adapter.normalize(payload('postToolUse', { tool_name: 'Shell', tool_input: { command: 'pwd' } }));
  assert.deepEqual([ok.kind, ok.command], ['tool_ok', 'pwd']);
  const denied = adapter.normalize(payload('postToolUseFailure', { failure_type: 'permission_denied' }));
  assert.equal(denied.kind, 'noop', 'a permission the user declined is not the agent failing');
  const stop = adapter.normalize(payload('stop', { status: 'completed' }));
  assert.deepEqual([stop.kind, stop.status, stop.injects], ['turn_end', 'ok', true]);
  assert.equal(
    adapter.normalize(payload('stop', { status: 'completed', loop_count: 4 })).injects,
    false,
    'Cursor caps hook loops',
  );
  const text = adapter.normalize(payload('afterAgentResponse', { text: 'Thanks.' }));
  assert.deepEqual([text.kind, text.text], ['assistant_text', 'Thanks.']);
});

test('a reply goes out as additional context on a tool result or as the follow-up message at a completed stop', () => {
  const r = { text: 'The user says: "hi"', kind: 'plea', level: 1, phrase: 'hi' };
  assert.deepEqual(adapter.reply(adapter.normalize(payload('postToolUse')), r), { additional_context: r.text });
  assert.deepEqual(adapter.reply(adapter.normalize(payload('stop', { status: 'completed' })), r), {
    followup_message: r.text,
  });
  assert.deepEqual(
    adapter.reply(adapter.normalize(payload('stop', { status: 'completed' })), { ...r, kind: 'thanks' }),
    {},
  );
  assert.deepEqual(
    adapter.reply(adapter.normalize(payload('beforeSubmitPrompt')), r),
    {},
    'the prompt hook cannot carry text',
  );
  assert.deepEqual(adapter.reply(adapter.normalize(payload('postToolUse')), null), {});
});
