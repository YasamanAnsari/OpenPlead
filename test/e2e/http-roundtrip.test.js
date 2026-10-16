'use strict';

// End to end over HTTP: the real server, adapters, reducer and phrases, driven with Claude Code and Cursor payload
// shapes, plus the stdio shim. The reducer's own rules are covered in state.test.js; this checks the wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const { tmpDir } = require('../helpers/fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const server = require('../../src/system/server');
const { initialState, reduce } = require('../../src/core/state');
const phrases = require('../../src/core/phrases');
const defaults = require('../../src/core/phrases.default.json');

const SHIM = path.join(__dirname, '..', '..', 'bin', 'openplead-hook.js');

function store() {
  let state = initialState(Date.now(), { thanks: true });
  const effects = [];
  const handle = (input) => {
    const r = reduce(state, input, Date.now());
    state = r.state;
    let reply = null;
    for (const e of r.effects) {
      effects.push(e);
      if (e.type === 'reply') reply = { ...e, ...phrases.render(defaults, e.kind, e.level) };
    }
    return reply;
  };
  return {
    handle,
    effects,
    get state() {
      return state;
    },
  };
}

function listen(t, handle) {
  return new Promise((resolve) => {
    const delivered = [];
    const errors = [];
    const s = server.start({
      port: 0,
      handle,
      onDelivered: (r) => delivered.push(r),
      enabled: () => true,
      onError: (e) => errors.push(e.message),
      onListening: (port) => resolve({ port, delivered, errors }),
    });
    t.after(() => s.close());
  });
}

function post(port, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: url,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(d);
          } catch {
            // not JSON: the caller checks the status
          }
          resolve({ status: res.statusCode, body: d, json });
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const cc = (hook_event_name, extra = {}) => ({
  session_id: 'cc-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/tmp',
  hook_event_name,
  ...extra,
});
const cur = (hook_event_name, extra = {}) => ({
  conversation_id: 'cur-1',
  generation_id: 'g1',
  cursor_version: '2.3.0',
  hook_event_name,
  ...extra,
});
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, tool_use_id: 'tu1' });
const HOOK = '/openplead/hook';

