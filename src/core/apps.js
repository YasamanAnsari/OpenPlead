// @ts-check
'use strict';

// Friendly names for the apps agents run in: macOS bundle ids and, on Windows and Linux, process names.
const APP_NAMES = {
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  'com.apple.Terminal': 'Terminal',
  'com.googlecode.iterm2': 'iTerm',
  'com.microsoft.VSCode': 'VS Code',
  'com.github.wez.wezterm': 'WezTerm',
  'net.kovidgoyal.kitty': 'kitty',
  'io.alacritty': 'Alacritty',
  'com.mitchellh.ghostty': 'Ghostty',
  'dev.warp.Warp-Stable': 'Warp',
  cursor: 'Cursor',
  code: 'VS Code',
  windowsterminal: 'Windows Terminal',
  'gnome-terminal-server': 'GNOME Terminal',
  'gnome-terminal-': 'GNOME Terminal',
  konsole: 'Konsole',
  alacritty: 'Alacritty',
  kitty: 'kitty',
  wezterm: 'WezTerm',
  ghostty: 'Ghostty',
};

const AGENT_NAMES = { 'claude-code': 'Claude Code', cursor: 'Cursor' };

function appName(id) {
  if (!id) return "the agent's app";
  if (APP_NAMES[id]) return APP_NAMES[id];
  return id.includes('.') ? id.split('.').pop() : id;
}

const agentName = (agent) => AGENT_NAMES[agent] || agent || 'the agent';
// The agent as a person, for sentences: "Plead with Claude", "Thank Cursor".
const SHORT_NAMES = { 'claude-code': 'Claude', cursor: 'Cursor' };
const shortName = (agent) => SHORT_NAMES[agent] || agentName(agent);

module.exports = { appName, agentName, shortName };
