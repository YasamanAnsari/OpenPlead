'use strict';

// Live check, not part of `npm run check`: the first run. No config exists; the app comes up, opens Welcome, is
// connected from there, takes its first session and coaches once, and Done ends the first run. By default the home
// carries only a port, so the user's own pet on 47821 is never touched; `--bare` writes nothing at all and uses the
// default port, which is the literal first run and needs that port free.
//   node scripts/live-first-run.js [--bare]
const path = require('node:path');
const fs = require('node:fs');
const { createHarness, sleep } = require('./live-harness');

const BARE = process.argv.includes('--bare');
const h = createHarness('first-run', { port: BARE ? 47821 : 47999 });
const { HOME, PORT, log, check, until, get, post } = h;
const OP = path.join(HOME, '.openplead');
if (!BARE) {
  fs.writeFileSync(path.join(OP, 'config.json'), JSON.stringify({ port: PORT }));
  fs.writeFileSync(path.join(OP, 'show-welcome'), ''); // what `openplead install` leaves for the app
}
const cfg = () => JSON.parse(fs.readFileSync(path.join(OP, 'config.json'), 'utf8'));
const claudeHooks = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')).hooks || {};
  } catch {
    return null;
  }
};
const SID = 'first-run-1';
const hook = (hook_event_name, extra = {}) =>
  post('/hook', { hook_event_name, session_id: SID, cwd: HOME, transcript_path: path.join(HOME, 't.jsonl'), ...extra });

(async () => {
  const up = await h.start();
  log(
    'pet up, pid',
    h.pid(),
    'port',
    up.port,
    'installed',
    up.installed,
    BARE ? '(bare first run)' : '(welcome marker)',
  );
  check(up.installed === false, 'a fresh home is not connected');
  check(up.port === PORT, 'the pet took the expected port');
  // Welcome opened on its own: no second instance, no click.
  const settings = await h.page((u) => u.includes('settings.html'));
  check(Boolean(settings), 'the Welcome window opened by itself on the first run');
  if (!settings) return h.finish();
  await until(
    () => settings.evaluate(() => Boolean(window.openplead) && document.readyState === 'complete'),
    'settings page ready',
  );
  await sleep(600);
  const tab = () => settings.$eval('nav button[aria-selected="true"]', (b) => b.dataset.tab).catch(() => null);
  check((await tab()) === 'welcome', 'it opened on the Welcome tab');
  check(
    (await settings.$eval('#welcome-hooks', (e) => e.textContent.trim())) === 'Not connected',
    'Welcome says: not connected',
  );
  check(await settings.$eval('#welcome-install', (b) => !b.hidden), 'the Connect button is the first thing offered');
  const pet = await h.page((u) => u.endsWith('index.html'));
  await sleep(500);
  const petText = () =>
    pet.evaluate(() => {
      const t = (id) => (document.getElementById(id) || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim();
      return { tag: t('tag'), bubble: t('bubble') };
    });
  check(/Right-click me and choose Connect/.test((await petText()).bubble), 'the pet asks to be connected');
  // Connect from Welcome.
  await settings.$eval('#welcome-install', (b) => b.click());
  await until(async () => (await get('/health')).installed, 'Connect from Welcome installs the hooks');
  check(
    Boolean(claudeHooks() && claudeHooks().SessionStart),
    'the Claude Code settings file was created with the entries',
  );
  check(cfg().manageHooks === true, 'the app now owns the entries');
  await until(
    () => settings.$eval('#welcome-hooks', (e) => /^Connected/.test(e.textContent.trim())),
    'Welcome shows connected',
  );
  // The first session: the pet appears for it and explains itself once.
  await hook('SessionStart');
  await hook('UserPromptSubmit', { prompt: 'hello' });
  await sleep(400);
  await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
  await until(
    () => petText().then((t) => /Claude Code · working/.test(t.tag)),
    'the nameplate shows the first session',
  );
  const seen = await petText();
  log('first session, pet shows:', JSON.stringify(seen));
  await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '' } });
  await hook('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
  await until(() => petText().then((t) => /waiting for you/.test(t.tag)), 'the first turn ends on the nameplate');
  // Done ends the first run.
  await settings.$eval('button[data-action="done"]', (b) => b.click());
  await until(() => cfg().firstRun === false, 'Done ends the first run in the config');
  await hook('SessionEnd', { reason: 'other' });
  await h.finish();
})().catch(h.fail);
