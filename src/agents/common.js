// @ts-check
'use strict';

// Shared by the adapters: the key that identifies a tool call in the pet's failure bookkeeping (the command, the
// file, or at least the tool's name).
/** @param {Record<string, any>} p */
function commandKey(p) {
  const input = p.tool_input || {};
  return String(input.command || input.file_path || p.tool_name || '');
}

module.exports = { commandKey };
