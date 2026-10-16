// @ts-check
'use strict';

const { hotkeysFor } = require('./menu');
const { quietLabel, isQuiet } = require('../core/quiet');
const { appName, agentName } = require('../core/apps');
const { SHOW_MODES } = require('../system/config');
const { SET_INFO } = require('../core/phrases');

// What the settings window shows and may change. Pure, so the window's contract is checked in tests. Five panes,
// each answering one question: Grovel (where he shows, sound, keyboard, position), Messages (what he says), Replies
// (what Claude said back), Connection, About.

// Where Grovel is on screen: one choice.
const SHOW_OPTIONS = [
  {
    value: 'agentFront',
    label: "Only while my agent's window is in front",
    hint: 'He steps aside when another app is in front or the window is minimized.',
  },
  { value: 'session', label: 'Whenever an agent session is open, over any app', hint: '' },
  { value: 'always', label: 'Always, even with no agent', hint: '' },
];
const MUTE_OPTIONS = [
  { value: 0, label: 'Not muted' },
  { value: 60, label: 'For an hour' },
  { value: -1, label: 'Until I turn it off' },
];
const SETTABLE = new Set(['thanks', 'cursor', 'followDesktops', 'sounds', 'inviteReply', 'hotkey', 'showMode']);
const ACTIONS = new Set([
  'install',
  'uninstall',
  'openPhrases',
  'resetPosition',
  'unpark',
  'quietFor',
  'focusAgent',
  'done',
  'quit',
  'demo',
  'resetPhrases',
  'chime',
  'copyRecord',
  'importPhrases',
  'copyReply',
  'replyCard',
  'clearReplies',
  'checkConnection',
  'openLog',
]);

const canSet = (key) => SETTABLE.has(key);
const canRun = (name) => ACTIONS.has(name);

// The lifetime tally as a sentence.
function recordSentence({ pleas = 0, thanks = 0, panics = 0 } = {}) {
  const times = (n) => `${n} time${n === 1 ? '' : 's'}`;
  return `You pleaded ${times(pleas)}. Claude was thanked ${times(thanks)}. ${panics} panic${panics === 1 ? '' : 's'}.`;
}

function settingsPayload({ settings, status, platform, version }) {
  const muted = isQuiet(settings);
  return {
    version,
    platform,
    firstRun: settings.firstRun !== false,
    show: {
      mode: SHOW_MODES.includes(settings.showMode) ? settings.showMode : 'agentFront',
      options: SHOW_OPTIONS,
      followDesktops: { on: Boolean(settings.followDesktops), available: platform !== 'win32' },
    },
    sound: {
      sounds: Boolean(settings.sounds),
      mute: {
        value: settings.quietUntil === -1 ? -1 : muted ? 60 : 0,
        label: muted ? quietLabel(settings) : 'Not muted',
        options: MUTE_OPTIONS,
      },
    },
    hotkeys: hotkeysFor(platform).map((accel) => ({
      accel,
      label: accel ? accel.replace(/\+/g, ' ') : 'Off',
      on: (settings.hotkey || null) === accel,
    })),
    position: { parked: Boolean(settings.parked) },
    messages: { thanks: Boolean(settings.thanks), inviteReply: Boolean(settings.inviteReply) },
    cursor: Boolean(settings.cursor),
    phraseSets: SET_INFO,
    status: {
      installed: Boolean(status.installed),
      hooksCurrent: Boolean(status.hooksCurrent),
      port: status.port,
      sessions: (status.sessionList || []).map((s) => ({ ...s, name: agentName(s.agent) })), // shown in plain words
      hosts: status.hosts || [],
      hostNames: (status.hosts || []).map(appName),
      visible: Boolean(status.visible),
      showMode: status.showMode || 'agentFront',
      agentInFront: status.agentInFront !== false,
      replies: Array.isArray(status.replies) ? status.replies : [], // what the agent said back, newest first
      check: status.check || null, // the last "Check the connection" result: { ok, text, at }
      logFile: status.logFile || '',
    },
    record: recordSentence(status.stats),
    canFocus: platform === 'darwin' && (status.hosts || []).length > 0,
  };
}

module.exports = { canSet, canRun, settingsPayload, recordSentence };
