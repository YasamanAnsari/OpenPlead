// @ts-check
'use strict';

// Labels are written in sentence style and converted to the platform's case here: title style on macOS ("Show Grovel
// on Every App"), sentence style elsewhere. Apple's rule: capitalize every word except articles, conjunctions and short
// prepositions, always the first and last. Shared by menu.js and the settings page, hence the UMD tail.

// Articles, coordinating conjunctions and prepositions of four letters or fewer (Apple Style Guide); pronouns are
// capitalized ("Turn It Off", "My Next Message").
const SMALL = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'for',
  'so',
  'yet',
  'at',
  'by',
  'from',
  'in',
  'into',
  'of',
  'off',
  'on',
  'onto',
  'out',
  'over',
  'to',
  'up',
  'with',
  'as',
  'per',
  'via',
]);

function titleCase(label) {
  const words = String(label).split(' ');
  return words
    .map((word, i) => {
      const m = /^([("“‘]*)([^\s]*?)([)\].,:;!?”’…]*)$/.exec(word);
      if (!m) return word;
      const [, open, core, close] = m;
      if (!core) return word;
      const first = i === 0 || Boolean(open);
      const last = i === words.length - 1;
      if (!first && !last && SMALL.has(core.toLowerCase())) return word;
      if (core.length === 1 && core !== 'a') return word; // a unit such as the s in "(20 s)"
      if (/[A-Z]/.test(core.slice(1))) return word; // an acronym or a proper name: leave it
      const small = (part) => !first && !last && SMALL.has(part.toLowerCase()); // first and last words always rise
      const cased = core
        .split('-')
        .map((part) => (part && !small(part) ? part[0].toUpperCase() + part.slice(1) : part))
        .join('-');
      return `${open}${cased}${close}`;
    })
    .join(' ');
}

// The platform's style applied to a sentence-style label.
const labelFor = (platform, label) => (platform === 'darwin' ? titleCase(label) : label);

if (typeof module !== 'undefined' && module.exports) module.exports = { titleCase, labelFor };
if (typeof window !== 'undefined') window.labelCase = { titleCase, labelFor };
