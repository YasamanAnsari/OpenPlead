// @ts-check
'use strict';

const { commandKey } = require('./common');

/** @typedef {import('../core/types').HookEvent} HookEvent */
/** @typedef {import('../core/types').StoredReply} StoredReply */

// Claude Code hooks: https://code.claude.com/docs/en/hooks
// Context can be injected on UserPromptSubmit, PreToolUse, PostToolUse and PostToolUseFailure. A Stop hook
// can keep Claude working with { decision: 'block', reason }, which is how a plea that arrives after the
// last tool call still reaches the agent, visibly, instead of waiting for the next prompt.
// Hooks also fire inside subagents (payload carries agent_id); nothing is delivered there, because the
// user is talking to the main conversation.

const INJECT = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

/**
 * @param {Record<string, any>} p  the hook payload as the agent sent it
 * @returns {HookEvent}
 */
function normalize(p) {
  const subagent = typeof p.agent_id === 'string' && p.agent_id.length > 0;
  /** @type {Pick<HookEvent, 'agent' | 'sessionId' | 'hook' | 'injects' | 'host'>} */
  const base = {
    agent: 'claude-code',
    sessionId: p.session_id,
    hook: p.hook_event_name,
    injects: !subagent,
    host: p.openplead_host,
  };
  switch (p.hook_event_name) {
    case 'SessionStart':
      return { ...base, kind: 'session_start' };
    case 'UserPromptSubmit':
      return { ...base, kind: 'turn_start' };
    case 'PreToolUse':
      return { ...base, kind: 'tool_start' };
    case 'PostToolUse':
      return { ...base, kind: 'tool_ok', command: commandKey(p) };
    case 'PostToolUseFailure':
      return { ...base, kind: 'tool_fail', command: commandKey(p), isInterrupt: Boolean(p.is_interrupt) };
    case 'MessageDisplay':
      // The assistant's text as it is displayed (per batch of lines; whole messages in non-interactive runs).
      return subagent
        ? { ...base, kind: 'noop' }
        : {
            ...base,
            kind: 'assistant_text',
            text: typeof p.delta === 'string' ? p.delta : '',
            final: Boolean(p.final),
          };
    case 'Notification':
      return { ...base, kind: p.notification_type === 'permission_prompt' ? 'permission_wait' : 'noop' };
    case 'Stop':
      // stop_hook_active: Claude is already continuing because of a Stop hook; do not block again.
      return {
        ...base,
        kind: 'turn_end',
        status: 'ok',
        injects: !subagent && !p.stop_hook_active,
        // the turn's final text, for the reply the user may have invited
        lastMessage: !subagent && typeof p.last_assistant_message === 'string' ? p.last_assistant_message : undefined,
      };
    case 'StopFailure':
      return { ...base, kind: 'turn_end', status: 'error' };
    case 'SessionEnd':
      return { ...base, kind: 'session_end' };
    default:
      return { ...base, kind: 'noop' };
  }
}

/**
 * The hook's JSON answer carrying a stored reply, or {} when nothing can reach the agent here.
 * @param {HookEvent} event
 * @param {StoredReply | null} r
 * @returns {Record<string, unknown>}
 */
function reply(event, r) {
  if (!r || event.injects === false) return {};
  const systemMessage = `OpenPlead sent: "${r.phrase}"`;
  if (event.hook === 'Stop') return r.kind === 'plea' ? { decision: 'block', reason: r.text, systemMessage } : {};
  if (!INJECT.has(event.hook)) return {};
  return { systemMessage, hookSpecificOutput: { hookEventName: event.hook, additionalContext: r.text } };
}

module.exports = {
  id: /** @type {const} */ ('claude-code'),
  detect: (p) => typeof p.hook_event_name === 'string' && !p.cursor_version,
  normalize,
  reply,
};
