'use strict';

// The right-click and tray menu: four plain groups, who gets what, a second line on macOS, per platform.
const test = require('node:test');
const assert = require('node:assert/strict');
const { menuTemplate, ago } = require('../../src/desktop/menu');
const { initialState, reduce } = require('../../src/core/state');

test('the menu: four plain groups, every item says who gets what, a second line explains it on macOS', () => {
  const T0 = 1_000_000;
  let state = initialState(T0);
  const hook = (kind, extra = {}) => ({
    type: 'hook',
    event: { agent: 'claude-code', sessionId: 's1', kind, ...extra },
  });
  for (const input of [hook('session_start'), hook('turn_start'), { type: 'click' }])
    state = reduce(state, input, T0).state;
  const calls = [];
  const names = ['dispatch', 'quit', 'setSetting', 'togglePin', 'quietFor', 'focusAgent', 'openSettings', 'replyCard'];
  const actions = Object.fromEntries(names.map((k) => [k, (...a) => calls.push([k, ...a])]));
  const replies = [
    { at: T0 - 120_000, agent: 'claude-code', plea: 'p1', reply: 'Thanks for the trust.' },
    { at: T0 - 90_000_000, agent: 'claude-code', plea: 'p2', reply: "I don't have a hug endpoint." },
  ];
  const ctx = {
    state,
    settings: { hotkey: 'Control+Shift+P', showMode: 'agentFront', position: [1, 2] },
    pinned: false,
    canFocus: true,
    agentApp: 'com.todesktop.230313mzl4w4u92',
    replies,
    platform: 'darwin',
    now: T0,
    actions,
  };
  const find = (items, label) => {
    for (const i of items) {
      if (i.label === label || (typeof label !== 'string' && label.test(i.label || ''))) return i;
      const hit = i.submenu && find(i.submenu, label);
      if (hit) return hit;
    }
    return null;
  };
  const shown = (items) => items.filter((i) => i.label && i.enabled !== false && i.visible !== false);
  const menu = menuTemplate(ctx);
  assert.deepEqual(
    shown(menu).map((i) => i.label),
    [
      'Plead with Claude',
      'Thank Claude',
      'Reassure Claude',
      'Set a Deadline',
      'Cancel the Next Message',
      "Claude's Replies",
      'Mute for an Hour',
      'Show Grovel on Every App',
      'Go to Cursor',
      'Settings…',
      'Quit OpenPlead',
    ],
    'title style on macOS; what to send, what came back, how he behaves, then the window and quit',
  );
  assert.equal(menu[0].label, 'Claude is working');
  assert.equal(menu[0].sublabel, 'Next up: plea 1 of 5');
  assert.equal(menu[0].enabled, false);
  const plead = find(menu, 'Plead with Claude');
  assert.equal(plead.sublabel, 'Clicking Grovel does the same. Each time is stronger; next is 2 of 5.');
  assert.equal(plead.accelerator, 'Control+Shift+P');
  assert.equal(plead.registerAccelerator, false, 'the hotkey is shown, not registered twice');
  assert.equal(menu.filter((i) => i.type === 'separator').length, 4, 'four groups');
  for (const item of menu) {
    if (!item.submenu) continue;
    assert.ok(!item.label.endsWith('…'), `a submenu label carries no ellipsis: ${item.label}`);
    assert.ok(item.submenu.length <= 6, `a short submenu: ${item.label}`);
    assert.ok(
      item.submenu.every((sub) => !sub.submenu),
      `one level deep: ${item.label}`,
    );
  }
  // What to send.
  find(menu, 'Thank Claude').click();
  assert.deepEqual(calls.at(-1), ['dispatch', { type: 'menu', action: 'thank' }]);
  find(menu, "It's Okay, Carry On").click();
  assert.deepEqual(calls.at(-1), ['dispatch', { type: 'menu', action: 'say', kind: 'hug' }]);
  assert.match(find(menu, 'Take Your Time, Do It Properly').sublabel, /removes the deadline/);
  find(menu, 'In 15 Minutes').click();
  assert.deepEqual(calls.at(-1), ['dispatch', { type: 'menu', action: 'deadline', minutes: 15 }]);
  assert.equal(find(menu, 'No Deadline').checked, true);
  const onClock = menuTemplate({ ...ctx, state: { ...state, deadlineUntil: T0 + 12 * 60_000, deadlineMinutes: 15 } });
  assert.equal(find(onClock, 'In 15 Minutes (12 Left)').checked, true);
  find(menu, 'Cancel the Next Message').click();
  assert.deepEqual(calls.at(-1), ['dispatch', { type: 'menu', action: 'reset' }]);
  // What came back.
  const rep = find(menu, "Claude's Replies").submenu;
  assert.equal(rep[0].label, '“Thanks for the trust.”');
  assert.equal(rep[0].sublabel, '2 min ago · click to save a card');
  rep[0].click();
  assert.deepEqual(calls.at(-1), ['replyCard', T0 - 120_000]);
  assert.equal(rep[1].sublabel, 'yesterday · click to save a card');
  const ask = find(menu, 'Ask Claude to Reply to Grovel');
  assert.equal(ask.checked, false);
  ask.click({ checked: true });
  assert.deepEqual(calls.at(-1), ['setSetting', 'inviteReply', true]);
  find(menu, 'See All Replies…').click();
  assert.deepEqual(calls.at(-1), ['openSettings', 'replies']);
  const noReplies = find(menuTemplate({ ...ctx, replies: [] }), "Claude's Replies").submenu;
  assert.equal(noReplies[0].label, 'No Replies Yet');
  assert.equal(noReplies[0].enabled, false);
  assert.match(noReplies[0].sublabel, /Turn on the switch below/);
  // How he behaves.
  find(menu, 'Mute for an Hour').click({ checked: true });
  assert.deepEqual(calls.at(-1), ['quietFor', 60]);
  find(menu, 'Mute for an Hour').click({ checked: false });
  assert.deepEqual(calls.at(-1), ['quietFor', 0]);
  const hush = menuTemplate({ ...ctx, settings: { ...ctx.settings, quietUntil: -1 } });
  assert.equal(find(hush, 'Mute for an Hour').checked, true);
  assert.equal(find(hush, 'Mute for an Hour').sublabel, 'Muted until turned off');
  const pin = find(menu, 'Show Grovel on Every App');
  assert.equal(pin.checked, false);
  assert.equal(pin.sublabel, "Otherwise only over Cursor's window.");
  pin.click();
  assert.deepEqual(calls.at(-1), ['togglePin']);
  assert.equal(
    find(menuTemplate({ ...ctx, pinned: true }), 'Show Grovel on Every App').sublabel,
    'Until this session ends.',
  );
  const always = find(
    menuTemplate({ ...ctx, settings: { ...ctx.settings, showMode: 'always' } }),
    'Show Grovel on Every App',
  );
  assert.equal(always.checked, true);
  assert.equal(always.enabled, false, 'already always, from Settings');
  find(menu, 'Go to Cursor').click();
  assert.deepEqual(calls.at(-1), ['focusAgent']);
  const noApp = menuTemplate({ ...ctx, canFocus: false, agentApp: null });
  assert.equal(find(noApp, "Go to the Agent's App").enabled, false, 'dimmed, not hidden');
  find(menu, 'Settings…').click();
  assert.deepEqual(calls.at(-1), ['openSettings']);
  find(menu, 'Quit OpenPlead').click();
  assert.deepEqual(calls.at(-1), ['quit', 'menu']);
  // The situation changes the first lines.
  const after = reduce(state, hook('turn_end', { status: 'ok' }), T0).state;
  const waiting = menuTemplate({ ...ctx, state: { ...after, nextPrompt: { kind: 'thanks', at: T0, to: 's1' } } });
  assert.equal(waiting[0].label, 'Claude is waiting for you');
  assert.equal(waiting[0].sublabel, 'Next up: a thank-you');
  const idle = menuTemplate({ ...ctx, state: { ...after, nextPrompt: null } });
  assert.equal(idle[0].sublabel, 'Click Grovel to plead; the line goes with your next message');
  assert.equal(find(idle, 'Cancel the Next Message').enabled, false, 'dimmed, not hidden');
  const nobody = menuTemplate({ ...ctx, state: initialState(T0) });
  assert.equal(nobody[0].label, 'No agent open');
  assert.equal(nobody[0].sublabel, 'Start Claude Code or Cursor and Grovel wakes up');
  assert.equal(find(nobody, 'Plead with Your Agent').enabled, false);
  assert.equal(find(nobody, 'Thank Your Agent').enabled, false);
  const unplugged = menuTemplate({ ...ctx, state: initialState(T0), installed: false });
  assert.equal(unplugged[0].label, 'Not connected');
  find(unplugged, 'Connect to Claude Code…').click();
  assert.deepEqual(calls.at(-1), ['openSettings', 'connection']);
  assert.equal(find(menu, 'Connect to Claude Code…'), null, 'connected: no Connect item');
  const two = reduce(
    state,
    { type: 'hook', event: { agent: 'cursor', sessionId: 'c1', kind: 'session_start' } },
    T0,
  ).state;
  const twoMenu = menuTemplate({ ...ctx, state: two });
  assert.equal(twoMenu[0].label, 'Talking to Cursor');
  assert.equal(find(twoMenu, 'Talk To').submenu.length, 2);
  // Windows: sentence style, two status lines and no second lines, Settings plain, Exit last.
  const win = menuTemplate({ ...ctx, platform: 'win32' });
  assert.equal(win[0].label, 'Claude is working');
  assert.equal(win[1].label, 'Next up: plea 1 of 5');
  assert.equal(win[0].sublabel, undefined);
  const winCommands = shown(win).map((i) => i.label);
  assert.ok(winCommands.includes('Plead with Claude (same as clicking Grovel)'));
  assert.ok(winCommands.includes('Thank Claude with my next message'));
  assert.ok(winCommands.includes('Show Grovel on every app until the session ends'));
  assert.ok(winCommands.includes('Settings'));
  assert.equal(winCommands.at(-1), 'Exit');
});

test('"ago" reads like a person', () => {
  const T = 10_000_000_000;
  assert.equal(ago(T, T), 'just now');
  assert.equal(ago(T - 59_000, T), 'just now');
  assert.equal(ago(T - 180_000, T), '3 min ago');
  assert.equal(ago(T - 2 * 3_600_000, T), '2 h ago');
  assert.equal(ago(T - 26 * 3_600_000, T), 'yesterday');
  assert.equal(ago(T - 3 * 86_400_000, T), '3 days ago');
});
