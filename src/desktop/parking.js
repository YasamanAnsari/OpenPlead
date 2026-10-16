// @ts-check
'use strict';

// Where the pet window sits, and mini mode. Parked, the window rests mostly off-screen at an edge of the display it
// was parked on; hovering the sliver, an outcome bubble or queued words slide it in, and it slides back once the
// pointer has left and the moment has passed. Dragging it away from the edge unparks it. An edge shared with another
// display cannot be parked at: "off-screen" there is just the other monitor. The geometry is in park.js; this holds
// the timers and the drag.

const park = require('./park');

const PEEK_MS = 4000;
const HOVER_PEEK_MS = 800;
const DRAG_SILENCE_MS = 2000; // a drag sends moves continuously; this long without one means it is over
const SETTLE_MIN_MS = 50;
const START_MARGIN = 20;

function createParking({ win, screen, settings, save, say, box, platform = process.platform }) {
  let peeking = false;
  let peekTimer = null;
  let peekUntil = 0;
  let hovering = false;
  let dragging = false;
  let dragTimer = null;

  const windowBox = () => ({ ...box, x: 0, y: 0 });
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  // The display the user is on: the pet's, else the one under the pointer. Everything that appears fresh appears there.
  function userDisplay() {
    const w = win();
    return w && !w.isDestroyed()
      ? screen.getDisplayMatching(w.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  function parkedArea() {
    const id = settings().parked && settings().parked.display;
    const display = screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
    return display.workArea;
  }

  // Nudges the window back inside the work area of its display; a no-op while it is fully on screen or being dragged.
  function keepInside() {
    const w = win();
    if (!w || dragging) return;
    const [x, y] = w.getPosition();
    const a = screen.getDisplayMatching({ x, y, ...box }).workArea;
    const inside = Math.min(Math.max(x, a.x), a.x + a.width - box.width);
    if (inside !== x) w.setPosition(Math.round(inside), y);
  }

  function parkAt(side) {
    const w = win();
    if (!w) return;
    const [x, y] = w.getPosition();
    const display = screen.getDisplayMatching({ x, y, ...box });
    if (park.touchesAnother(side, display, screen.getAllDisplays())) {
      if (settings().parked) leaveEdge(); // dragged from the old edge to a refused one: an ordinary drop
      save({ position: [x, y] });
      say('That edge joins another display; park him at an outer edge.', 5000, 2);
      return;
    }
    save({ parked: { side, display: display.id } });
    w.setPosition(Math.round(park.parkedX(side, windowBox(), display.workArea)), y);
    save({ position: w.getPosition() });
    peeking = false;
  }

  function scheduleSettle() {
    clearTimeout(peekTimer);
    peekTimer = setTimeout(settle, Math.max(SETTLE_MIN_MS, peekUntil - Date.now()));
  }

  function settle() {
    const w = win();
    const parked = settings().parked;
    if (!w || !parked || !peeking) return;
    if (hovering || dragging || Date.now() < peekUntil) {
      scheduleSettle();
      return;
    }
    peeking = false;
    w.setPosition(Math.round(park.parkedX(parked.side, windowBox(), parkedArea())), w.getPosition()[1]);
    // The window moved out from under the pointer, so no mouseleave will come (Linux: the hit poll notices on its own).
    if (platform !== 'linux') w.setIgnoreMouseEvents(true, { forward: true });
  }

  function peek(ms = PEEK_MS) {
    const w = win();
    const parked = settings().parked;
    if (!w || !parked) return;
    peekUntil = Math.max(peekUntil, Date.now() + ms);
    if (!peeking) {
      peeking = true;
      w.setPosition(Math.round(park.slidInX(parked.side, box, parkedArea())), w.getPosition()[1]);
    }
    scheduleSettle();
  }

  function leaveEdge() {
    clearTimeout(peekTimer);
    peeking = false;
    save({ parked: null });
  }

  // From the menu: the window comes back inside the display it was parked on. (A drag away from the edge calls
  // leaveEdge instead and keeps the drop point.)
  function unpark() {
    const w = win();
    const parked = settings().parked;
    if (!w || !parked) {
      leaveEdge();
      return;
    }
    const x = Math.round(park.slidInX(parked.side, box, parkedArea()));
    leaveEdge();
    w.setPosition(x, w.getPosition()[1]);
    save({ position: w.getPosition() });
  }

  // The saved position, nudged back inside its display's work area (the window grew, the Dock moved), or the
  // bottom-right of the user's display. A parked pet comes back parked, on the display it was parked on.
  function startPosition() {
    const s = settings();
    const saved = s.position;
    const point = Array.isArray(saved) && saved.length === 2 && saved.every(Number.isFinite) ? saved : null;
    if (s.parked && s.parked.side) {
      const display = screen.getAllDisplays().find((d) => d.id === s.parked.display);
      if (display) {
        const a = display.workArea;
        const y = clamp(point ? point[1] : a.y + a.height - box.height, a.y, a.y + a.height - box.height);
        return { x: Math.round(park.parkedX(s.parked.side, windowBox(), a)), y };
      }
      save({ parked: null }); // that display is gone (before the window exists, so nothing moves)
    }
    if (point) {
      const { workArea: a } = screen.getDisplayMatching({ x: point[0], y: point[1], ...box });
      return {
        x: clamp(point[0], a.x, a.x + a.width - box.width),
        y: clamp(point[1], a.y, a.y + a.height - box.height),
      };
    }
    const area = userDisplay().workArea;
    return { x: area.x + area.width - box.width - START_MARGIN, y: area.y + area.height - box.height };
  }

  function resetPosition() {
    unpark();
    save({ position: null });
    const w = win();
    if (w) {
      const { x, y } = startPosition();
      w.setPosition(x, y);
    }
  }

  // Pointer over the pet (from the renderer). Returns nothing; the caller decides about mouse pass-through.
  function hover(over) {
    hovering = Boolean(over);
    if (!settings().parked) return;
    if (over) peek(HOVER_PEEK_MS);
    else {
      peekUntil = Math.max(peekUntil, Date.now() + HOVER_PEEK_MS);
      scheduleSettle();
    }
  }

  function drag(dx, dy) {
    const w = win();
    if (!w || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    dragging = true;
    clearTimeout(peekTimer);
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => {
      dragging = false;
      if (settings().parked) scheduleSettle();
    }, DRAG_SILENCE_MS);
    const [x, y] = w.getPosition();
    w.setPosition(Math.round(x + dx), Math.round(y + dy));
  }

  // The drop: at an edge it parks, elsewhere it stays where it was dropped.
  function drop() {
    dragging = false;
    clearTimeout(dragTimer);
    const w = win();
    if (!w) return;
    const [x, y] = w.getPosition();
    const side = park.edgeFor({ x, y, ...box }, screen.getDisplayMatching({ x, y, ...box }).workArea);
    if (side) {
      parkAt(side);
      return;
    }
    if (settings().parked) leaveEdge();
    save({ position: [x, y] });
  }

  return {
    userDisplay,
    keepInside,
    peek,
    unpark,
    resetPosition,
    startPosition,
    hover,
    drag,
    drop,
    isDragging: () => dragging,
  };
}

module.exports = { createParking };
