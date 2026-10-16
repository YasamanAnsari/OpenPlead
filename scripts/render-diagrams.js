#!/usr/bin/env node
// Exports the README diagrams. The sources are hand-written SVG in docs/diagrams/*.html; this screenshots each
// <svg> at 2x with a transparent background so the PNGs in docs/media/ never drift from the sources.
//
//   node scripts/render-diagrams.js          writes docs/media/<name>.png for every docs/diagrams/<name>.html

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'diagrams');
const OUT = path.join(ROOT, 'docs', 'media');

async function main() {
  const sources = fs.readdirSync(SRC).filter((f) => f.endsWith('.html'));
  if (sources.length === 0) throw new Error(`no diagram sources in ${SRC}`);
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    for (const file of sources) {
      await page.goto(pathToFileURL(path.join(SRC, file)).href, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      const svg = await page.$('svg');
      if (!svg) throw new Error(`${file} has no <svg>`);
      const out = path.join(OUT, file.replace(/\.html$/, '.png'));
      await svg.screenshot({ path: out, omitBackground: true });
      console.log(`wrote ${path.relative(ROOT, out)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
