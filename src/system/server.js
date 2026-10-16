// @ts-check
'use strict';

const http = require('node:http');
const agents = require('../agents');
const { HOOK_PATH } = require('./install');

// Local HTTP endpoint for the hook shim. POST /hook with the raw hook payload; the response body is the
// JSON the hook should print. POST /click mirrors a click on the pet (used by tests and demos).
//   handle(input) -> { text, kind, level, phrase } | null   the store's dispatch
//   onDelivered(reply)                               called when an adapter actually injected the text
//   enabled(agentId) -> boolean                      payloads from disabled agents get {} and change nothing
//   health() -> object                               extra fields for GET /health (used by `openplead doctor`)
//   onListening(port)                                the port actually bound; differs from `port` when it was taken
const MAX_BODY = 8 * 1024 * 1024; // PostToolUse can carry a whole edited file; nothing legitimate is bigger
const DRAIN_MS = 2000;

// Only loopback names may address this server. A web page that rebinds its domain to 127.0.0.1 still sends its own
// name as Host, so this closes DNS rebinding without touching the agents, whose clients send 127.0.0.1:<port>.
function allowedHost(header, port) {
  if (!header) return true; // HTTP/1.0 clients; the agents all send one
  const m = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i.exec(String(header).trim());
  return Boolean(m) && (!m[2] || Number(m[2]) === port);
}

// A web page can reach loopback without a CORS preflight only with a "simple" request: never with a JSON content type,
// and browsers add Origin or Sec-Fetch-Site. The agents and the shim send application/json and neither header.
function fromAgent(headers) {
  if (headers.origin || headers['sec-fetch-site']) return false;
  return String(headers['content-type'] || '')
    .toLowerCase()
    .startsWith('application/json');
}

// The status goes out and the rest of the upload is read and dropped, so the client sees it: closing the socket under
// an upload still in flight resets the connection and the status is lost with it. A client that never stops sending
// is cut off after a moment.
function refuse(req, res, status) {
  res.writeHead(status).end('{}');
  req.resume();
  const cutoff = setTimeout(() => req.destroy(), DRAIN_MS);
  cutoff.unref();
  req.on('close', () => clearTimeout(cutoff));
}

// The port a server is bound to, once it listens (address() is a string for pipes, never here).
const portOf = (srv) => {
  const a = srv.address();
  return a && typeof a === 'object' ? a.port : 0;
};

function start({ port, handle, onDelivered, enabled, onError, health = () => ({}), onListening = (_port) => {} }) {
  const server = http.createServer((req, res) => {
    if (!allowedHost(req.headers.host, portOf(server)) || (req.method === 'POST' && !fromAgent(req.headers))) {
      refuse(req, res, 403);
      return;
    }
    if (Number(req.headers['content-length']) > MAX_BODY) {
      refuse(req, res, 413);
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, port: portOf(server), ...health() }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    let size = 0;
    let refused = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY && !refused) {
        refused = true;
        refuse(req, res, 413);
        return;
      }
      if (!refused) chunks.push(c);
    });
    req.on('end', () => {
      if (refused) return;
      try {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(route(req.url, Buffer.concat(chunks).toString() || '{}', handle, onDelivered, enabled)));
      } catch (err) {
        onError(err);
        res.writeHead(400).end('{}');
      }
    });
  });
  server.on('error', (err) => {
    // Something else owns the port: take any free one. The caller saves it and re-registers the hooks.
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE' && !server.listening) {
      server.listen(0, '127.0.0.1');
      return;
    }
    onError(err);
  });
  server.on('listening', () => onListening(portOf(server)));
  server.listen(port, '127.0.0.1');
  return server;
}

function route(url, body, handle, onDelivered, enabled) {
  if (url === '/click') {
    handle({ type: 'click' });
    return {};
  }
  if (url !== '/hook' && url !== HOOK_PATH) throw new Error(`unknown route ${url}`);
  const payload = JSON.parse(body);
  const adapter = agents.detect(payload);
  if (!adapter) throw new Error(`unrecognised hook payload: ${body.slice(0, 200)}`);
  if (!enabled(adapter.id)) return {};
  const event = adapter.normalize(payload);
  const reply = handle({ type: 'hook', event });
  const out = adapter.reply(event, reply);
  if (reply && Object.keys(out).length) onDelivered(reply);
  return out;
}

module.exports = { start, allowedHost, fromAgent };
