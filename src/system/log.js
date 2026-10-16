// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DIR } = require('./config');

// stderr is discarded when a hook launches the app, so the log also goes to ~/.openplead/openplead.log.
// Limitation: the file is truncated past 1 MB instead of rotated; enough for a diagnosis, not an archive.
const FILE = path.join(DIR, 'openplead.log');
const MAX_BYTES = 1024 * 1024;

function log(...args) {
  const line = `${new Date().toISOString()} ${args.join(' ')}\n`;
  console.error('openplead:', ...args);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE) && fs.statSync(FILE).size > MAX_BYTES) fs.truncateSync(FILE, 0);
    fs.appendFileSync(FILE, line);
  } catch {
    // ignored: logging must never take the app down
  }
}

// An unexpected failure, with where it happened and the stack. Expected conditions (a missing file, a refused
// connection) are handled where they occur and never come here.
function report(context, err) {
  const stack = err && err.stack ? `\n${err.stack}` : '';
  log(`${context}: ${err && err.message ? err.message : err}${stack}`);
}

module.exports = { log, report, FILE };
