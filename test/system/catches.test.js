'use strict';

// A catch block that swallows an error says why, in a form this test can hold: its first line is a comment that
// starts with "ignored:" or "best effort:". Blocks that return, rethrow or report are not silent and are left alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
  });
}
// The lines inside each catch block: from the "catch {" line to the closing brace at the same indentation.
function catchBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)\} catch(?: \([^)]*\))? \{\s*$/.exec(line);
    if (!m) return;
    const body = [];
    for (let j = i + 1; j < lines.length && lines[j] !== `${m[1]}}`; j += 1) body.push(lines[j]);
    blocks.push({ line: i + 1, body });
  });
  return blocks;
}

test('every silent catch in src and bin says why it is silent', () => {
  const offenders = [];
  for (const file of [...files(path.join(ROOT, 'src')), ...files(path.join(ROOT, 'bin'))]) {
    for (const { line, body } of catchBlocks(fs.readFileSync(file, 'utf8'))) {
      const statements = body.filter((l) => l.trim() && !l.trim().startsWith('//'));
      if (statements.length) continue; // it does something with the error
      const first = (body[0] || '').trim();
      if (!/^\/\/ (ignored|best effort): /.test(first)) offenders.push(`${path.relative(ROOT, file)}:${line}`);
    }
  }
  assert.deepEqual(offenders, []);
});
