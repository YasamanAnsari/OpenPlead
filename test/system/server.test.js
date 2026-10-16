'use strict';

// The local HTTP endpoint: health, hook payloads, and the loopback-only guards.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const server = require('../../src/system/server');
const { HOOK_PATH } = require('../../src/system/install');
const { allowedHost, fromAgent } = require('../../src/system/server');

function listen(t, opts) {
  return new Promise((resolve) => {
    const s = server.start({
      handle: () => null,
      onDelivered() {},
      enabled: () => true,
      onError: assert.fail,
      ...opts,
      onListening: (port) => resolve({ s, port }),
    });
    t.after(() => s.close());
  });
}

// Posts are sent the way the agents and the shim send them: JSON, no browser headers. `chunks` streams the body
// without a content-length, the way a client that does not know its size would.
function request(port, method, url, body, headers = {}, { chunks } = {}) {
  return new Promise((resolve, reject) => {
    const all = { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers };
    let responded = false;
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: all }, (res) => {
      responded = true;
      let data = '';
      res.on('data', (c) => {
        data += c;
      });
      // A 413 arrives while the client is still sending, and the server then closes the socket under it: the
      // status is what matters, not how the rest of the upload died.
      res.on('close', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (err) => {
      if (!responded) reject(err);
    });
    if (chunks) {
      for (const c of chunks) req.write(c);
      req.end();
    } else req.end(body);
  });
}

test('health reports the bound port plus app fields; non-POST elsewhere is 404', async (t) => {
  const { port } = await listen(t, { port: 0, health: () => ({ sessions: 2 }) });
  const res = await request(port, 'GET', '/health');
  assert.deepEqual(JSON.parse(res.body), { ok: true, port, sessions: 2 });
  assert.equal((await request(port, 'GET', HOOK_PATH)).status, 404);
});

test('a taken port falls back to a free one and reports it', async (t) => {
  const first = await listen(t, { port: 0 });
  const second = await listen(t, { port: first.port });
  assert.notEqual(second.port, first.port);
  assert.equal(JSON.parse((await request(second.port, 'GET', '/health')).body).port, second.port);
});

test('an http hook payload reaches handle and the reply is returned as JSON', async (t) => {
  const seen = [];
  const { port } = await listen(t, {
    port: 0,
    handle: (input) => {
      seen.push(input);
      return null;
    },
  });
  const payload = { hook_event_name: 'UserPromptSubmit', session_id: 's1', openplead_host: 'com.apple.Terminal' };
  const res = await request(port, 'POST', HOOK_PATH, JSON.stringify(payload));
  assert.equal(res.status, 200);
  assert.doesNotThrow(() => JSON.parse(res.body));
  assert.equal(seen[0].event.host, 'com.apple.Terminal', 'the host app the shim tagged reaches the event');
});

test('only loopback names may address the server; a rebinding page or an oversized body is refused', async (t) => {
  assert.ok(allowedHost('127.0.0.1:47821', 47821));
  assert.ok(allowedHost('localhost:47821', 47821));
  assert.ok(allowedHost('[::1]:47821', 47821));
  assert.ok(allowedHost(undefined, 47821), 'an HTTP/1.0 client');
  assert.ok(!allowedHost('evil.example:47821', 47821));
  assert.ok(!allowedHost('127.0.0.1:1', 47821), 'another port is another server');
  const seen = [];
  const { port } = await listen(t, {
    port: 0,
    handle: (input) => {
      seen.push(input);
      return null;
    },
  });
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1' });
  assert.equal((await request(port, 'POST', HOOK_PATH, payload, { host: 'evil.example:' + port })).status, 403);
  assert.equal((await request(port, 'GET', '/health', undefined, { host: 'evil.example' })).status, 403);
  assert.equal(seen.length, 0, 'nothing reached the store');
  assert.equal((await request(port, 'POST', HOOK_PATH, payload)).status, 200);
  const pad = 'x'.repeat(1024 * 1024);
  const big = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1', pad: pad.repeat(8) + 'x' });
  assert.equal((await request(port, 'POST', HOOK_PATH, big)).status, 413, 'refused from the content-length alone');
  const streamed = await request(port, 'POST', HOOK_PATH, undefined, {}, { chunks: Array(9).fill(pad) });
  assert.equal(streamed.status, 413, 'a body streamed without a length is refused once it grows past the cap');
  assert.equal(seen.length, 1, 'the two oversized posts changed nothing');
  const edit = JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: 's1',
    tool_input: { content: pad.repeat(2) },
  });
  assert.equal((await request(port, 'POST', HOOK_PATH, edit)).status, 200, 'a PostToolUse carrying a large file fits');
});

test('a web page cannot post here: browser-shaped requests are refused on loopback too', async (t) => {
  assert.ok(fromAgent({ 'content-type': 'application/json' }), 'the agents and the shim');
  assert.ok(fromAgent({ 'content-type': 'application/json; charset=utf-8' }));
  assert.ok(!fromAgent({ 'content-type': 'text/plain' }), 'the only content types a page can send without a preflight');
  assert.ok(!fromAgent({}), 'no content type at all');
  assert.ok(
    !fromAgent({ 'content-type': 'application/json', origin: 'https://evil.example' }),
    'browsers always add Origin',
  );
  assert.ok(!fromAgent({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }));
  const seen = [];
  const { port } = await listen(t, {
    port: 0,
    handle: (input) => {
      seen.push(input);
      return null;
    },
  });
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1' });
  const page = { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' };
  assert.equal(
    (await request(port, 'POST', HOOK_PATH, payload, { ...page, 'content-type': 'text/plain' })).status,
    403,
  );
  assert.equal((await request(port, 'POST', HOOK_PATH, payload, page)).status, 403, 'even claiming JSON');
  assert.equal((await request(port, 'POST', '/click', '', { 'content-type': 'text/plain' })).status, 403);
  assert.equal(seen.length, 0, 'nothing reached the store');
  assert.equal((await request(port, 'GET', '/health', undefined, page)).status, 200, 'reading health is harmless');
  assert.equal((await request(port, 'POST', HOOK_PATH, payload)).status, 200, 'the agents still get through');
});
