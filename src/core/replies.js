// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DIR } = require('../system/config');

// What the agent said back. With "Ask Claude to reply" on, Claude Code's text reaches the pet as it is displayed
// (MessageDisplay) and once more as the turn's final text (Stop's last_assistant_message); the sentence that answers a
// line that went out is the reply. It goes to the bubble and to a local log, nowhere else. Claude Code only: Cursor's
// stop hook carries no text.

const FILE = path.join(DIR, 'replies.jsonl');
const MAX_CHARS = 220;
const MAX_SENTENCE = 600; // longer "sentences" are tables or dumps, not an aside
const KEEP = 500; // log entries kept
const TRIM_AT = 600; // the log is cut back to KEEP once it passes this

// Words too common, or too much about the work itself, to tie a sentence to a line (matches need four letters or
// more). Task words are here so that "the failing tests are fixed and the build is green" does not echo a calm line.
const COMMON = new Set(
  `about after again also been because could done every first from have here into just like made make more much next
   only other over please same should some such than that them then there these they thing things this those through
   very want well were what when which while will with would your yours openplead
   test tests build builds file files error errors fixed fixes failing failed passing passes command commands script
   scripts directory function functions change changes code line lines create created creating running output result
   results works working write wrote read update updated added remove removed check checked confirmed`.split(/\s+/),
);

const words = (s) =>
  new Set(
    (
      String(s)
        .toLowerCase()
        .match(/[\p{L}']{4,}/gu) || []
    ).filter((w) => !COMMON.has(w)),
  );

// Prose only: fenced code goes, inline code keeps its words, and markdown headings, bullets, tables, quotes, numbered
// items and emoji chunks are skipped. Lines are split first, then sentences within a line.
function sentences(text) {
  const out = [];
  const plain = String(text)
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/`([^`\n]*)`/g, '$1');
  for (const rawLine of plain.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^([#>|*-]|\d+[.)]|\p{Extended_Pictographic})/u.test(line)) continue;
    for (const piece of line.split(/(?<=[.!?]["”’']?)\s+/)) {
      const s = piece.trim();
      if (s && s.length <= MAX_SENTENCE && /^["“'‘]?\p{L}/u.test(s)) out.push(s);
    }
  }
  return out;
}

// "On your notes: …", "To your OpenPlead notes, …", "And to OpenPlead: …": an aside addressed to the lines.
const ADDRESSED =
  /^["“'‘]?(and )?((on|to|replying to|as for|about) your (two |openplead )?(notes?|messages?|lines?|asides?)[^:,]{0,30}[:,]|to openplead[:,])/i;
const THANKS = /^["“'‘]?(and )?(to openplead[:,] )?(thanks?|thank you)\b/i;
const NAMED = /\b(to|on) openplead\b/i;
const SECOND_PERSON = /\b(you|your|you're|yours|thanks?|thank you|welcome)\b/i;

const unaddress = (s) =>
  s
    .replace(
      /^["“'‘]?(and )?(on|to|replying to|as for|about) your (two |openplead )?(notes?|messages?|lines?|asides?)[^:,]{0,30}[:,]\s*/i,
      '',
    )
    .replace(/^["“'‘]?(and )?to openplead[:,]\s*/i, '')
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase());

// Clipped on a character boundary, never inside an emoji.
function clip(s) {
  const chars = Array.from(s);
  if (chars.length <= MAX_CHARS) return s;
  return `${chars
    .slice(0, MAX_CHARS - 1)
    .join('')
    .replace(/\s+\S*$/, '')}…`;
}

// The reply in `message` to one of the lines `sent` ([{ kind, level, phrase }]), or null. A sentence counts when it
// is addressed to the lines or to OpenPlead, starts with thanks, or echoes a line: three uncommon words of it, or two
// in a sentence that speaks to "you". At most two sentences are kept, and the line they share the most words with is
// the one they answer (`index`).
function match(message, sent) {
  if (!message || !Array.isArray(sent) || !sent.length) return null;
  const phraseWords = sent.map((item) => words(item.phrase || ''));
  const hits = [];
  for (const sentence of sentences(message)) {
    const own = words(sentence);
    const perLine = phraseWords.map((pw) => [...own].filter((w) => pw.has(w)).length);
    const shared = Math.max(0, ...perLine);
    const toUs =
      ADDRESSED.test(sentence) ||
      NAMED.test(sentence) ||
      (/\bopenplead\b/i.test(sentence) && SECOND_PERSON.test(sentence));
    const echo = shared >= 3 || (shared >= 2 && SECOND_PERSON.test(sentence));
    if (toUs || THANKS.test(sentence) || echo) hits.push({ text: unaddress(sentence), perLine });
    if (hits.length === 2) break;
  }
  if (!hits.length) return null;
  const score = sent.map((_, i) => hits.reduce((n, h) => n + h.perLine[i], 0));
  const best = Math.max(...score);
  const index = best > 0 ? score.lastIndexOf(best) : sent.length - 1; // no shared words: the last line that went out
  return { reply: clip(hits.map((h) => h.text).join(' ')), index };
}

// Appended as one line, readable by the owner only; the file is cut back to the newest KEEP entries now and then.
function record(entry, file = FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (lines.length > TRIM_AT) fs.writeFileSync(file, `${lines.slice(-KEEP).join('\n')}\n`, { mode: 0o600 });
}

// The last `n` entries that parse, newest first; a missing or damaged file is simply empty.
function list(n = 10, file = FILE) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignored: a half-written line
    }
  }
  return out.slice(-n).reverse();
}

function clear(file = FILE) {
  fs.rmSync(file, { force: true });
}

module.exports = { FILE, match, record, list, clear, sentences };
