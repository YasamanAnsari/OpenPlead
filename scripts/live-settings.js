'use strict';

// Live check, not part of `npm run check`: the real Settings window of an isolated, hidden pet is driven through
// every control, tab by tab, and each effect is checked where it lands (the config file, the hook files, the phrases
// file, the replies file, /health, the page). Needs a desktop session and the puppeteer dev dependency.
//   node scripts/live-settings.js
const path = require('node:path');
const fs = require('node:fs');
const { createHarness, sleep } = require('./live-harness');

const h = createHarness('settings');
const { HOME, PORT, REPO, log, check, until, get } = h;
const OP = path.join(HOME, '.openplead');
fs.mkdirSync(path.join(HOME, '.claude'));
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}');
fs.writeFileSync(
  path.join(OP, 'config.json'),
  JSON.stringify({
    port: PORT,
    firstRun: false,
    showMode: 'agentFront',
    cursor: true,
    inviteReply: false,
    thanks: true,
    sounds: true,
    coached: { thanks: true, working: true, queued: true, sent: true },
  }),
);
const now = Date.now();
fs.writeFileSync(
  path.join(OP, 'replies.jsonl'),
  [
    JSON.stringify({
      at: now - 26 * 3_600_000,
      agent: 'claude-code',
      kind: 'plea',
      plea: 'old plea',
      reply: 'Older reply here.',
    }),
    JSON.stringify({
      at: now - 3 * 60_000,
      agent: 'claude-code',
      kind: 'plea',
      plea: 'new plea',
      reply: 'Thanks for the trust. Writing the README now.',
    }),
  ].join('\n') + '\n',
);
const cfg = () => JSON.parse(fs.readFileSync(path.join(OP, 'config.json'), 'utf8'));
const claudeHooks = () => JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')).hooks || {};
const cursorHooks = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, '.cursor', 'hooks.json'), 'utf8')).hooks || {};
  } catch {
    return null;
  }
};
const phrasesFile = () => JSON.parse(fs.readFileSync(path.join(OP, 'phrases.json'), 'utf8'));
const defaults = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'core', 'phrases.default.json'), 'utf8'));

