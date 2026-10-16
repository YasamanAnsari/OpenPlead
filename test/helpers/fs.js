'use strict';

// Temporary directories for tests that touch the disk. Everything lands under the OS temp folder with an
// "openplead-" prefix, so nothing a test writes can reach the real ~/.openplead.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `openplead-${name}-`));

// Points HOME (and USERPROFILE, for Windows) at a fresh directory. Call it before requiring a module that resolves
// ~/.openplead when it loads, such as src/system/config.
function isolateHome(name) {
  const dir = tmpDir(name);
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return dir;
}

module.exports = { tmpDir, isolateHome };
