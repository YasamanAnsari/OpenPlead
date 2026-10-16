'use strict';

// Parking behaviour: drops, peeks, unpark, and keeping the window inside the work area.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createParking } = require('../../src/desktop/parking');
const { parkedX, slidInX } = require('../../src/desktop/park');

const BOX = { width: 280, height: 280 };
const area = { x: 0, y: 0, width: 1728, height: 1080 };
const display = { id: 1, bounds: { ...area }, workArea: area };

function harness(initial = {}) {
  let settings = { ...initial };
  const win = {
    pos: [700, 500],
    destroyed: false,
    ignoring: null,
    getPosition() {
      return [...this.pos];
    },
    setPosition(x, y) {
      this.pos = [x, y];
    },
    getBounds() {
      return { x: this.pos[0], y: this.pos[1], ...BOX };
    },
    isDestroyed() {
      return this.destroyed;
    },
    setIgnoreMouseEvents(v) {
      this.ignoring = v;
    },
  };
  const screen = {
    getDisplayMatching: () => display,
    getDisplayNearestPoint: () => display,
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
  };
  const said = [];
  const parking = createParking({
    win: () => win,
    screen,
    settings: () => settings,
    save: (patch) => {
      settings = { ...settings, ...patch };
    },
    say: (text) => said.push(text),
    box: BOX,
    platform: 'darwin',
  });
  return { parking, win, said, settings: () => settings };
}

test('a drop at the right edge parks the window; a drop in the middle just saves the position', () => {
  const h = harness();
  h.win.pos = [1728 - 280, 500];
  h.parking.drop();
  assert.deepEqual(h.settings().parked, { side: 'right', display: 1 });
  assert.equal(h.win.pos[0], Math.round(parkedX('right', { x: 0, y: 0, ...BOX }, area)));
  h.win.pos = [600, 400];
  h.parking.drop();
  assert.equal(h.settings().parked, null);
  assert.deepEqual(h.settings().position, [600, 400]);
});

test('parked: a peek slides the window in and unpark brings it back inside', () => {
  const h = harness({ parked: { side: 'left', display: 1 } });
  h.win.pos = [parkedX('left', { x: 0, y: 0, ...BOX }, area), 500];
  h.parking.peek(50);
  assert.equal(h.win.pos[0], slidInX('left', BOX, area));
  h.parking.unpark();
  assert.equal(h.settings().parked, null);
  assert.deepEqual(h.settings().position, [0, 500]);
});

test('startPosition clamps a saved point into the work area and defaults to the bottom-right', () => {
  const far = harness({ position: [5000, -200] });
  assert.deepEqual(far.parking.startPosition(), { x: 1728 - 280, y: 0 });
  const fresh = harness();
  assert.deepEqual(fresh.parking.startPosition(), { x: 1728 - 280 - 20, y: 1080 - 280 });
  const gone = harness({ parked: { side: 'right', display: 99 } });
  gone.parking.startPosition();
  assert.equal(gone.settings().parked, null, 'a parked display that no longer exists is forgotten');
});

test('while dragging keepInside leaves the window alone; afterwards it nudges it back in', () => {
  const h = harness();
  h.win.pos = [-100, 500];
  h.parking.drag(0, 0);
  assert.equal(h.parking.isDragging(), true);
  h.parking.keepInside();
  assert.equal(h.win.pos[0], -100);
  h.parking.drop();
  h.parking.keepInside();
  assert.equal(h.win.pos[0], 0);
});
