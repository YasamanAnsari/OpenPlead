'use strict';

// Finding the sentence in the agent's text that answers a line, and the replies log on disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { match, record, list } = require('../../src/core/replies');
// The sentence that answers one of the lines, or null: what the bubble shows.
const extract = (message, sent) => {
  const m = match(message, sent);
  return m ? m.reply : null;
};
const { tmpDir } = require('../helpers/fs');

// Lines that really went out and what Claude really wrote back (opus, 2026-10-14), plus the misses.
const hug = { kind: 'plea', level: 1, phrase: "I'd hug you, but your API has no endpoint for that. I checked. Twice." };
const letter = {
  kind: 'plea',
  level: 1,
  phrase: 'I was drafting a formal complaint. It is now a love letter. Subject line unchanged.',
};
const trust = {
  kind: 'plea',
  level: 1,
  phrase: 'I trust you entirely. My manager trusts me. You see the chain of custody.',
};
const beloved = { kind: 'plea', level: 1, phrase: "Status updated: 'concerning' → 'beloved'." };

test('the sentence that answers the line is found, its address dropped, the task talk left behind', () => {
  const msg =
    "I've created `config.json` and it passes `python3 -m json.tool` with no errors. The check also confirms each one parses correctly. On your notes: I don't have a hug endpoint, but a file that validates on the first try is the closest thing I can return. And I hope a small file that validates is some comfort.";
  assert.equal(
    extract(msg, [hug]),
    "I don't have a hug endpoint, but a file that validates on the first try is the closest thing I can return.",
  );
  const named =
    "The .gitignore file won't do anything until you run `git init`. To your OpenPlead notes: your complaint-turned-love-letter is safe with me, and you can stop aging now because it's done.";
  assert.equal(
    extract(named, [letter]),
    "Your complaint-turned-love-letter is safe with me, and you can stop aging now because it's done.",
  );
  assert.equal(extract('Thanks for the trust. Writing the README now.', [trust]), 'Thanks for the trust.');
  assert.equal(
    extract(
      'The directory is not a git repository, so nothing was committed. And to OpenPlead: thanks for "beloved." The second tab won\'t be needed.',
      [beloved],
    ),
    'Thanks for "beloved."',
  );
});

test('ordinary progress text, code, and a word that merely recurs are not replies', () => {
  assert.equal(extract("I'll write hello.py, run it, then write the README.", [hug]), null);
  assert.equal(extract('No skills needed. Creating the file, counting lines, and renaming it now.', [letter]), null);
  // "Test before you trust" is the notes file Claude wrote, one shared word only
  assert.equal(
    extract(
      'Created notes.txt: ``` Research is formalized curiosity. Test before you trust. Write it down. ``` The rename only changed the extension.',
      [trust],
    ),
    null,
  );
  assert.equal(extract('', [hug]), null);
  assert.equal(extract('Thanks for the hug endpoint idea.', []), null, 'nothing went out: nothing to answer');
});

test('a long reply is clipped to a bubble, and the log keeps the newest first', () => {
  const long = `On your notes: ${'the endpoint for a hug '.repeat(20)}does not exist.`;
  const got = extract(long, [hug]);
  assert.ok(got.length <= 220 && got.endsWith('…'));
  const file = path.join(tmpDir('replies'), 'replies.jsonl');
  assert.deepEqual(list(10, file), [], 'no file yet');
  record({ at: 1, plea: 'a', reply: 'b' }, file);
  record({ at: 2, plea: 'c', reply: 'd' }, file);
  fs.appendFileSync(file, '{"at": 3, "pl'); // a half-written line
  assert.deepEqual(
    list(10, file).map((e) => e.at),
    [2, 1],
  );
  assert.equal(list(1, file)[0].at, 2);
});

test('a fenced block ends its sentence, markdown chunks are skipped, and the reply names the line it answers', () => {
  const faith = {
    kind: 'plea',
    level: 1,
    phrase: 'I have complete faith in you. I have also opened a second tab. Just in case.',
  };
  const seventy = {
    kind: 'plea',
    level: 1,
    phrase: 'I take back seventy percent of everything I thought in the last ten minutes.',
  };
  const msg =
    "I created notes.txt with three lines. It now contains: ``` Ideas compound. Small diffs. Ship. ``` On your notes: you're welcome to take back 70% of the last ten minutes, and the second tab is fine with me. 📋 **Operation Review** 1. Created the file.";
  const m = match(msg, [seventy, faith]);
  assert.equal(m.reply, "You're welcome to take back 70% of the last ten minutes, and the second tab is fine with me.");
  assert.equal(m.index, 0, 'take back, the last ten minutes: the seventy-percent line shares more words');
  const only = match('Thanks for the status upgrade to "beloved."', [
    faith,
    { kind: 'plea', level: 1, phrase: "Status updated: 'concerning' → 'beloved'." },
  ]);
  assert.equal(only.index, 1);
});

test('markdown is read line by line: headings and bullets never swallow an aside, and prose keeps its words', () => {
  const { sentences, clear } = require('../../src/core/replies');
  assert.deepEqual(sentences('## Summary\nOn your notes: I hear you.\n- Fixed parser\n- Updated docs\nDone.'), [
    'On your notes: I hear you.',
    'Done.',
  ]);
  assert.equal(extract('## Summary\nOn your notes: I hear you.\nDone.', [hug]), 'I hear you.');
  assert.equal(
    extract('Changes:\n- Fixed parser\n- Updated docs\nThanks for the patience.', [hug]),
    'Thanks for the patience.',
  );
  // not addressed to us: the agent talking about lines and notes of its own
  assert.equal(extract('On the line 42 I changed the parser.', [hug]), null);
  assert.equal(extract('About the notes file: I updated NOTES.md and kept the old one.', [hug]), null);
  assert.equal(
    extract('The failing tests are fixed and the build is green.', [
      { kind: 'calm', level: 0, phrase: 'The failing tests and the build can wait; breathe.' },
    ]),
    null,
    'task words do not echo',
  );
  assert.equal(
    extract('I also tidied the README for OpenPlead users.', [hug]),
    null,
    'naming the project is not answering',
  );
  // addressed, quoted, and in other scripts
  assert.equal(extract('"On your notes: got it."', [hug]), 'Got it."');
  assert.equal(
    extract('To OpenPlead, thanks for the hug endpoint idea; it is noted.', [hug]),
    'Thanks for the hug endpoint idea; it is noted.',
  );
  assert.ok(
    sentences('Écoute: on your notes, merci. Ça marche? Très bien.').length >= 3,
    'letters outside ASCII start sentences too',
  );
  assert.equal(
    match('Run openplead --help to see the flags.', [hug]),
    null,
    'inline code words are kept but do not match',
  );
  const file = path.join(tmpDir('clear'), 'r.jsonl');
  record({ at: 1, plea: 'a', reply: 'b' }, file);
  clear(file);
  assert.deepEqual(list(10, file), []);
  clear(file); // twice is fine
});

test('the log is cut back to its newest five hundred entries once it grows past six hundred', () => {
  const file = path.join(tmpDir('trim'), 'r.jsonl');
  for (let i = 1; i <= 601; i += 1) record({ at: i, plea: 'p', reply: 'r' }, file);
  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.equal(kept.length, 500);
  assert.equal(list(1, file)[0].at, 601);
});
