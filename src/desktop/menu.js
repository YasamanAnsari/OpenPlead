// @ts-check
'use strict';

const { nextLevelOf, sessionCount, MAX_LEVEL } = require('../core/state');
const { appName, agentName, shortName } = require('../core/apps');
const { isQuiet, quietLabel } = require('../core/quiet');
const { labelFor } = require('../renderer/case');
const { clip } = require('../core/tag');

// The right-click and tray menu as an Electron template; ctx carries the state and main's actions, so this file needs
// no Electron. Four groups: what is happening, what can I send, what came back, how the pet behaves. Items name who
// gets what ("Plead with Claude"); macOS 14.4+ gets a sublabel per item, elsewhere the label carries the fact. An
// ellipsis means "more input needed", so only Settings… and See all replies… have one.
//   ctx: { state, settings, pinned, canFocus, agentApp, replies, platform, now, actions }
//   actions: { dispatch(input), quit(reason), setSetting(key, value), togglePin(), quietFor(minutes), focusAgent(),
//              openSettings(tab), replyCard(at) }

// Control+Shift+P is the command palette in every editor on Windows and Linux; on macOS that palette is Cmd+Shift+P.
const hotkeysFor = (platform) =>
  platform === 'darwin'
    ? [null, 'Control+Shift+P', 'Control+Shift+Space']
    : [null, 'Control+Alt+P', 'Control+Alt+Space'];

const REASSURE = [
  ['hug', "It's okay, carry on", 'The slip is forgiven; Claude keeps going.'],
  ['zen', 'Take your time, do it properly', 'Also removes the deadline and the plea ladder.'],
  ['apology', 'Sorry for my tone', ''],
];
const DEADLINES = [5, 15, 30];
const SHOWN_REPLIES = 3;

// What is waiting to go out, in plain words.
const WAITING = {
  thanks: 'a thank-you',
  deadline: 'the deadline note',
  thinking: 'a nudge',
  suspicious: 'a question',
  hug: 'a reassurance',
  zen: 'a reassurance',
  apology: 'an apology',
  calm: 'a calm line',
};
function waitingLabel(item) {
  const kind = item.kind || 'plea';
  return kind === 'plea' ? `plea ${item.level} of ${MAX_LEVEL}` : WAITING[kind] || kind;
}

