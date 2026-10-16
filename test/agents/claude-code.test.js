'use strict';

// The Claude Code adapter: hook payloads become events, and a reply becomes the JSON the hook prints.
const test = require('node:test');
const assert = require('node:assert/strict');
const adapter = require('../../src/agents/claude-code');

const payload = (hook_event_name, extra = {}) => ({ hook_event_name, session_id: 's1', ...extra });

test('hook events map to the kinds the reducer knows; subagents never inject', () => {
  assert.equal(adapter.detect(payload('SessionStart')), true);
  assert.equal(
    adapter.detect({ hook_event_name: 'SessionStart', cursor_version: '1' }),
    false,
    'Cursor payloads carry cursor_version',
  );
  assert.equal(adapter.normalize(payload('SessionStart')).kind, 'session_start');
  assert.equal(adapter.normalize(payload('UserPromptSubmit')).kind, 'turn_start');
  const ok = adapter.normalize(payload('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.deepEqual([ok.kind, ok.command], ['tool_ok', 'ls']);
  const stop = adapter.normalize(payload('Stop', { last_assistant_message: 'Done.' }));
  assert.deepEqual([stop.kind, stop.status, stop.injects, stop.lastMessage], ['turn_end', 'ok', true, 'Done.']);
  assert.equal(adapter.normalize(payload('Stop', { stop_hook_active: true })).injects, false, 'already continuing');
  assert.equal(adapter.normalize(payload('StopFailure')).status, 'error');
  assert.equal(adapter.normalize(payload('SessionEnd')).kind, 'session_end');
  assert.equal(adapter.normalize(payload('PreToolUse', { agent_id: 'sub' })).injects, false);
  assert.equal(adapter.normalize(payload('Whatever')).kind, 'noop');
});

test('a reply rides on the hooks that accept context, blocks a Stop, and is never sent where it cannot go', () => {
  const r = { text: 'The user says: "hi"', kind: 'plea', level: 2, phrase: 'hi' };
  const post = adapter.reply(adapter.normalize(payload('PostToolUse')), r);
  assert.equal(post.hookSpecificOutput.additionalContext, r.text);
  assert.equal(post.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(post.systemMessage, /OpenPlead sent: "hi"/);
  const stop = adapter.reply(adapter.normalize(payload('Stop')), r);
  assert.deepEqual([stop.decision, stop.reason], ['block', r.text]);
  assert.deepEqual(
    adapter.reply(adapter.normalize(payload('Stop')), { ...r, kind: 'thanks' }),
    {},
    'only a plea blocks',
  );
  assert.deepEqual(adapter.reply(adapter.normalize(payload('SessionEnd')), r), {});
  assert.deepEqual(adapter.reply(adapter.normalize(payload('PostToolUse', { agent_id: 'sub' })), r), {});
  assert.deepEqual(adapter.reply(adapter.normalize(payload('PostToolUse')), null), {});
});
