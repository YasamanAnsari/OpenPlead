// @ts-check
'use strict';
/* global phrasesDirty, loadPhrases */

// The settings window: five panes, each answering one question (Grovel, Messages, Replies, Connection, About), plus
// the Welcome pane on the first run. The page only reads the view main hands it, flips a settable key or runs a
// named action; everything it shows is set as text, never as markup.

const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('nav button')]);
const sections = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('main section')]);
const byId = (id) => document.getElementById(id);
const L = (label) => window.labelCase.labelFor(current ? current.platform : '', label);

let welcomeShown = false; // the Welcome tab, opened again from About after first run
function showTab(name) {
  if (name === 'welcome') {
    welcomeShown = true;
    tabs.find((b) => b.dataset.tab === 'welcome').hidden = false;
  }
  for (const b of tabs) {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1; // one tab stop for the list; arrows move within it
  }
  for (const s of sections) s.hidden = s.dataset.tab !== name;
  const tab = tabs.find((b) => b.dataset.tab === name);
  document.title = tab ? tab.textContent.trim() : 'OpenPlead'; // the window names the pane it shows
  try {
    localStorage.setItem('tab', name); // reopened on the pane used last
  } catch {
    // ignored: no storage in this context; the window opens on Grovel
  }
}
function lastTab() {
  try {
    return localStorage.getItem('tab');
  } catch {
    return null;
  }
}

// Rows: a checkbox or a radio with a label and an optional hint, all as text.
function row({ type, name, label, hint, on, disabled = false, onChange }) {
  const el = document.createElement('label');
  el.className = 'row';
  const input = document.createElement('input');
  input.type = type;
  if (name) input.name = name;
  input.checked = on;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.className = 'text';
  const title = document.createElement('div');
  title.textContent = label;
  text.append(title);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'hint';
    h.textContent = hint;
    text.append(h);
  }
  el.append(input, text);
  return el;
}
const check = (opts) => row({ type: 'checkbox', ...opts });
const radio = (opts) => row({ type: 'radio', ...opts });
const setKey = (key) => (value) => window.openplead.set(key, value).then(render);
const run = (name, arg) => window.openplead.action(name, arg).then(render);

