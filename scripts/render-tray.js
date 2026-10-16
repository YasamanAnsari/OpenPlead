#!/usr/bin/env node
// Renders the tray icon variants from assets/tray.png and tray@2x.png, each from the base of the same scale.
//   Colour (Windows, Linux; tray-<state>.png): one bottom-right status badge, dimmed for quiet, grey when not
//   connected, as Microsoft's notification-area guidance asks.
//   Template (macOS; tray<State>Template.png): black-and-clear only, eyes knocked out, states by opacity and
//   alpha-only badges (filled dot: needs your OK; hollow ring: queued; 50%: quiet; 35%: not connected).
//
//   node scripts/render-tray.js

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ASSETS = path.join(__dirname, '..', 'assets', 'tray');
const SCALES = [
  { size: 18, suffix: '' },
  { size: 36, suffix: '@2x' },
];
const COLOUR = {
  attention: { badge: '#e5484d' },
  queued: { badge: '#2f81f7' },
  quiet: { opacity: 0.45 },
  off: { opacity: 0.55, filter: 'grayscale(1)' },
};
const TEMPLATE = {
  base: {},
  attention: { badge: 'dot' },
  queued: { badge: 'ring' },
  quiet: { opacity: 0.5 },
  off: { opacity: 0.35 },
};

const baseData = (suffix) =>
  `data:image/png;base64,${fs.readFileSync(path.join(ASSETS, `tray${suffix}.png`)).toString('base64')}`;

// The colour family: the base image with CSS on top.
function colourHtml(size, suffix, { badge, opacity = 1, filter = 'none' }) {
  const dot = Math.round(size * 0.42);
  const ring = Math.max(1, Math.round(size / 18));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
.box{position:relative;width:${size}px;height:${size}px}
img{display:block;width:${size}px;height:${size}px;opacity:${opacity};filter:${filter};image-rendering:pixelated}
.dot{position:absolute;right:0;bottom:0;width:${dot}px;height:${dot}px;border-radius:50%;background:${badge};
box-shadow:0 0 0 ${ring}px rgba(255,255,255,0.95)}
</style></head><body><div class="box"><img src="${baseData(suffix)}">${badge ? '<div class="dot"></div>' : ''}</div></body></html>`;
}

// The template family: drawn on a canvas so only alpha carries the shape. (The script is an IIFE: setContent keeps the
// page's global scope between renders.) Dark pixels of the base (the eyes) become
// clear; every other opaque pixel becomes black. Badges are black shapes with a clear ring cut around them.
function templateHtml(size, suffix, { badge, opacity = 1 }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
canvas{display:block}
</style></head><body><canvas id="c" width="${size}" height="${size}"></canvas><script>
(() => {
const img = new Image();
img.onload = () => {
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, ${size}, ${size});
  const px = ctx.getImageData(0, 0, ${size}, ${size});
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 16) { d[i + 3] = 0; continue; } // faint anti-aliasing: dropped
    const dark = d[i + 3] > 128 && d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90; // the eyes, not a dark edge pixel
    d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
    d[i + 3] = dark ? 0 : Math.round(d[i + 3] * ${opacity});
  }
  ctx.putImageData(px, 0, 0);
  const badge = ${JSON.stringify(badge || null)};
  if (badge) {
    const r = ${size} * 0.2;
    const cx = ${size} - r - 0.5;
    const cy = ${size} - r - 0.5;
    const ring = Math.max(1.5, ${size} / 18);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(cx, cy, r + ring, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    if (badge === 'ring') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, r - ring), 0, Math.PI * 2); ctx.fill();
    }
  }
  document.title = 'done';
};
img.src = ${JSON.stringify(baseData(suffix))};
})();
</script></body></html>`;
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const shoot = async (html, size, file, wait) => {
      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      if (wait) await page.waitForFunction(() => document.title === 'done');
      await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      console.log(`wrote ${path.relative(process.cwd(), file)}`);
    };
    for (const { size, suffix } of SCALES) {
      for (const [name, spec] of Object.entries(COLOUR)) {
        await shoot(colourHtml(size, suffix, spec), size, path.join(ASSETS, `tray-${name}${suffix}.png`), false);
      }
      for (const [name, spec] of Object.entries(TEMPLATE)) {
        const stem = name === 'base' ? 'tray' : `tray-${name}`;
        await shoot(templateHtml(size, suffix, spec), size, path.join(ASSETS, `${stem}Template${suffix}.png`), true);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
