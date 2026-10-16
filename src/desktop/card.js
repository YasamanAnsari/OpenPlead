// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Renders a reply card (src/renderer/card.html) in an off-screen window and resolves to a PNG buffer. The window is
// never shown; the page takes its text from the query string and sets it as text, so nothing in a reply can run.
const WIDTH = 1200;
const HEIGHT = 675;
const SETTLE_MS = 400; // fonts and the sprite's first frame
const DEADLINE_MS = 10_000;

// The sprite that said the line: the plea's own level, the thank-you pose, else the mid-ladder pose.
function spriteFor(kind, level) {
  if (kind === 'thanks') return 'thank.apng';
  return `plead-${level >= 1 && level <= 5 ? level : 2}.apng`;
}

function renderCard({ BrowserWindow, plea, reply, agent, label = '', kind = '', level = 0, when = '', spriteDir }) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      webPreferences: { offscreen: true, contextIsolation: true, sandbox: true },
    });
    let settled = false;
    const done = (err, png) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (!win.isDestroyed()) win.destroy();
      if (err) reject(err);
      else resolve(png);
    };
    const deadline = setTimeout(() => done(new Error('the card did not render in time')), DEADLINE_MS);
    const alive = () => !settled && !win.isDestroyed();
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!alive()) return;
        win.webContents.invalidate(); // an off-screen window paints on demand: ask for a full frame before reading it
        setTimeout(() => {
          if (!alive()) return;
          win.webContents
            .capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT })
            .then((image) => done(null, image.toPNG()))
            .catch(done);
        }, SETTLE_MS);
      }, SETTLE_MS);
    });
    win.webContents.once('did-fail-load', (_e, code, desc) =>
      done(new Error(`card page failed to load: ${desc} (${code})`)),
    );
    const query = {
      plea,
      reply,
      agent,
      label,
      when,
      sprite: pathToFileURL(path.join(spriteDir, spriteFor(kind, level))).href,
    };
    win.loadFile(path.join(__dirname, '..', 'renderer', 'card.html'), { query }).catch(done);
  });
}

// A logged reply as a PNG in `dir`, named by its local time. Resolves to the file path.
async function saveCard({
  BrowserWindow,
  entry,
  agent,
  label,
  dir,
  spriteDir,
  render = renderCard,
  writeFile = fs.writeFileSync,
}) {
  const when = new Date(entry.at);
  const png = await render({
    BrowserWindow,
    plea: entry.plea,
    reply: entry.reply,
    agent,
    label,
    kind: entry.kind,
    level: entry.level,
    when: when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    spriteDir,
  });
  const stamp = when.toLocaleString('sv-SE').slice(0, 19).replace(/:/g, '.'); // 2026-10-15 09.05.42
  let file = path.join(dir, `OpenPlead reply ${stamp}.png`);
  for (let n = 2; fs.existsSync(file); n += 1) file = path.join(dir, `OpenPlead reply ${stamp} (${n}).png`);
  writeFile(file, png);
  return file;
}

module.exports = { saveCard, spriteFor, WIDTH, HEIGHT };
