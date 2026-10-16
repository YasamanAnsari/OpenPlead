'use strict';

// Writes a session record the way the hook shim does (one JSON line per session id), so tests can lay down fixtures
// without the app having a writer of its own; the app only reads these files.
const fs = require('node:fs');
const path = require('node:path');

function writeRecord(dir, id, { host = null, apps = [], pid = null, agent = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), `${JSON.stringify({ host, apps, pid, agent })}\n`);
}

module.exports = { writeRecord };
