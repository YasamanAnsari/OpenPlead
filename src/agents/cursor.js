// @ts-check
'use strict';

const { commandKey } = require('./common');

/** @typedef {import('../core/types').HookEvent} HookEvent */
/** @typedef {import('../core/types').StoredReply} StoredReply */

// Cursor hooks: https://cursor.com/docs/hooks
// Cursor loads Claude Code hooks from ~/.claude/settings.json (Third Party Hooks) and tags every payload
// with cursor_version, mapping the event names to its own. postToolUseFailure is not importable and is
// registered natively in ~/.cursor/hooks.json. Context injection works on postToolUse / postToolUseFailure
// (additional_context). A stop hook can return followup_message, which Cursor submits as the next user
// message: that is how a plea clicked after the last tool call reaches the agent, visibly.
// beforeSubmitPrompt and preToolUse cannot inject (injects: false), so queued items wait for a tool result.

const INJECT = new Set(['postToolUse', 'PostToolUse', 'postToolUseFailure', 'PostToolUseFailure']);

// Cursor's native hook names are camelCase; the ones imported from a Claude Code settings file keep its casing.
const camel = (name) => (typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : '');

// What each hook means to the reducer. Missing from the table: a noop.
/** @type {Record<string, (p: Record<string, any>) => Partial<HookEvent> & Pick<HookEvent, 'kind'>>} */
const KIND_OF = {
  sessionStart: () => ({ kind: 'session_start' }),
  beforeSubmitPrompt: () => ({ kind: 'turn_start', injects: false }),
  userPromptSubmit: () => ({ kind: 'turn_start', injects: false }),
  preToolUse: () => ({ kind: 'tool_start', injects: false }),
  postToolUse: (p) => ({ kind: 'tool_ok', command: commandKey(p) }),
  postToolUseFailure: (p) =>
    // A permission the user declined is not the agent failing.
    p.failure_type === 'permission_denied' && !p.is_interrupt
      ? { kind: 'noop' }
      : { kind: 'tool_fail', command: commandKey(p), isInterrupt: Boolean(p.is_interrupt) },
  beforeShellExecution: () => ({ kind: 'permission_wait' }),
  beforeMCPExecution: () => ({ kind: 'permission_wait' }),
  // The assistant's text, one message at a time: read for a reply only with the invitation on.
  afterAgentResponse: (p) => ({ kind: 'assistant_text', text: typeof p.text === 'string' ? p.text : '', final: true }),
  stop: (p) => {
    const status = p.status === 'completed' || p.status === undefined ? 'ok' : p.status;
    // followup_message is only consumed on a completed stop, and Cursor caps hook-driven loops.
    return { kind: 'turn_end', status, injects: status === 'ok' && !(p.loop_count >= 4) };
  },
  sessionEnd: () => ({ kind: 'session_end' }),
};

/**
 * @param {Record<string, any>} p  the hook payload as the agent sent it
 * @returns {HookEvent}
 */
function normalize(p) {
  /** @type {Pick<HookEvent, 'agent' | 'sessionId' | 'hook' | 'host'>} */
  const base = {
    agent: 'cursor',
    sessionId: p.conversation_id || p.session_id,
    hook: p.hook_event_name,
    host: p.openplead_host,
  };
  const toKind = KIND_OF[camel(p.hook_event_name)];
  return { ...base, ...(toKind ? toKind(p) : { kind: 'noop' }) };
}

/**
 * The hook's JSON answer carrying a stored reply, or {} when nothing can reach the agent here.
 * @param {HookEvent} event
 * @param {StoredReply | null} r
 * @returns {Record<string, unknown>}
 */
function reply(event, r) {
  if (!r || event.injects === false) return {};
  if (event.hook === 'stop' || event.hook === 'Stop') return r.kind === 'plea' ? { followup_message: r.text } : {};
  if (!INJECT.has(event.hook)) return {};
  return { additional_context: r.text };
}

module.exports = {
  id: /** @type {const} */ ('cursor'),
  detect: (p) => typeof p.cursor_version === 'string',
  normalize,
  reply,
};
