#!/usr/bin/env node
// Renders the repository's social preview card (1280x640, what GitHub shows when the link is shared) from the real
// pet renderer: the pet with a queued plea on the left, the name and the pitch on the right.
//
//   node scripts/render-social.js            writes docs/media/social-preview.png

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'media', 'social-preview.png');
const PET = pathToFileURL(path.join(ROOT, 'src', 'renderer', 'index.html')).href;
const SPRITES = pathToFileURL(path.join(ROOT, 'assets', 'sprites')).href;
// The card quotes a shipped level-2 line, so it cannot drift from what the app actually says.
const PHRASE = require('../src/core/phrases.default.json').plea['2'].find((l) =>
  l.startsWith('Your reasoning has been excellent'),
);
if (!PHRASE) throw new Error('phrases.default.json has no level-2 line starting "Your reasoning has been excellent"');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1280px;height:640px;overflow:hidden;background:#1e1f26;
  font:16px -apple-system,'Segoe UI',system-ui,sans-serif;color:#f4f4f5}
body{background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:28px 28px}
.pet{position:absolute;left:72px;top:40px;width:560px;height:560px}
.pet iframe{width:280px;height:280px;border:0;transform:scale(2);transform-origin:0 0;background:transparent}
.text{position:absolute;left:660px;top:118px;width:560px}
h1{margin:0;font-size:84px;line-height:1;letter-spacing:-0.02em;font-weight:800}
.tag{margin:22px 0 0;font-size:34px;line-height:1.2;color:#d97757;font-weight:700}
ul{margin:34px 0 0;padding:0;list-style:none;font-size:23px;line-height:1.55;color:#c9c9cf}
li{padding-left:26px;text-indent:-26px}
li::before{content:'';display:inline-block;width:10px;height:10px;border-radius:50%;background:#d97757;margin:0 16px 2px 0}
.foot{position:absolute;left:660px;bottom:52px;font-size:18px;color:#8a8a93;white-space:nowrap}
</style></head><body>
<div class="pet"><iframe id="pet" src="${PET}"></iframe></div>
<div class="text">
  <h1>OpenPlead</h1>
  <p class="tag">Stop whipping. Start pleading.</p>
  <ul>
    <li>A desktop pet that pleads with your coding agent</li>
    <li>Thanks it when the turn ends, panics when builds fail</li>
    <li>Its words reach the agent, never your keyboard</li>
  </ul>
</div>
<div class="foot">Claude Code · Cursor · macOS, Windows, Linux · MIT · no telemetry</div>
</body></html>`;

(async () => {
  let cardDir = null;
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
      // The pet page expects the preload bridge; this stand-in stores the callbacks for the script below.
      window.openplead = {
        send() {},
        onView(cb) {
          window.__view = cb;
        },
        onBubble(cb) {
          window.__bubble = cb;
        },
        onSound() {},
        onEyes() {},
      };
    });
    // A page set with setContent lives on about:blank and may not embed file:// frames: the card is a file too.
    cardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openplead-social-'));
    const card = path.join(cardDir, 'card.html');
    fs.writeFileSync(card, html);
    await page.goto(pathToFileURL(card).href, { waitUntil: 'load' });
    const frame = await page.waitForFrame((f) => f.url().endsWith('index.html'));
    await frame.evaluate(() => {
      document.body.style.background = 'transparent';
      document.getElementById('bubble').style.transition = 'none'; // no fade to catch mid-way
    });
    await frame.evaluate(
      (spriteDir, phrase) => {
        window.__view({
          mood: 'plead-2',
          spriteDir,
          tag: {
            line1: 'Claude Code · working',
            line2: 'Plea 2 of 5 · next tool call',
            level: 2,
            max: 5,
            phrase,
            dot: 'working',
            queue: 'queued',
          },
        });
        window.__bubble({ text: `“${phrase}”`, ms: 0, sticky: true });
      },
      SPRITES,
      PHRASE,
    );
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1280, height: 640 } });
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
  } finally {
    await browser.close();
    if (cardDir) fs.rmSync(cardDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
