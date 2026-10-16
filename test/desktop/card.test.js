'use strict';

// The reply card: the pose that said the line, and the PNG that is saved.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spriteFor } = require('../../src/desktop/card');

test('the card shows the pose that said the line', () => {
  assert.equal(spriteFor('plea', 5), 'plead-5.apng');
  assert.equal(spriteFor('thanks', 0), 'thank.apng');
  assert.equal(spriteFor('hug', undefined), 'plead-2.apng', 'other kinds and old records fall back to the mid pose');
});

test('a saved card is named by the local reply time and holds the rendered bytes', async () => {
  const { saveCard } = require('../../src/desktop/card');
  let written = null;
  let rendered = null;
  const entry = { at: new Date(2026, 9, 15, 9, 5).getTime(), plea: 'p', reply: 'r', kind: 'thanks', level: 0 };
  const file = await saveCard({
    entry,
    agent: 'Claude Code',
    label: 'x',
    dir: '/desk',
    render: async (opts) => {
      rendered = opts;
      return Buffer.from('png');
    },
    writeFile: (f, png) => (written = { f, png }),
  });
  assert.equal(file, path.join('/desk', 'OpenPlead reply 2026-10-15 09.05.00.png'));
  assert.equal(written.f, file);
  assert.equal(written.png.toString(), 'png');
  assert.equal(rendered.kind, 'thanks');
  assert.match(rendered.when, /2026/);
});

test('two cards saved in the same second never overwrite each other or any file already there', async () => {
  const fs = require('node:fs');
  const { tmpDir } = require('../helpers/fs');
  const dir = tmpDir('cards');
  const entry = { at: new Date(2026, 9, 15, 9, 5, 7).getTime(), plea: 'p', reply: 'r', kind: 'plea', level: 1 };
  const { saveCard: save1 } = require('../../src/desktop/card');
  const save = () =>
    save1({
      entry,
      agent: 'Claude Code',
      label: 'x',
      dir,
      render: async () => Buffer.from('png'),
      writeFile: fs.writeFileSync,
    });
  const first = await save();
  const second = await save();
  assert.equal(path.basename(first), 'OpenPlead reply 2026-10-15 09.05.07.png');
  assert.equal(path.basename(second), 'OpenPlead reply 2026-10-15 09.05.07 (2).png');
});