// "today 14:52", "yesterday 09:10", or the date.
function when(at) {
  const d = new Date(at);
  const now = new Date();
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return `today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(d) === day(yesterday)) return `yesterday ${time}`;
  return `${d.toLocaleDateString()} ${time}`;
}

function renderGrovel(v) {
  byId('show-modes').replaceChildren(
    ...v.show.options.map((o) =>
      radio({
        name: 'show',
        label: o.label,
        hint: o.hint,
        on: v.show.mode === o.value,
        onChange: () => setKey('showMode')(o.value),
      }),
    ),
  );
  byId('follow').replaceChildren(
    ...(v.show.followDesktops.available
      ? [
          check({
            label: 'Follow me to every desktop',
            hint: 'Otherwise he stays on the desktop he came up on.',
            on: v.show.followDesktops.on,
            onChange: setKey('followDesktops'),
          }),
        ]
      : []),
  );
  byId('sounds').replaceChildren(
    check({
      label: 'Sounds',
      hint: 'A chime when a task finishes, a sob at plea 5.',
      on: v.sound.sounds,
      onChange: setKey('sounds'),
    }),
  );
  byId('mute').replaceChildren(
    ...v.sound.mute.options.map((o) =>
      radio({
        name: 'mute',
        label: o.label,
        hint: o.value === v.sound.mute.value && v.sound.mute.value !== 0 ? v.sound.mute.label : '',
        on: v.sound.mute.value === o.value,
        onChange: () => run('quietFor', String(o.value)),
      }),
    ),
  );
  byId('hotkeys').replaceChildren(
    ...v.hotkeys.map((h) =>
      radio({
        name: 'hotkey',
        label: h.label,
        on: h.on,
        onChange: () => window.openplead.set('hotkey', h.accel).then(render),
      }),
    ),
  );
  /** @type {HTMLButtonElement} */ (byId('unpark')).disabled = !v.position.parked;
}

const INVITE_HINT = 'Adds "A one-line answer is welcome." to each line. Claude usually answers in its own words.';
function renderMessages(v) {
  byId('auto').replaceChildren(
    check({
      label: 'Thank Claude each time it finishes',
      hint: 'The thank-you goes with your next message.',
      on: v.messages.thanks,
      onChange: setKey('thanks'),
    }),
    check({
      label: 'Ask Claude to reply to Grovel',
      hint: ` Replies appear in the Replies tab.`,
      on: v.messages.inviteReply,
      onChange: setKey('inviteReply'),
    }),
  );
}

// The replies the agent gave, newest first, each as a small card with the picture-card button first.
function renderReplies(v) {
  byId('invite-replies').replaceChildren(
    check({
      label: 'Ask Claude to reply to Grovel',
      hint: INVITE_HINT,
      on: v.messages.inviteReply,
      onChange: setKey('inviteReply'),
    }),
  );
  const box = byId('replies');
  const list = v.status.replies || [];
  const key = `${v.messages.inviteReply}:${list.map((e) => e.at).join(',')}`;
  byId('clear-replies').hidden = !list.length;
  if (box.dataset.key === key) return; // unchanged: leave the buttons alone
  box.dataset.key = key;
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'card';
    const title = document.createElement('div');
    title.textContent = 'No replies yet.';
    const how = document.createElement('p');
    how.className = 'hint';
    how.textContent = v.messages.inviteReply
      ? 'Plead, then wait until Claude finishes. It usually answers.'
      : 'Turn on "Ask Claude to reply" above, then plead. Claude usually answers.';
    empty.append(title, how);
    box.replaceChildren(empty);
    return;
  }
  box.replaceChildren(
    ...list.map((e) => {
      const card = document.createElement('div');
      card.className = 'card reply';
      const who = (text, agent) => {
        const d = document.createElement('div');
        d.className = agent ? 'who agent' : 'who';
        d.textContent = text;
        return d;
      };
      const line = (text) => {
        const d = document.createElement('div');
        d.className = 'line';
        d.textContent = `“${text}”`;
        return d;
      };
      const actions = document.createElement('div');
      actions.className = 'actions';
      /** @type {[string, string, boolean][]} */
      const buttons = [
        ['replyCard', 'Save as card', true],
        ['copyReply', 'Copy', false],
      ];
      for (const [action, label, primary] of buttons) {
        const b = document.createElement('button');
        b.className = primary ? 'action primary' : 'action';
        b.dataset.action = action;
        b.dataset.arg = String(e.at);
        b.dataset.label = label;
        b.textContent = L(label);
        actions.append(b);
      }
      const agent = e.agent === 'cursor' ? 'Cursor' : 'Claude Code';
      card.append(who('Grovel'), line(e.plea), who(`${agent} · ${when(e.at)}`, true), line(e.reply), actions);
      return card;
    }),
  );
}

function renderConnection(v) {
  const s = v.status;
  const state = !s.installed ? 'bad' : s.hooksCurrent ? 'ok' : 'warn';
  const line = !s.installed
    ? 'Not connected'
    : s.hooksCurrent
      ? `Connected to Claude Code${v.cursor ? ' and Cursor' : ''}`
      : 'Connected, but the entries are out of date';
  const open = s.sessions.length;
  const detail = !s.installed
    ? 'Press Connect. Grovel then hears every Claude Code session.'
    : s.hooksCurrent
      ? `Grovel hears every session. ${open ? `${open} session${open === 1 ? '' : 's'} open now.` : 'No session open now.'}`
      : 'Press Connect again to refresh the hook entries.';
  for (const [dotId, lineId] of [
    ['hooks-dot', 'hooks-line'],
    ['welcome-dot', 'welcome-hooks'],
  ]) {
    byId(dotId).className = `dot ${state}`;
    byId(lineId).textContent = line;
  }
  byId('hooks-detail').textContent = detail;
  byId('install').hidden = s.installed;
  byId('welcome-install').hidden = s.installed;
  byId('welcome-hint').hidden = s.installed;
  byId('uninstall').hidden = !s.installed;
  byId('cursor').replaceChildren(
    check({
      label: 'Also watch Cursor',
      hint: 'Turn on to use Grovel inside Cursor too. Adds Cursor hook entries next to the Claude Code ones.',
      on: v.cursor,
      onChange: setKey('cursor'),
    }),
  );
  const checkRow = byId('check-row');
  checkRow.hidden = !s.check;
  if (s.check) {
    byId('check-dot').className = `dot ${s.check.ok ? 'ok' : 'bad'}`;
    byId('check-line').textContent = s.check.text;
  }
  byId('port-line').textContent = `Grovel listens on 127.0.0.1, port ${s.port}.`;
  byId('over-line').textContent = s.hosts.length
    ? `Grovel knows the agent runs in ${s.hostNames.join(', ')}${s.visible ? ' (on screen now)' : s.agentInFront ? '' : ' (hidden now: that app is not in front)'}.`
    : s.showMode === 'agentFront'
      ? 'No session has said where its agent runs yet, so Grovel shows everywhere until the next prompt.'
      : '';
  byId('sessions').replaceChildren(
    ...s.sessions.map((x) => {
      const d = document.createElement('div');
      d.className = 'status';
      const dotEl = document.createElement('span');
      dotEl.className = `dot ${x.host ? 'ok' : 'warn'}`;
      const code = document.createElement('code');
      code.textContent = String(x.id).slice(0, 8);
      const text = document.createElement('span');
      text.append(`${x.name} · session `, code, x.host ? '' : ' · app not known yet (learns it at the next prompt)');
      d.append(dotEl, text);
      return d;
    }),
  );
}

function renderAbout(v) {
  const os = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[v.platform] || v.platform;
  byId('about-version').textContent = `Version ${v.version} on ${os}`;
  byId('about-record').textContent = v.record;
}

// A short confirmation on the button itself, then its label comes back.
function flash(button, text) {
  button.textContent = text;
  setTimeout(() => {
    delete button.dataset.flashed;
    button.textContent = L(button.dataset.label);
  }, 1500);
  button.dataset.flashed = '1';
}
// Buttons are written in sentence style and take the platform's case (title style on macOS).
function caseButtons() {
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('button.action'))) {
    if (!b.dataset.label) b.dataset.label = b.textContent.trim();
    const next = L(b.dataset.label);
    if (b.dataset.flashed) continue; // a confirmation is showing
    if (b.textContent !== next) b.textContent = next; // unchanged text is left alone: no lost selection, no re-announcement
  }
}

/** @type {any} */
let current = null; // the last payload shown
function render(v) {
  current = v;
  tabs.find((b) => b.dataset.tab === 'welcome').hidden = !(v.firstRun || welcomeShown);
  caseButtons();
  renderGrovel(v);
  renderMessages(v);
  renderReplies(v);
  renderConnection(v);
  renderAbout(v);
  byId('footer').textContent = v.firstRun
    ? 'First run: Welcome shows the three things Grovel does.'
    : 'Right-click Grovel for the menu. Settings reopen from the tray.';
}

function openTab(name) {
  showTab(name);
  if (name === 'messages') loadPhrases(); // fresh each visit: the file may have been edited elsewhere
}
for (const b of tabs) b.addEventListener('click', () => openTab(b.dataset.tab));
// Keyboard, per the WAI-ARIA tabs pattern: Left/Right move between tabs and wrap, Home/End jump, and a tab opens as
// soon as it has focus (the panes are already loaded, so there is no latency to wait out).
document.querySelector('nav').addEventListener('keydown', (e) => {
  const visible = tabs.filter((b) => !b.hidden);
  const at = visible.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
  if (at < 0) return;
  const moves = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: visible.length - 1 };
  if (!(e.key in moves)) return;
  e.preventDefault();
  const next = visible[(moves[e.key] + visible.length) % visible.length];
  next.focus();
  openTab(next.dataset.tab);
});
document.body.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const open = /** @type {HTMLElement | null} */ (target.closest('[data-open-tab]'));
  if (open) return openTab(open.dataset.openTab);
  const el = /** @type {HTMLElement | null} */ (target.closest('[data-action]'));
  if (!el) return;
  const name = el.dataset.action;
  if (
    name === 'importPhrases' &&
    phrasesDirty() &&
    !window.confirm('Unsaved edits on this tab will be replaced. Continue?')
  )
    return;
  if (name === 'clearReplies' && !window.confirm('Forget every reply kept so far?')) return;
  const firstRun = Boolean(current && current.firstRun);
  window.openplead.action(name, el.dataset.arg).then((v) => {
    render(v);
    if (name === 'copyRecord' || name === 'copyReply') flash(el, 'Copied');
    if (name === 'replyCard') flash(el, 'Saved to the Desktop');
    if (name === 'importPhrases') loadPhrases();
    if (name !== 'done') return;
    if (firstRun)
      window.close(); // the first-run tour is over
    else {
      welcomeShown = false; // reopened from About: back there, the tab hidden again
      tabs.find((b) => b.dataset.tab === 'welcome').hidden = true;
      showTab('about');
    }
  });
});
window.openplead.onTab(openTab);

const initial = new URLSearchParams(location.search).get('tab');
window.openplead.read().then((v) => {
  render(v);
  const remembered = sections.some((s) => s.dataset.tab === lastTab() && s.dataset.tab !== 'welcome')
    ? lastTab()
    : null;
  openTab(initial && (initial !== 'welcome' || v.firstRun) ? initial : v.firstRun ? 'welcome' : remembered || 'grovel');
});
setInterval(() => window.openplead.read().then(render), 2000);
