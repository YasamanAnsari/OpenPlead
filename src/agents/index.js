// @ts-check
'use strict';

/**
 * One adapter per agent.
 * @typedef {object} Adapter
 * @property {import('../core/types').Agent} id
 * @property {(payload: Record<string, any>) => boolean} detect
 * @property {(payload: Record<string, any>) => import('../core/types').HookEvent} normalize
 * @property {(event: import('../core/types').HookEvent, reply: import('../core/types').StoredReply | null) => Record<string, unknown>} reply
 */

// Order matters: the first adapter whose detect() returns true wins, so put the more specific ones first.
/** @type {Adapter[]} */
const adapters = [require('./cursor'), require('./claude-code')];

/** @returns {Adapter | null} */
function detect(payload) {
  return adapters.find((a) => a.detect(payload)) || null;
}

module.exports = { adapters, detect };
