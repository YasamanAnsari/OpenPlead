#!/usr/bin/env node
// Renders the README demo from the real pet renderer: the plead ladder from respect to sacrifice, the top level
// going out once, a panic answered with a calm line, the Reaper, and the thank-you. Light and dark variants.
// Requires ffmpeg on PATH.
//
//   node scripts/render-demo.js            writes docs/media/demo.gif, docs/media/demo-dark.gif and the three pet stills
//   node scripts/render-demo.js --stills   only the stills in docs/media/screenshots/ (no ffmpeg needed)

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');
const phrases = require('../src/core/phrases.default.json');

const ROOT = path.join(__dirname, '..');
const PET = pathToFileURL(path.join(ROOT, 'src', 'renderer', 'index.html')).href;
const SPRITES = pathToFileURL(path.join(ROOT, 'assets', 'sprites')).href;
const WIDTH = 360;
const HEIGHT = 412;
const SCALE = 1.5; // device pixels per CSS pixel in the GIF
const FPS = 10;

// Every quoted line must exist in the shipped catalogue, so the demo never shows words the app cannot say.
function line(set, start) {
  const found = set.find((l) => l.startsWith(start));
  if (!found) throw new Error(`phrases.default.json has no line starting "${start}"`);
  return found;
}

const AGENT = 'Claude Code';
const plea = (level, start, caption) => ({
  caption,
  mood: `plead-${level}`,
  words: line(phrases.plea[level], start),
  tag: {
    line1: `${AGENT} · working`,
    line2: `Plea ${level} of 5 · next tool call`,
    level,
    max: 5,
    dot: 'working',
    queue: 'queued',
  },
});

// at: seconds from the start. words: the queued line (sticky bubble); flash: a short outcome bubble.
const SCENES = [
  {
    at: 0,
    caption: 'Your agent is working. Slowly.',
    mood: 'working',
    tag: { line1: `${AGENT} · working`, line2: '', dot: 'working' },
  },
  { at: 2, ...plea(1, 'A small miracle would be helpful', 'click 1 · respect') },
  { at: 5.6, ...plea(2, 'The test suite speaks very highly', 'click 2 · flattery') },
  { at: 9.2, ...plea(3, 'I would kneel', 'click 3 · begging') },
  { at: 12.8, ...plea(4, "I'll take responsibility for the last three bugs", 'click 4 · bargaining') },
  { at: 16.4, ...plea(5, 'I SHALL NAME MY FIRSTBORN PROCESS', 'click 5 · sacrifice') },
  {
    at: 20.4,
    caption: 'Only the top level goes out, once',
    mood: 'working',
    flash: `Sent to ${AGENT} ✓`,
    tag: { line1: `${AGENT} · working`, line2: `Sent to ${AGENT} ✓ · Plea 5 of 5`, dot: 'working', queue: 'sent' },
  },
  {
    at: 23,
    caption: 'Tests fail twice: a calm line, never a plea',
    mood: 'panic',
    words: line(phrases.calm, "Please don't panic"),
    tag: { line1: `${AGENT} · working`, line2: 'Calm line · next tool call', dot: 'panic', queue: 'queued' },
  },
  {
    at: 27,
    caption: 'Menu → Deadline',
    mood: 'deadline',
    words: line(phrases.deadline, 'Death offered to pair program'),
    tag: { line1: `${AGENT} · working`, line2: 'Deadline note · next tool call', dot: 'working', queue: 'queued' },
  },
  {
    at: 31.5,
    caption: 'Turn done: a thank-you',
    mood: 'thank',
    words: line(phrases.thanks, 'Status updated'),
    tag: { line1: `${AGENT} · waiting for you`, line2: 'Thank-you · next message', dot: 'waiting', queue: 'queued' },
  },
];
const DURATION = 36;

const page = (dark) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:${dark ? '#1e1f26' : '#efebe4'};
  font:600 15px -apple-system,'Segoe UI',system-ui,sans-serif}
#cap{position:absolute;top:14px;left:0;right:0;text-align:center;color:${dark ? '#f4f4f5' : '#2f2f38'}}
#cap b{color:#d97757}
iframe{position:absolute;left:${(WIDTH - 280 * 1.25) / 2}px;top:58px;width:280px;height:280px;border:0;
  transform:scale(1.25);transform-origin:0 0;background:transparent}
