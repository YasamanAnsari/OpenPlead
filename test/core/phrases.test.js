'use strict';

// The phrase sets: lines per kind, no repeats back to back, the invitation clause, packs and edits.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tmpDir } = require('../helpers/fs');
const phrases = require('../../src/core/phrases');

const defaults = require('../../src/core/phrases.default.json');
const KINDS = ['calm', 'thanks', 'deadline', 'thinking', 'suspicious', 'hug', 'zen', 'apology'];

test('every reply kind the state machine can emit has lines, and pleas cover levels 1 to 5', () => {
  for (const kind of KINDS) assert.ok(defaults[kind].length >= 3, kind);
  for (let level = 1; level <= 5; level += 1) assert.ok(defaults.plea[String(level)].length >= 3, `plea ${level}`);
});

test('no line is shared between sets, so each emotion sends the agent different words', () => {
  const sets = [...KINDS.map((k) => defaults[k]), ...Object.values(defaults.plea)];
  const all = sets.flat();
  assert.equal(new Set(all).size, all.length, 'duplicate line across or within sets');
  for (const line of all) assert.ok(line.length <= 100, `too long for the bubble: ${line}`);
});

test('the same set never repeats a line back to back', () => {
  let last = null;
  for (let i = 0; i < 200; i += 1) {
    const { phrase } = phrases.render(defaults, 'thanks');
    assert.notEqual(phrase, last);
    last = phrase;
  }
  for (let i = 0; i < 50; i += 1)
    assert.notEqual(phrases.render(defaults, 'plea', 3).phrase, phrases.render(defaults, 'plea', 3).phrase);
});

test('a phrase chosen earlier is used verbatim at delivery', () => {
  assert.deepEqual(phrases.render(defaults, 'plea', 2, 'the chosen line'), {
    phrase: 'the chosen line',
    text: 'The user pressed OpenPlead\'s plead button (level 2 of 5) and says: "the chosen line"',
  });
  assert.equal(phrases.render(defaults, 'thanks', 0, 'ta').phrase, 'ta');
});

test('delivered text names the user as the speaker', () => {
  assert.match(
    phrases.render(defaults, 'plea', 2).text,
    /^The user pressed OpenPlead's plead button \(level 2 of 5\) and says: "/,
  );
  assert.match(phrases.render(defaults, 'hug').text, /^The user, through OpenPlead, says: "/);
});

test('the editable sets round-trip and every set must keep at least one line', () => {
  const sets = phrases.sets(defaults);
  assert.deepEqual(Object.keys(sets).slice(0, 5), ['plea.1', 'plea.2', 'plea.3', 'plea.4', 'plea.5']);
  assert.ok(sets.thanks.length >= 3);
  const back = phrases.fromSets(sets);
  assert.deepEqual(back.phrases, defaults);
  const edited = { ...sets, 'plea.1': '  Please.  \n\n   \nAnother line that is fine' };
  assert.deepEqual(phrases.fromSets(edited).phrases.plea['1'], ['Please.', 'Another line that is fine']);
  assert.match(phrases.fromSets({ ...sets, calm: [] }).error, /Calm down needs at least one line/);
  assert.match(phrases.fromSets({ ...sets, 'plea.3': ' ' }).error, /Plea 3 · worried needs at least one line/);
  assert.equal(phrases.fromSets({ ...sets, hug: ['x'.repeat(500)] }).phrases.hug[0].length, 240, 'lines are capped');
});

test('the invitation is one clause, off unless asked for, and never turns the line into a request', () => {
  const { render, INVITE } = require('../../src/core/phrases');
  const sets = defaults;
  const plain = render(sets, 'plea', 2, 'Please.');
  assert.equal(plain.text, 'The user pressed OpenPlead\'s plead button (level 2 of 5) and says: "Please."');
  const invited = render(sets, 'plea', 2, 'Please.', { invite: true });
  assert.equal(invited.text, plain.text + INVITE);
  assert.equal(INVITE, ' A one-line answer is welcome.');
  assert.equal(
    render(sets, 'thanks', 0, 'Thanks.', { invite: true }).text,
    'The user, through OpenPlead, says: "Thanks." A one-line answer is welcome.',
  );
});

test('a phrase pack is refused before anything is written when a set is unknown or not a list of strings', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = tmpDir('pack');
  const pack = (body) => {
    const file = path.join(dir, 'pack.json');
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
  };
  assert.throws(() => phrases.importPack(pack({ _note: 'ok', shouting: ['NO'] })), /unknown set "shouting"/);
  assert.throws(() => phrases.importPack(pack({ thanks: 'not a list' })), /"thanks" must be a list of strings/);
  assert.throws(() => phrases.importPack(pack({ thanks: [1, 2] })), /"thanks" must be a list of strings/);
});