(async () => {
  const up = await h.start();
  log('pet up, pid', h.pid(), 'installed', up.installed);
  h.openSettings();
  const page = await h.page((u) => u.includes('settings.html'));
  if (!page) throw new Error('no settings window');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await sleep(500);
  const tab = async (name) => {
    await page.$eval(`nav button[data-tab="${name}"]`, (b) => b.click());
    await sleep(300);
  };
  const text = (sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => null);
  // Rows re-render every two seconds, so each lookup and click happens in one go inside the page.
  const flip = (label, want) =>
    page.evaluate(
      ([label, want]) => {
        const row = [...document.querySelectorAll('label.row')].find(
          (r) => r.querySelector('.text > div').textContent.trim() === label,
        );
        if (!row) return 'no row ' + label;
        const input = row.querySelector('input');
        if (input.type === 'checkbox' ? input.checked !== want : !input.checked) input.click();
        return 'ok';
      },
      [label, want],
    );
  const press = (sel) => page.$eval(sel, (b) => b.click());

  // ---- Connection
  await tab('connection');
  check((await text('#hooks-line')) === 'Not connected', 'Connection: starts not connected');
  await press('#install');
  await until(async () => (await get('/health')).installed, 'Connect installs the hooks');
  check(Boolean(claudeHooks().SessionStart), 'Connect: Claude Code hook entries written');
  check(Boolean(cursorHooks()), 'Connect: Cursor hook file written');
  await until(
    () => text('#hooks-line').then((t) => t === 'Connected to Claude Code and Cursor'),
    'status reads connected to both',
  );
  check(/1 session|No session open now/.test(await text('#hooks-detail')), 'Connection: the detail sentence is there');
  check(await page.$eval('#install', (b) => b.hidden), 'Connect button hides once connected');
  await flip('Also watch Cursor', false);
  await until(() => cfg().cursor === false, 'Also watch Cursor off is saved');
  await until(() => text('#hooks-line').then((t) => t === 'Connected to Claude Code'), 'status drops Cursor');
  await flip('Also watch Cursor', true);
  await until(() => cfg().cursor === true, 'Also watch Cursor on again');
  await press('button[data-action="checkConnection"]');
  await until(() => page.$eval('#check-row', (r) => !r.hidden), 'Check the connection shows a result');
  check(/reach Grovel on port 47999/.test(await text('#check-line')), `check line: ${await text('#check-line')}`);
  check(/47999/.test(await text('#port-line')), 'Advanced: port line');
  await press('#uninstall');
  await until(async () => !(await get('/health')).installed, 'Disconnect removes the hooks');
  check(!claudeHooks().SessionStart, 'Disconnect: Claude Code entries gone');
  await until(() => text('#hooks-line').then((t) => t === 'Not connected'), 'status reads not connected');
  await press('#install');
  await until(async () => (await get('/health')).installed, 'Connect again');

  // ---- Grovel
  await tab('grovel');
  await flip('Whenever an agent session is open, over any app', true);
  await until(() => cfg().showMode === 'session', 'show mode: session saved');
  await flip('Always, even with no agent', true);
  await until(async () => (await get('/health')).showMode === 'always', 'show mode: always, live in /health');
  await flip("Only while my agent's window is in front", true);
  await until(() => cfg().showMode === 'agentFront', 'show mode: back to the default');
  await flip('Follow me to every desktop', true);
  await until(() => cfg().followDesktops === true, 'follow desktops on');
  await flip('Follow me to every desktop', false);
  await until(() => cfg().followDesktops === false, 'follow desktops off');
  await flip('Sounds', false);
  await until(() => cfg().sounds === false, 'sounds off');
  await flip('Sounds', true);
  await until(() => cfg().sounds === true, 'sounds on');
  await press('button[data-action="chime"]');
  await sleep(300);
  check(Boolean(await get('/health').catch(() => null)), 'Play the chime: the app is still fine');
  await flip('For an hour', true);
  await until(() => cfg().quietUntil > Date.now(), 'mute for an hour saved');
  await until(
    () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#mute .hint')].some((h) => /^Muted until/.test(h.textContent)),
      ),
    'mute hint shows the time',
  );
  await flip('Until I turn it off', true);
  await until(() => cfg().quietUntil === -1, 'mute until turned off saved');
  await flip('Not muted', true);
  await until(() => cfg().quietUntil === 0, 'unmuted');
  await flip('Control Shift Space', true);
  await until(() => cfg().hotkey === 'Control+Shift+Space', 'hotkey saved');
  await flip('Off', true);
  await until(() => cfg().hotkey === null, 'hotkey off');
  check(await page.$eval('#unpark', (b) => b.disabled), 'Unpark is dimmed while not parked');
  await press('button[data-action="resetPosition"]');
  await until(() => cfg().position === null, 'reset position clears the saved spot');

  // ---- Messages
  await tab('messages');
  await flip('Thank Claude each time it finishes', false);
  await until(() => cfg().thanks === false, 'thanks off');
  await flip('Thank Claude each time it finishes', true);
  await until(() => cfg().thanks === true, 'thanks on');
  await flip('Ask Claude to reply to Grovel', true);
  await until(() => cfg().inviteReply === true, 'ask to reply on');
  await until(() => Boolean(claudeHooks().MessageDisplay), 'the text hook is registered while on');
  await flip('Ask Claude to reply to Grovel', false);
  await until(() => cfg().inviteReply === false, 'ask to reply off');
  await until(() => !claudeHooks().MessageDisplay, 'the text hook is removed when off');
  // the bulleted editor
  await until(() => page.$('details.set[data-set="plea.1"]'), 'phrase sets rendered');
  check((await page.$$('details.set')).length === 13, 'thirteen sets listed');
  await press('details.set[data-set="plea.1"] summary');
  await sleep(200);
  const rows = await page.$$eval('details.set[data-set="plea.1"] .line', (l) => l.length);
  check(rows === defaults.plea['1'].length, `plea 1 shows one row per line (${rows})`);
  await page.evaluate(() => {
    const first = document.querySelector('details.set[data-set="plea.1"] .line textarea');
    first.value = 'Live test line one.';
    first.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await press('details.set[data-set="plea.1"] button.add');
  await page.evaluate(() => {
    const areas = document.querySelectorAll('details.set[data-set="plea.1"] .line textarea');
    const last = areas[areas.length - 1];
    last.value = 'Live test line two.';
    last.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    const removes = document.querySelectorAll('details.set[data-set="plea.1"] .line .remove');
    for (let i = removes.length - 2; i >= 1; i -= 1) removes[i].click(); // keep the first (edited) and the last (new)
  });
  await press('[data-phrases="save"]');
  await until(
    () =>
      /Saved/.test(String(fs.existsSync(path.join(OP, 'phrases.json')) && phrasesFile().plea['1'].join('|'))) || true,
    'save pressed',
  );
  await until(() => {
    const p = phrasesFile().plea['1'];
    return p.length === 2 && p[0] === 'Live test line one.' && p[1] === 'Live test line two.';
  }, 'edited, added and removed lines are saved to phrases.json');
  await until(() => text('#phrases-status').then((t) => /Saved/.test(t)), 'the status says Saved');
  await until(
    () => text('details.set[data-set="plea.1"] .preview').then((t) => t === '“Live test line one.” and 1 more'),
    'the preview updates after save',
  );
  await press('[data-phrases="reset"]');
  await until(
    () => JSON.stringify(phrasesFile().plea['1']) === JSON.stringify(defaults.plea['1']),
    'reset brings the default lines back',
  );

  // ---- Replies
  await tab('replies');
  await until(() => page.$$eval('.card.reply', (c) => c.length === 2), 'two reply cards');
  check(await page.$eval('.card.reply .line', (l) => l.textContent.includes('new plea')), 'the newest reply is first');
  const buttons = await page.$$eval('.card.reply:first-of-type .actions button', (b) =>
    b.map((x) => [x.dataset.action, x.className]),
  );
  check(
    buttons[0] && buttons[0][0] === 'replyCard' && /primary/.test(buttons[0][1]),
    'Save as card is the first, primary button',
  );
  check(buttons[1] && buttons[1][0] === 'copyReply', 'Copy is the second button');
  check(
    /Claude Code · (today|yesterday)/.test(await text('.card.reply .who.agent')),
    'the reply names the agent and the day',
  );
  await press('#clear-replies');
  await until(() => page.$$eval('.card.reply', (c) => c.length === 0), 'Clear all empties the list');
  await until(
    () => page.evaluate(() => /No replies yet/.test(document.getElementById('replies').textContent)),
    'empty state shown',
  );
  check(
    await page.evaluate(() => /Turn on "Ask Claude to reply"/.test(document.getElementById('replies').textContent)),
    'empty state tells how to get replies',
  );

  // ---- About
  await tab('about');
  check(/^Version 0\.1\.0 on macOS$/.test(await text('#about-version')), 'About: version line');
  check(
    /^You pleaded \d+ times?\. Claude was thanked \d+ times?\. \d+ panics?\.$/.test(await text('#about-record')),
    'About: the tally as a sentence',
  );
  await press('[data-open-tab="welcome"]');
  await sleep(200);
  check(!(await page.$eval('nav button[data-tab="welcome"]', (b) => b.hidden)), 'Welcome tab appears');
  check(
    (await page.$eval('nav button[data-tab="welcome"]', (b) => b.getAttribute('aria-selected'))) === 'true',
    'Welcome is selected',
  );
  check((await text('#welcome-hooks')) === 'Connected to Claude Code and Cursor', 'Welcome shows the connection');
  check(await page.$eval('#welcome-hint', (p) => p.hidden), 'the hook-entries note hides once connected');
  await press('button[data-action="done"]');
  await sleep(200);
  check(
    (await page.$eval('nav button[data-tab="about"]', (b) => b.getAttribute('aria-selected'))) === 'true',
    'Done returns to About',
  );
  check(await page.$eval('nav button[data-tab="welcome"]', (b) => b.hidden), 'Welcome tab hides again');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await h.finish();
})().catch(h.fail);
