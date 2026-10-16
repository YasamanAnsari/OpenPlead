#!/usr/bin/env node
// Render animated SVG states to transparent APNG (for the pet) and GIF (for docs).
//
//   node scripts/render-sprites.js <file.svg | dir> <outdir> [--fps 10] [--scale 3] [--duration ms]
//
// Frames are captured deterministically: the SVG clock and every Web Animation
// are paused, then seeked to t = i / fps before each screenshot. Duration is
// read from SMIL `dur` and CSS `animation-duration` values unless --duration is
// given; a static SVG renders as one frame. Requires ffmpeg on PATH.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer');

function parseArgs(argv) {
  const opts = { fps: 10, scale: 3, duration: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fps') opts.fps = Number(argv[++i]);
    else if (a === '--scale') opts.scale = Number(argv[++i]);
    else if (a === '--duration') opts.duration = Number(argv[++i]);
    else opts.positional.push(a);
  }
  if (opts.positional.length !== 2) {
    console.error('usage: render-sprites.js <file.svg|dir> <outdir> [--fps N] [--scale N] [--duration ms]');
    process.exit(1);
  }
  return opts;
}

// Max of all `dur="1.5s"` / `dur="400ms"` and CSS `animation-duration` / `animation:` durations.
function inferDurationMs(svgText) {
  const re = /(?:\bdur\s*=\s*["']|animation(?:-duration)?\s*:[^;]*?)(\d*\.?\d+)(ms|s)\b/g;
  let max = 0;
  for (const m of svgText.matchAll(re)) {
    const ms = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
    if (ms > max) max = ms;
  }
  return max || null;
}

function svgSize(svgText) {
  const vb = svgText.match(/viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  const w = svgText.match(/<svg[^>]*\swidth\s*=\s*["'](\d+\.?\d*)/);
  const h = svgText.match(/<svg[^>]*\sheight\s*=\s*["'](\d+\.?\d*)/);
  const width = Number((w && w[1]) || (vb && vb[1]));
  const height = Number((h && h[1]) || (vb && vb[2]));
  if (!width || !height) throw new Error('SVG needs width/height or a viewBox');
  return { width, height };
}

// Character invariants: one 96x60 body, exactly two 20x20 arms, exactly four legs.
// Parts are tagged data-part="body|arm|leg"; a folded leg is a <g data-part="leg"> of 11-wide segments.
function checkAnatomy(svgPath, svgText) {
  const tags = (part) =>
    [...svgText.matchAll(new RegExp(`<(rect|g)\\b[^>]*data-part="${part}"[^>]*>`, 'g'))].map((m) => m[0]);
  const size = (tag) => {
    const w = tag.match(/\swidth="([\d.]+)"/),
      h = tag.match(/\sheight="([\d.]+)"/);
    return w && h ? `${w[1]}x${h[1]}` : null;
  };
  const body = tags('body'),
    arms = tags('arm'),
    legs = tags('leg');
  const errors = [];
  if (body.length !== 1 || size(body[0]) !== '96x60') errors.push(`expected one 96x60 body, found ${body.map(size)}`);
  if (arms.length !== 2 || arms.some((t) => size(t) !== '20x20'))
    errors.push(`expected two 20x20 arms, found ${arms.map(size)}`);
  if (legs.length !== 4) errors.push(`expected four legs, found ${legs.length}`);
  if (legs.some((t) => t.startsWith('<rect') && size(t) !== '11x26')) errors.push('standing legs must be 11x26');
  if (errors.length) throw new Error(`${svgPath}: ${errors.join('; ')}`);
}

function pageHtml(svgText, width, height) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{display:block;width:${width}px;height:${height}px;shape-rendering:crispEdges}
</style></head><body>${svgText}</body></html>`;
}

async function captureFrames(page, outDir, frameCount, fps) {
  // Freeze both animation engines, then seek each one per frame.
  await page.evaluate(() => {
    document.querySelector('svg').pauseAnimations();
    document.getAnimations().forEach((a) => a.pause());
  });
  for (let i = 0; i < frameCount; i++) {
    const t = i / fps;
    await page.evaluate((sec) => {
      document.querySelector('svg').setCurrentTime(sec);
      document.getAnimations().forEach((a) => {
        a.currentTime = sec * 1000;
      });
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, t);
    await page.screenshot({
      path: path.join(outDir, `frame-${String(i).padStart(3, '0')}.png`),
      omitBackground: true,
    });
  }
}

function encode(frameDir, outBase, fps) {
  const input = ['-framerate', String(fps), '-i', path.join(frameDir, 'frame-%03d.png')];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-plays', '0', `${outBase}.apng`]);
  const palette = path.join(frameDir, 'palette.png');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    ...input,
    '-vf',
    'palettegen=stats_mode=full:reserve_transparent=1',
    palette,
  ]);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    ...input,
    '-i',
    palette,
    '-lavfi',
    'paletteuse=dither=none',
    '-loop',
    '0',
    `${outBase}.gif`,
  ]);
}

async function renderOne(browser, svgPath, outDir, opts) {
  const svgText = fs.readFileSync(svgPath, 'utf8');
  checkAnatomy(svgPath, svgText);
  // A static SVG (no durations found) renders as a single frame.
  const durationMs = opts.duration || inferDurationMs(svgText) || 0;
  const { width, height } = svgSize(svgText);
  const frameCount = Math.max(1, Math.round((durationMs / 1000) * opts.fps));

  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openplead-frames-'));
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: opts.scale });
    await page.setContent(pageHtml(svgText, width, height), { waitUntil: 'load' });
    await captureFrames(page, frameDir, frameCount, opts.fps);
    const outBase = path.join(outDir, path.basename(svgPath, '.svg'));
    encode(frameDir, outBase, opts.fps);
    console.log(
      `${path.basename(svgPath)}: ${frameCount} frames @ ${opts.fps} fps, ${width * opts.scale}x${height * opts.scale} -> ${outBase}.{apng,gif}`,
    );
  } finally {
    await page.close();
    fs.rmSync(frameDir, { recursive: true, force: true });
  }
}

// One-page preview of every rendered state, on light and dark backgrounds.
function writeGallery(outDir) {
  const names = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith('.apng'))
    .map((f) => f.slice(0, -5))
    .sort();
  const cards = names
    .map(
      (n) =>
        `<figure><img src="${n}.apng" alt="${n}"><img src="${n}.gif" alt="${n} gif" class="dark"><figcaption>${n}</figcaption></figure>`,
    )
    .join('\n');
  fs.writeFileSync(
    path.join(outDir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>OpenPlead sprites</title>
<style>body{font:14px system-ui;margin:24px;display:flex;flex-wrap:wrap;gap:24px}
figure{margin:0;text-align:center}img{display:block;width:160px;image-rendering:pixelated;background:#fff;border:1px solid #ddd}
img.dark{background:#222}figcaption{margin-top:6px}</style>
${cards}
`,
  );
}

function requireFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error('ffmpeg not found on PATH (macOS: brew install ffmpeg)');
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [input, outDir] = opts.positional;
  const files = fs.statSync(input).isDirectory()
    ? fs
        .readdirSync(input)
        .filter((f) => f.endsWith('.svg'))
        .map((f) => path.join(input, f))
    : [input];
  if (files.length === 0) throw new Error(`no .svg files in ${input}`);
  requireFfmpeg();
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch();
  try {
    for (const f of files) await renderOne(browser, f, outDir, opts);
  } finally {
    await browser.close();
  }
  writeGallery(outDir);
  console.log(`gallery: ${path.join(outDir, 'index.html')}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
