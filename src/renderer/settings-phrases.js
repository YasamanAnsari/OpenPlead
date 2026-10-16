// @ts-check
'use strict';
/* global byId, L, current */
/* exported phrasesDirty, loadPhrases */

// The Messages tab's phrase editor, loaded after settings.js: each set is a disclosure with one bulleted row per line.

// The phrase sets: a name, when Grovel uses it and a preview; open one to edit its lines. Each line is its own
// bulleted row, so long lines never run into each other; a row can be removed, and a line added at the end.
let loadedSets = {}; // what the boxes showed when last loaded, to tell unsaved edits apart
function editedSets() {
  /** @type {Record<string, string[]>} */
  const sets = {};
  for (const details of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('details.set'))) {
    const areas = /** @type {NodeListOf<HTMLTextAreaElement>} */ (details.querySelectorAll('.line textarea'));
    sets[details.dataset.set] = [...areas].map((area) => area.value);
  }
  return sets;
}
function phrasesDirty() {
  const now = editedSets();
  return Object.keys(now).some((key) => now[key].join('\n') !== (loadedSets[key] || []).join('\n'));
}
// Tall enough for its text, so no line is ever half hidden.
function fitLine(area) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}
function lineRow(text, name) {
  const li = document.createElement('li');
  li.className = 'line';
  const area = document.createElement('textarea');
  area.rows = 1;
  area.value = text;
  area.setAttribute('aria-label', `${name}: a line`);
  area.addEventListener('input', () => fitLine(area));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '×';
  remove.title = 'Remove this line';
  remove.setAttribute('aria-label', 'Remove this line');
  remove.addEventListener('click', () => li.remove());
  li.append(area, remove);
  return li;
}
function renderPhrases({ sets }) {
  loadedSets = sets;
  const info = (current && current.phraseSets) || [];
  const box = byId('phrase-sets');
  const open = new Set(
    [.../** @type {NodeListOf<HTMLElement>} */ (box.querySelectorAll('details[open]'))].map((d) => d.dataset.set),
  );
  box.replaceChildren(
    ...info.map(({ key, name, when: used }) => {
      const details = document.createElement('details');
      details.className = 'set';
      details.dataset.set = key;
      details.open = open.has(key);
      const summary = document.createElement('summary');
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = name;
      const w = document.createElement('span');
      w.className = 'when';
      w.textContent = used;
      const p = document.createElement('span');
      p.className = 'preview';
      const lines = sets[key] || [];
      p.textContent = lines.length
        ? `“${lines[0]}”${lines.length > 1 ? ` and ${lines.length - 1} more` : ''}`
        : 'No lines yet';
      summary.append(n, w, p);
      const list = document.createElement('ul');
      list.className = 'lines';
      list.append(...lines.map((text) => lineRow(text, name)));
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'action add';
      add.dataset.label = 'Add a line';
      add.textContent = L('Add a line');
      add.addEventListener('click', () => {
        const row = lineRow('', name);
        list.append(row);
        row.querySelector('textarea').focus();
      });
      details.append(summary, list, add);
      details.addEventListener('toggle', () => {
        if (details.open) for (const area of list.querySelectorAll('textarea')) fitLine(area);
      });
      return details;
    }),
  );
}
function loadPhrases() {
  window.openplead
    .phrases()
    .then(renderPhrases)
    .catch((err) => {
      byId('phrases-status').textContent = `Could not read the phrases file: ${err.message}`;
    });
}
document.body.addEventListener('click', (e) => {
  const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-phrases]'));
  if (!el) return;
  const status = byId('phrases-status');
  if (el.dataset.phrases === 'reset') {
    if (!window.confirm('Replace every set with the built-in lines?')) return;
    window.openplead.action('resetPhrases').then(() => {
      loadPhrases();
      status.textContent = 'Defaults restored.';
    });
    return;
  }
  window.openplead.savePhrases(editedSets()).then((r) => {
    status.textContent = r && r.error ? r.error : 'Saved. Edits apply to the next line Grovel picks.';
    if (!(r && r.error)) loadPhrases();
  });
});
