// @ts-check
'use strict';

// The contracts between the pure core, the agent adapters and the app, as JSDoc types. Nothing runs here; the
// `// @ts-check` files import these so an editor or `tsc --checkJs` can hold them to it.

/** @typedef {'claude-code' | 'cursor'} Agent */

/** @typedef {'plea' | 'calm' | 'thanks' | 'deadline' | 'thinking' | 'suspicious' | 'hug' | 'zen' | 'apology'} Kind */

/**
 * One line that went out, or is waiting to.
 * @typedef {object} Line
 * @property {Kind} kind
 * @property {number} [level]   plea ladder step, 1 to 5
 * @property {string} [phrase]  chosen by main as soon as the line is queued
 * @property {number} [at]
 */

/**
 * An agent conversation as the reducer tracks it.
 * @typedef {object} Session
 * @property {Agent} agent
 * @property {number} lastSeen
 * @property {boolean} turnActive
 * @property {number} turnSince
 * @property {number} errorStreak
 * @property {string[]} failedCommands
 * @property {number} turnFailures
 * @property {boolean} thinkingSent
 * @property {Array<Line & { invite: boolean }>} sent   lines delivered this turn
 */

/** @typedef {{ pleas: number, thanks: number, panics: number }} Stats */

/**
 * @typedef {object} State
 * @property {{ thanks: boolean, [key: string]: unknown }} settings
 * @property {Record<string, Session>} sessions
 * @property {string | null} activeSession
 * @property {number} level                 the plea ladder, 0 when calm
 * @property {Line | null} pending          plea waiting for the next tool call of the running turn
 * @property {Line | null} nextPrompt       line waiting for the user's next message
 * @property {{ mood: string, until: number } | null} transient
 * @property {number} pleadUntil
 * @property {number} panicUntil
 * @property {number} deadlineUntil
 * @property {number} deadlineMinutes
 * @property {boolean} permissionWait
 * @property {number} lastClickAt
 * @property {number} lastHookAt
 * @property {Stats} stats                  lifetime, persisted by main
 * @property {Stats | null} runStats        stats when this run's first session began
 */

/**
 * What an agent hook became after its adapter normalised it.
 * @typedef {object} HookEvent
 * @property {Agent} agent
 * @property {string} sessionId
 * @property {string} hook             the agent's own hook name
 * @property {'session_start' | 'turn_start' | 'assistant_text' | 'tool_start' | 'tool_ok' | 'tool_fail'
 *   | 'permission_wait' | 'turn_end' | 'session_end' | 'noop'} kind
 * @property {boolean} [injects]       false when a reply cannot reach the agent through this hook
 * @property {boolean} [invite]        false when the hook was installed without the reply invitation
 * @property {string} [host]           the app the session runs in, when the shim knew
 * @property {string} [command]        tool_ok / tool_fail
 * @property {boolean} [isInterrupt]   tool_fail
 * @property {string} [text]           assistant_text
 * @property {boolean} [final]         assistant_text
 * @property {'ok' | 'error'} [status] turn_end
 * @property {string} [lastMessage]    turn_end
 */

/**
 * @typedef {{ type: 'click' } | { type: 'wake' } | { type: 'tick', alive?: string[] }
 *   | { type: 'menu', action: string, minutes?: number, level?: number }
 *   | { type: 'hook', event: HookEvent }} Input
 */

/**
 * @typedef {{ type: 'bubble', text: string, ms?: number }
 *   | { type: 'reply', kind: Kind, level: number, phrase?: string }
 *   | { type: 'queued', level: number, soon?: 'next message' | 'next tool call' }
 *   | { type: 'dropped', kind: Kind, level: number, phrase?: string, reason: string }
 *   | { type: 'sound', name: string }} Effect
 */

/** @typedef {{ state: State, effects: Effect[] }} Outcome */

/**
 * A stored reply the adapter hands back to the agent.
 * @typedef {{ text: string, kind: Kind, level: number, phrase: string }} StoredReply
 */

module.exports = {};
