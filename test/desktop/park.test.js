'use strict';

// Parking geometry: screen edges, the sliver that stays visible, displays that join.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EDGE, PEEK, edgeFor, parkedX, slidInX, touchesAnother } = require('../../src/desktop/park');

const area = { x: 0, y: 0, width: 1728, height: 1080 };
const WIN = { width: 280, height: 280 };

test('dropping the pet near an edge parks it; anywhere else does not', () => {
  assert.equal(edgeFor({ x: 1728 - 280 - EDGE + 1, y: 500, ...WIN }, area), 'right');
  assert.equal(edgeFor({ x: EDGE - 1, y: 500, ...WIN }, area), 'left');
  assert.equal(edgeFor({ x: 700, y: 500, ...WIN }, area), null);
  const second = { x: 1728, y: 0, width: 1920, height: 1080 };
  assert.equal(edgeFor({ x: 1728 + 1920 - 280, y: 10, ...WIN }, second), 'right', 'relative to its own display');
});

test('parked, only a sliver of the sprite shows; slid in, the whole window is inside the work area', () => {
  const bounds = { x: 0, y: 0, ...WIN };
  const margin = (WIN.width - 160) / 2;
  const right = parkedX('right', bounds, area);
  assert.equal(right + margin, area.width - PEEK, "right edge: the sprite's left PEEK px are on screen");
  const left = parkedX('left', bounds, area);
  assert.equal(left + WIN.width - margin, PEEK, "left edge: the sprite's right PEEK px are on screen");
  assert.equal(slidInX('right', WIN, area), area.width - WIN.width);
  assert.equal(slidInX('left', WIN, area), 0);
});

test('an edge that joins another display is not a screen edge; outer edges and offset displays are', () => {
  const main = { id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1080 } };
  const right = { id: 2, bounds: { x: 1728, y: 0, width: 1920, height: 1080 } };
  const above = { id: 3, bounds: { x: 0, y: -1080, width: 1728, height: 1080 } };
  assert.ok(touchesAnother('right', main, [main, right]), 'the right edge of the main display runs into the second');
  assert.ok(touchesAnother('left', right, [main, right]));
  assert.ok(!touchesAnother('left', main, [main, right]), 'the outer edge is free');
  assert.ok(!touchesAnother('right', right, [main, right]));
  assert.ok(!touchesAnother('right', main, [main, above]), 'a display above does not touch the side edges');
  assert.ok(!touchesAnother('right', main, [main]), 'one display: both edges are free');
});