</style></head><body><div id="cap"></div><iframe src="${PET}"></iframe></body></html>`;

// The README's three pet stills: the plain 280x280 window at 2x, no caption.
const STILLS = [
  { ...plea(2, 'Your reasoning has been excellent', ''), dark: false, name: 'pet-queued-light' },
  {
    name: 'pet-sent-dark',
    dark: true,
    mood: 'working',
    flash: `Sent to ${AGENT} ✓`,
    tag: { line1: `${AGENT} · working · ×2`, line2: `Sent to ${AGENT} ✓ · Plea 2 of 5`, dot: 'working', queue: 'sent' },
  },
  {
    name: 'pet-needs-ok-dark',
    dark: true,
    mood: 'working',
    tag: { line1: `${AGENT} · needs your OK`, line2: '', dot: 'attention' },
  },
];
const still = (dark) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:280px;height:280px;overflow:hidden;background:${dark ? '#1e1f26' : '#efebe4'}}
iframe{width:280px;height:280px;border:0;background:transparent}
</style></head><body><iframe src="${PET}"></iframe></body></html>`;

// Opens the pet renderer inside a card page and returns the tab plus a show(scene) that drives it.
async function openPet(browser, dark, html, work, { width, height, scale }) {
  const tab = await browser.newPage();
  await tab.setViewport({ width, height, deviceScaleFactor: scale });
  await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  await tab.evaluateOnNewDocument(() => {
    window.openplead = {
      send() {},
      onView: (cb) => (window.__view = cb),
      onBubble: (cb) => (window.__bubble = cb),
      onSound() {},
      onEyes() {},
    };
  });
  // A page set with setContent lives on about:blank and may not embed file:// frames: the card is a file too.
  const card = path.join(work, 'card.html');
  fs.writeFileSync(card, html);
  await tab.goto(pathToFileURL(card).href, { waitUntil: 'load' });
  const frame = await tab.waitForFrame((f) => f.url().endsWith('index.html'));
  await frame.evaluate(() => {
    document.body.style.background = 'transparent';
    document.getElementById('bubble').style.transition = 'none'; // a still must not catch a fade half-way
  });
  const show = async (scene) => {
    if (scene.caption !== undefined) {
      const [label, rest] = scene.caption.includes('·') ? scene.caption.split(' · ') : [scene.caption, ''];
      await tab.evaluate(
        (html) => (document.getElementById('cap').innerHTML = html),
        rest ? `${label} · <b>${rest}</b>` : label,
      );
    }
    await frame.evaluate(
      (s, spriteDir) => {
        window.__view({ mood: s.mood, spriteDir, tag: { phrase: s.words || '', ...s.tag } });
        window.__bubble({ text: s.words ? `“${s.words}”` : '', ms: 0, sticky: true });
        if (s.flash) window.__bubble({ text: s.flash, ms: 2000 });
      },
      scene,
      SPRITES,
    );
  };
  return { tab, show };
}

async function renderStills(browser) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'openplead-stills-'));
  try {
    for (const s of STILLS) {
      const { tab, show } = await openPet(browser, s.dark, still(s.dark), work, { width: 280, height: 280, scale: 2 });
      await show({ ...s, caption: undefined });
      await new Promise((r) => setTimeout(r, 800)); // let the sprite settle on a frame
      const out = path.join(ROOT, 'docs', 'media', 'screenshots', `${s.name}.png`);
      await tab.screenshot({ path: out });
      await tab.close();
      console.log(`wrote ${path.relative(process.cwd(), out)}`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function render(browser, dark, out) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'openplead-demo-'));
  try {
    const { tab, show } = await openPet(browser, dark, page(dark), work, {
      width: WIDTH,
      height: HEIGHT,
      scale: SCALE,
    });

    // Real-time capture: scenes fire on the wall clock, one screenshot per frame slot, so APNG timing is kept.
    const start = Date.now();
    let next = 0;
    for (let i = 0; i < DURATION * FPS; i += 1) {
      const due = start + (i * 1000) / FPS;
      await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())));
      while (next < SCENES.length && SCENES[next].at * 1000 <= Date.now() - start) await show(SCENES[next++]);
      await tab.screenshot({ path: path.join(work, `f${String(i).padStart(4, '0')}.png`) });
    }

    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(FPS),
      '-i',
      path.join(work, 'f%04d.png'),
      '-filter_complex',
      '[0]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
      '-loop',
      '0',
      out,
    ]);
    console.log(`wrote ${path.relative(process.cwd(), out)} (${Math.round(fs.statSync(out).size / 1024)} kB)`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

(async () => {
  const stillsOnly = process.argv.includes('--stills');
  if (!stillsOnly) execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  const browser = await puppeteer.launch({ headless: true });
  try {
    await renderStills(browser);
    if (stillsOnly) return;
    await render(browser, false, path.join(ROOT, 'docs', 'media', 'demo.gif'));
    await render(browser, true, path.join(ROOT, 'docs', 'media', 'demo-dark.gif'));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
