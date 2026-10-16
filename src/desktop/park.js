// @ts-check
'use strict';

// Mini mode: drop Grovel at the left or right edge of the screen and he parks there, mostly off-screen, with a sliver
// showing; hover and he slides in, leave and he slides back. Pure geometry; main moves the window.

const EDGE = 16; // dropped this close to an edge counts as parking
const PEEK = 44; // how much of the sprite stays on screen while parked
const SPRITE = 160; // sprite width inside the transparent window

// 'left', 'right' or null for a window just dropped at bounds inside the display's work area.
function edgeFor(bounds, area) {
  if (bounds.x + bounds.width >= area.x + area.width - EDGE) return 'right';
  if (bounds.x <= area.x + EDGE) return 'left';
  return null;
}

// Window x when parked at that side (the sprite's edge peeks in) and when slid fully in.
function parkedX(side, bounds, area) {
  const margin = (bounds.width - SPRITE) / 2; // transparent space either side of the sprite
  return side === 'right' ? area.x + area.width - margin - PEEK : area.x - bounds.width + margin + PEEK;
}

function slidInX(side, bounds, area) {
  return side === 'right' ? area.x + area.width - bounds.width : area.x;
}

// True when another display sits right beyond that edge of this one (then "off-screen" is just that display).
function touchesAnother(side, display, displays) {
  const a = display.bounds;
  return displays.some((d) => {
    if (d.id === display.id) return false;
    const b = d.bounds;
    const overlapsVertically = b.y < a.y + a.height && b.y + b.height > a.y;
    if (!overlapsVertically) return false;
    return side === 'right' ? Math.abs(b.x - (a.x + a.width)) <= 1 : Math.abs(b.x + b.width - a.x) <= 1;
  });
}

module.exports = { EDGE, PEEK, edgeFor, parkedX, slidInX, touchesAnother };
