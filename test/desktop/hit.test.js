'use strict';

// Which parts of the pet window take the pointer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { hitTest, PET, TAG, WIN } = require('../../src/desktop/hit');

test('the pet and the nameplate are the only touchable areas of the window', () => {
  const bounds = { x: 1000, y: 500, width: WIN.width, height: WIN.height };
  const at = (x, y) => hitTest({ x: bounds.x + x, y: bounds.y + y }, bounds);
  assert.equal(at(PET.x + 10, PET.y + 10), 'pet');
  assert.equal(at(PET.x + PET.width - 1, PET.y + PET.height - 1), 'pet');
  assert.equal(at(TAG.x + 5, TAG.y + 5), 'tag');
  assert.equal(
    hitTest({ x: bounds.x + TAG.x + 5, y: bounds.y + TAG.y + 5 }, bounds, { tag: false }),
    null,
    'no nameplate shown: click-through',
  );
  assert.equal(at(5, 5), null, 'the bubble corner is click-through');
  assert.equal(at(PET.x - 1, PET.y + 10), null);
  assert.equal(at(WIN.width + 10, 10), null, 'outside the window');
});