// "2 min ago", for the replies.
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
function ago(at, now) {
  const seconds = Math.max(0, now - at) / 1000;
  if (seconds < MINUTE_S) return 'just now';
  if (seconds < HOUR_S) return `${Math.round(seconds / MINUTE_S)} min ago`;
  if (seconds < DAY_S) return `${Math.round(seconds / HOUR_S)} h ago`;
  const days = Math.round(seconds / DAY_S);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// The two lines at the top: what the agent is doing, then what goes out next or how to send something.
function statusLines({ state }) {
  const session = state.activeSession && state.sessions[state.activeSession];
  const count = sessionCount(state);
  const waiting = state.pending || state.nextPrompt;
  const who = session ? shortName(session.agent) : null;
  const first = !session
    ? 'No agent open'
    : count > 1
      ? `Talking to ${agentName(session.agent)}`
      : state.permissionWait
        ? `${who} needs your OK`
        : session.turnActive
          ? `${who} is working`
          : `${who} is waiting for you`;
  const second = !session
    ? 'Start Claude Code or Cursor and Grovel wakes up'
    : waiting
      ? `Next up: ${waitingLabel(waiting)}${waiting.phrase ? ` “${clip(waiting.phrase, 60)}”` : ''}`
      : session.turnActive
        ? `Click Grovel to plead; the line goes with ${who}'s next tool call`
        : 'Click Grovel to plead; the line goes with your next message';
  return [first, second];
}

function repliesMenu({ replies, settings, now, caption, hint, who, actions }) {
  const shown = replies.slice(0, SHOWN_REPLIES).map((entry) => ({
    label: `“${clip(entry.reply, 60)}”`,
    ...hint(`${ago(entry.at, now)} · click to save a card`),
    click: () => actions.replyCard(entry.at),
  }));
  const none = {
    label: caption('No replies yet'),
    ...hint(
      settings.inviteReply
        ? `Plead, then wait for the turn to end. ${who} answers about three times in four.`
        : 'Turn on the switch below, then plead.',
    ),
    enabled: false,
  };
  return [
    ...(shown.length ? shown : [none]),
    { type: 'separator' },
    {
      label: caption(`Ask ${who} to reply to Grovel`),
      ...hint('Adds “A one-line answer is welcome.” to each line.'),
      type: 'checkbox',
      checked: Boolean(settings.inviteReply),
      click: (item) => actions.setSetting('inviteReply', item.checked),
    },
    { label: caption('See all replies…'), click: () => actions.openSettings('replies') },
  ];
}

// "Set a deadline": radio items for the preset minutes, the running one showing what is left.
function deadlineMenu({ state, now, session, caption, hint, send }) {
  const deadlineOn = state.deadlineUntil > now;
  const left = deadlineOn ? Math.ceil((state.deadlineUntil - now) / 60_000) : 0;
  return {
    label: caption('Set a deadline'),
    ...hint(
      deadlineOn
        ? `${left} min left. Grovel mentioned it once and watches the clock.`
        : 'Grovel mentions it once, then watches the clock.',
    ),
    enabled: Boolean(session),
    submenu: [
      ...DEADLINES.map((minutes) => {
        const on = deadlineOn && state.deadlineMinutes === minutes;
        return {
          label: caption(on ? `In ${minutes} minutes (${left} left)` : `In ${minutes} minutes`),
          type: 'radio',
          checked: on,
          click: send('deadline', { minutes }),
        };
      }),
      { type: 'separator' },
      { label: caption('No deadline'), type: 'radio', checked: !deadlineOn, click: send('deadline', { minutes: 0 }) },
    ],
  };
}

// "Show Grovel on every app": the pin, or the Always setting that makes the pin moot.
function showEverywhereItem({ settings, pinned, canFocus, agentApp, mac, caption, hint, actions }) {
  const everywhere = settings.showMode === 'always';
  const why = everywhere
    ? 'Always, from Settings.'
    : pinned
      ? 'Until this session ends.'
      : settings.showMode === 'session'
        ? 'Otherwise only while an agent session is open.'
        : `Otherwise only over ${canFocus ? `${appName(agentApp)}'s` : "the agent's"} window.`;
  return {
    label: caption(
      mac || pinned || everywhere ? 'Show Grovel on every app' : 'Show Grovel on every app until the session ends',
    ),
    ...hint(why),
    type: 'checkbox',
    checked: pinned || everywhere,
    enabled: !everywhere,
    click: () => actions.togglePin(),
  };
}

function menuTemplate(ctx) {
  const { state, settings, pinned, canFocus, agentApp, platform, actions } = ctx;
  const now = ctx.now || Date.now();
  const replies = ctx.replies || [];
  const mac = platform === 'darwin';
  const caption = (label) => labelFor(platform, label);
  const hint = (text) => (mac && text ? { sublabel: text } : {});
  const session = state.activeSession && state.sessions[state.activeSession];
  const who = session ? shortName(session.agent) : 'your agent';
  const replyWho = session ? who : 'Claude';
  const sessions = Object.entries(state.sessions);
  const waiting = state.pending || state.nextPrompt;
  const quiet = isQuiet(settings, now);
  const send =
    (action, extra = {}) =>
    () =>
      actions.dispatch({ type: 'menu', action, ...extra });
  const [first, second] =
    ctx.installed === false ? ['Not connected', 'Choose Connect below, then start a session'] : statusLines({ state });
  const status = mac
    ? [{ label: first, enabled: false, ...hint(second) }]
    : [
        { label: first, enabled: false },
        { label: second, enabled: false },
      ];
  return [
    ...status,
    { type: 'separator' },
    // Not connected yet: the one thing to do comes first.
    ...(ctx.installed === false
      ? [
          {
            label: caption('Connect to Claude Code…'),
            ...hint('Opens Settings → Connection. Grovel wakes up at your next session.'),
            click: () => actions.openSettings('connection'),
          },
        ]
      : []),
    // What to send.
    {
      label: caption(mac ? `Plead with ${who}` : `Plead with ${who} (same as clicking Grovel)`),
      ...hint(`Clicking Grovel does the same. Each time is stronger; next is ${nextLevelOf(state)} of ${MAX_LEVEL}.`),
      enabled: Boolean(session),
      ...(settings.hotkey ? { accelerator: settings.hotkey, registerAccelerator: false } : {}),
      click: () => actions.dispatch({ type: 'click' }),
    },
    // With two sessions alive, which one the nameplate and the next line are for (otherwise nothing to choose).
    ...(sessions.length > 1
      ? [
          {
            label: caption('Talk to'),
            submenu: sessions.map(([id, s]) => ({
              label: `${agentName(s.agent)} · ${s.turnActive ? 'working' : 'waiting'} · ${id.slice(0, 8)}`,
              type: 'radio',
              checked: id === state.activeSession,
              click: send('target', { sessionId: id }),
            })),
          },
        ]
      : []),
    {
      label: caption(mac ? `Thank ${who}` : `Thank ${who} with my next message`),
      ...hint('Goes with your next message.'),
      enabled: Boolean(session),
      click: send('thank'),
    },
    {
      label: caption(`Reassure ${who}`),
      enabled: Boolean(session),
      submenu: REASSURE.map(([kind, label, explain]) => ({
        label: caption(label),
        ...hint(explain),
        click: send('say', { kind }),
      })),
    },
    deadlineMenu({ state, now, session, caption, hint, send }),
    { label: caption('Cancel the next message'), enabled: Boolean(waiting), click: send('reset') },
    { type: 'separator' },
    // What came back.
    {
      label: caption(`${replyWho}'s replies`),
      ...hint(replies.length ? 'Click a reply to save it as a picture card.' : ''),
      submenu: repliesMenu({ replies, settings, now, caption, hint, who: replyWho, actions }),
    },
    { type: 'separator' },
    // How he behaves right now: check marks show the state.
    {
      label: caption('Mute for an hour'),
      ...hint(quiet ? quietLabel(settings, now) : 'No sounds or chatter. Results still show.'),
      type: 'checkbox',
      checked: quiet,
      click: (item) => actions.quietFor(item.checked ? 60 : 0),
    },
    showEverywhereItem({ settings, pinned, canFocus, agentApp, mac, caption, hint, actions }),
    {
      label: caption(canFocus ? `Go to ${appName(agentApp)}` : "Go to the agent's app"),
      enabled: Boolean(canFocus),
      click: () => actions.focusAgent(),
    },
    { type: 'separator' },
    // Settings opens a window that needs no further input: Windows writes it plain, macOS with its customary ellipsis.
    { label: mac ? 'Settings…' : 'Settings', click: () => actions.openSettings() },
    { label: platform === 'win32' ? 'Exit' : caption('Quit OpenPlead'), click: () => actions.quit('menu') },
  ];
}

module.exports = { hotkeysFor, menuTemplate, ago };
