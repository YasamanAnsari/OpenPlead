// @ts-check
'use strict';

// Where the pet can be touched inside its transparent window. macOS and Windows forward mouse moves through a
// click-through window, so the renderer's own hover events decide; Linux cannot, so main polls the cursor against
// these rectangles (window coordinates, matching the layout in renderer/index.html).

const WIN = { width: 280, height: 280 };
// The sprite: 160 px wide, 130 px tall, centred, 70 px above the bottom. The nameplate sits in the bottom 60 px.
const PET = { x: (WIN.width - 160) / 2, y: WIN.height - 70 - 130, width: 160, height: 130 };
const TAG = { x: 8, y: WIN.height - 60, width: WIN.width - 16, height: 52 };

const inside = (p, r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

// point and bounds in screen coordinates (Electron's getCursorScreenPoint and getBounds).
function hitTest(point, bounds, { tag = true } = {}) {
  const local = { x: point.x - bounds.x, y: point.y - bounds.y };
  if (inside(local, PET)) return 'pet';
  if (tag && inside(local, TAG)) return 'tag';
  return null;
}

module.exports = { WIN, PET, TAG, hitTest };
