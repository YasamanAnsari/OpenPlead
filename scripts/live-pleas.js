'use strict';

// Live check, not part of `npm run check`: an isolated, hidden pet is driven through its hook route and its click
// route like a real Claude Code session, and what it shows and sends is checked. Needs a desktop session (Electron
// opens no window, but it needs a display) and the puppeteer dev dependency.
//   node scripts/live-pleas.js [wait-seconds]   default 130: past the two-minute plea expiry
const path = require('node:path');
const fs = require('node:fs');
const { createHarness, sleep } = require('./live-harness');

const h = createHarness('pleas');
const { HOME, PORT, log, check, until, get, post } = h;
const WAIT = Number(process.argv[2] || 130);
fs.writeFileSync(
  path.join(HOME, '.openplead', 'config.json'),
  JSON.stringify({
    port: PORT,
    thanks: true,
    firstRun: false,
    cursor: true,
    inviteReply: false,
    coached: { thanks: true, working: true, queued: true, sent: true },
  }),
);
const SID = 'between-turns-1';
const hook = (hook_event_name, extra = {}) =>
  post('/hook', { hook_event_name, session_id: SID, cwd: HOME, transcript_path: path.join(HOME, 't.jsonl'), ...extra });
const click = () => post('/click', {});

(async () => {
  const up = await h.start();
  log('pet up, pid', h.pid(), 'port', up.port, 'visible', up.visible);
  const pet = await h.page((u) => u.endsWith('index.html'));
  if (!pet) throw new Error('no pet page');
  // The renderer must have its bridge and its DOM before the first click lands.
  await until(
    () => pet.evaluate(() => Boolean(window.openplead) && document.readyState === 'complete'),
    'pet page ready',
  );
  await sleep(300);
  const text = () =>
    pet.evaluate(() => {
      const t = (id) => (document.getElementById(id) || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim();
      return { tag: t('tag'), bubble: t('bubble') };
    });

  // A: no session at all
  await click();
  await sleep(700);
  let t = await text();
  log('A no session, after click:', JSON.stringify(t));
  check(/Pleading to an empty room/.test(t.bubble), 'A: the pet says there is no session, in plain words');

  // B: a session that is waiting for you
  for (const [ev, extra] of [
    ['SessionStart', {}],
    ['UserPromptSubmit', { prompt: 'make a file' }],
    ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }],
    ['PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '' } }],
    ['Stop', { stop_hook_active: false, last_assistant_message: 'Done.' }],
  ]) {
    const r = await hook(ev, extra);
    if (r.status !== 200) log('  hook', ev, '->', r.status, r.body);
    await sleep(120);
  }
  await sleep(600);
  t = await text();
  log('B waiting for you, before clicks:', JSON.stringify(t));
  await click();
  await sleep(150);
  await click();
  await sleep(900);
  t = await text();
  log('B after two clicks:', JSON.stringify(t));
  check(/Plea 2 of 5/.test(t.tag) && /next message/.test(t.tag), 'B: the chip reads "Plea 2 of 5 · next message"');
  check(!/Nothing to beg for/.test(t.bubble), 'B: no "nothing to beg for" shrug');
  const bubbleAfterClick = t.bubble;

  // Wait past the old two-minute expiry
  log(`waiting ${WAIT}s (plea TTL is 120s)…`);
  await sleep(WAIT * 1000);
  t = await text();
  log('B after the wait:', JSON.stringify(t));
  check(/Plea 2 of 5/.test(t.tag), 'B: the saved plea is still there after the wait');
  const before = (await get('/health')).stats.pleas;
  const r = await hook('UserPromptSubmit', { prompt: 'and now the next thing' });
  let out = {};
  try {
    out = JSON.parse(r.body);
  } catch {
    // ignored: best effort
  }
  const ctx = out.hookSpecificOutput && out.hookSpecificOutput.additionalContext;
  log('B next prompt hook response:', r.status, JSON.stringify(out).slice(0, 300));
  check(typeof ctx === 'string' && ctx.length > 20, 'B: the plea rides on the next prompt');
  await sleep(500);
  const after = (await get('/health')).stats.pleas;
  check(after === before + 1, `B: pleas counted ${before} -> ${after}`);
  t = await text();
  log('B after the prompt:', JSON.stringify(t));
  check(
    /Sent to Claude Code ✓/.test(t.tag) && !/next message/.test(t.tag),
    'B: the chip reports it sent, nothing waits for the next message',
  );

  // C: a click while working still goes with the next tool result
  await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pwd' } });
  await click();
  await sleep(400);
  t = await text();
  log('C working, after click:', JSON.stringify(t));
  check(
    /Plea 3 of 5/.test(t.tag) && /next tool call/.test(t.tag),
    'C: the ladder continues at 3 and the chip says next tool call',
  );
  const r2 = await hook('PostToolUse', {
    tool_name: 'Bash',
    tool_input: { command: 'pwd' },
    tool_response: { stdout: HOME },
  });
  let out2 = {};
  try {
    out2 = JSON.parse(r2.body);
  } catch {
    // ignored: best effort
  }
  check(
    Boolean(out2.hookSpecificOutput && out2.hookSpecificOutput.additionalContext),
    'C: the plea rides on the tool result',
  );
  await hook('Stop', { stop_hook_active: false, last_assistant_message: 'Done again.' });
  await hook('SessionEnd', { reason: 'other' });
  await sleep(400);
  log('bubble right after the between-turns clicks was:', JSON.stringify(bubbleAfterClick));
  log('replies file exists:', fs.existsSync(path.join(HOME, '.openplead', 'replies.jsonl')));
  await h.finish();
})().catch(h.fail);