test(
  'Claude Code: a plea rides on the next tool result, thanks on the next prompt, nothing on a plain Stop',
  { timeout: 15_000 },
  async (t) => {
    const s = store();
    const { port, delivered } = await listen(t, s.handle);
    const hook = (p) => post(port, HOOK, p);
    await hook(cc('SessionStart', { source: 'startup' }));
    await hook(cc('UserPromptSubmit', { prompt: 'fix it' }));
    assert.equal((await hook(cc('PreToolUse', bash('ls')))).body, '{}');
    for (let i = 0; i < 3; i += 1) await post(port, '/click', '');
    const r = await hook(cc('PostToolUse', { ...bash('ls'), tool_response: {} }));
    assert.match(
      r.json.hookSpecificOutput.additionalContext,
      /^The user pressed OpenPlead's plead button \(level 3 of 5\)/,
    );
    assert.equal(r.json.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(r.json.systemMessage, /^OpenPlead sent: "/);
    assert.equal(delivered.length, 1);
    assert.equal((await hook(cc('Stop', { stop_hook_active: false }))).body, '{}');
    assert.equal(s.state.nextPrompt.kind, 'thanks');
    const thanks = await hook(cc('UserPromptSubmit', { prompt: 'next' }));
    assert.match(thanks.json.hookSpecificOutput.additionalContext, /^The user, through OpenPlead, says: "/);
  },
);

test(
  'Claude Code: a plea clicked after the last tool call blocks Stop once; the continuation never blocks again',
  { timeout: 15_000 },
  async (t) => {
    const s = store();
    const { port } = await listen(t, s.handle);
    const hook = (p) => post(port, HOOK, p);
    await hook(cc('UserPromptSubmit', { prompt: 'go' }));
    await hook(cc('PostToolUse', { ...bash('ls'), tool_response: {} }));
    await post(port, '/click', '');
    const stop = await hook(cc('Stop', { stop_hook_active: false }));
    assert.equal(stop.json.decision, 'block');
    assert.match(stop.json.reason, /level 1 of 5/);
    assert.equal((await hook(cc('Stop', { stop_hook_active: true }))).body, '{}');
  },
);

test(
  'Claude Code: two failures in a row send a calm line; subagent hooks never carry text',
  { timeout: 15_000 },
  async (t) => {
    const s = store();
    const { port } = await listen(t, s.handle);
    const hook = (p) => post(port, HOOK, p);
    await hook(cc('UserPromptSubmit', { prompt: 'go' }));
    assert.equal((await hook(cc('PostToolUseFailure', { ...bash('npm test'), error: 'exit 1' }))).body, '{}');
    const calm = await hook(cc('PostToolUseFailure', { ...bash('npm test'), error: 'exit 1' }));
    assert.equal(calm.json.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
    await post(port, '/click', '');
    const sub = await hook(cc('PreToolUse', { ...bash('ls'), agent_id: 'sub-1', agent_type: 'Explore' }));
    assert.equal(sub.body, '{}');
    assert.ok(s.state.pending, 'the plea waits for the main conversation');
  },
);

test(
  'Cursor: text only with tool results, followup_message at stop, nothing past the loop cap',
  { timeout: 15_000 },
  async (t) => {
    const s = store();
    const { port } = await listen(t, s.handle);
    const hook = (p) => post(port, HOOK, p);
    await hook(cur('sessionStart'));
    assert.equal((await hook(cur('beforeSubmitPrompt', { prompt: 'go' }))).body, '{}');
    assert.equal((await hook(cur('preToolUse', bash('ls')))).body, '{}');
    await post(port, '/click', '');
    const r = await hook(cur('postToolUse', { ...bash('ls'), tool_output: '' }));
    assert.match(r.json.additional_context, /level 1 of 5/);
    assert.equal((await hook(cur('stop', { status: 'completed', loop_count: 0 }))).body, '{}');
    await hook(cur('beforeSubmitPrompt', { prompt: 'go' }));
    await hook(cur('preToolUse', bash('ls')));
    await post(port, '/click', '');
    assert.equal(
      typeof (await hook(cur('stop', { status: 'completed', loop_count: 0 }))).json.followup_message,
      'string',
    );
    await hook(cur('beforeSubmitPrompt', { prompt: 'go' }));
    await hook(cur('preToolUse', bash('ls')));
    await post(port, '/click', '');
    assert.equal((await hook(cur('stop', { status: 'completed', loop_count: 4 }))).body, '{}');
    assert.equal(s.state.nextPrompt.kind, 'plea', 'kept for the next prompt instead');
  },
);

test('garbage on the local endpoint is refused with 400 and logged, never thrown', { timeout: 15_000 }, async (t) => {
  const { port, errors } = await listen(t, () => null);
  for (const body of ['null', '[]', '"x"', '{', '', '{"hook_event_name":5}']) {
    const r = await post(port, HOOK, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body, '{}');
  }
  assert.equal((await post(port, '/health', '')).status, 400);
  assert.ok(errors.length >= 6);
});

function shim(payload, port, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SHIM], { env: { ...process.env, OPENPLEAD_PORT: String(port), ...env } });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}

const closedPort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

test(
  'the stdio shim forwards the payload with the host app and prints the reply; with no app it prints {} fast',
  { timeout: 15_000 },
  async (t) => {
    const s = store();
    const { port } = await listen(t, s.handle);
    await post(port, HOOK, cc('UserPromptSubmit', { prompt: 'go' }));
    await post(port, '/click', '');
    const r = await shim(cc('PostToolUse', { ...bash('ls'), tool_response: {} }), port, {
      __CFBundleIdentifier: 'com.apple.Terminal',
    });
    assert.equal(r.code, 0);
    assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /level 1 of 5/);
    const started = Date.now();
    const down = await shim(cc('PostToolUse', bash('ls')), await closedPort());
    assert.deepEqual([down.code, down.out], [0, '{}']);
    assert.ok(Date.now() - started < 3000, 'well inside the hook timeout; the shim itself gives up after 1.5 s');
    assert.deepEqual(await shim('not json', port).then((x) => [x.code, x.out]), [0, '{}']);
  },
);

test(
  'at a session start the shim records which app, which agent and which process the session belongs to',
  { timeout: 15_000 },
  async (t) => {
    const fs = require('node:fs');
    const s = store();
    const { port } = await listen(t, s.handle);
    const home = tmpDir('shim');
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const r = await shim(cc('SessionStart', { source: 'startup' }), port, {
      HOME: home,
      USERPROFILE: home,
      __CFBundleIdentifier: 'com.apple.Terminal',
    });
    assert.equal(r.code, 0);
    // On Windows a detached copy of the shim writes the record after walking the process table, so wait for it.
    const file = path.join(home, '.openplead', 'hosts', 'cc-1');
    for (let i = 0; i < 100 && !fs.existsSync(file); i += 1) await new Promise((res) => setTimeout(res, 100));
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(record.host, 'com.apple.Terminal');
    assert.equal(record.agent, 'claude-code');
    if (process.platform !== 'win32') assert.equal(record.pid, process.pid, 'the test runner stands in for the agent');
  },
);
