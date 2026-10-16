'use strict';

// The pet window: how it is created, how it moves between desktops, and how the renderer's messages are routed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PET } = require('../../src/desktop/channels');
const { createPetWindow } = require('../../src/desktop/pet-window');

class FakeWindow {
  constructor(options) {
    this.options = options;
    this.calls = [];
    this.handlers = {};
    this.webContents = {
      on: (ev, cb) => (this.handlers[`wc:${ev}`] = cb),
      send: (ch, p) => this.calls.push(['send', ch, p]),
    };
    this.visible = false;
  }
  setVisibleOnAllWorkspaces(flag, opts) {
    this.calls.push(['workspaces', flag, opts]);
  }
  setIgnoreMouseEvents(flag, opts) {
    this.calls.push(['ignore', flag, opts]);
  }
  loadFile(file) {
    this.calls.push(['load', file]);
  }
  on(ev, cb) {
    this.handlers[ev] = cb;
  }
  isVisible() {
    return this.visible;
  }
  showInactive() {
    this.visible = true;
    this.calls.push(['show']);
  }
}

function harness(settings = { followDesktops: false }) {
  let loaded = 0;
  let created = null;
  const pet = createPetWindow({
    BrowserWindow: class extends FakeWindow {
      constructor(o) {
        super(o);
        created = this;
      }
    },
    box: { width: 280, height: 280 },
    preload: '/preload.js',
    html: '/index.html',
    parking: { startPosition: () => ({ x: 10, y: 20 }) },
    settings: () => settings,
    onLoaded: () => (loaded += 1),
  });
  return {
    pet,
    get win() {
      return created;
    },
    loaded: () => loaded,
  };
}

test('the window is transparent, on top, click-through and placed by the parking module', () => {
  const h = harness();
  h.pet.create();
  const o = h.win.options;
  assert.deepEqual([o.width, o.height, o.x, o.y], [280, 280, 10, 20]);
  assert.deepEqual(
    [o.transparent, o.alwaysOnTop, o.frame, o.focusable, o.skipTaskbar],
    [true, true, false, false, true],
  );
  assert.deepEqual(o.webPreferences, { preload: '/preload.js', contextIsolation: true, sandbox: false });
  assert.deepEqual(h.win.calls.slice(0, 3), [
    ['workspaces', false, { visibleOnFullScreen: true }],
    ['ignore', true, { forward: true }],
    ['load', '/index.html'],
  ]);
  h.win.handlers['wc:did-finish-load']();
  assert.equal(h.loaded(), 1);
  h.pet.send('view', { a: 1 });
  assert.deepEqual(h.win.calls.at(-1), ['send', 'view', { a: 1 }]);
  assert.equal(h.pet.visible(), false);
  h.win.handlers.closed();
  assert.equal(h.pet.win, null);
  assert.equal(h.pet.send('view', {}), null, 'no window: nothing sent');
});

test('showing on the current desktop goes through all workspaces unless the pet follows the user anyway', () => {
  const stay = harness({ followDesktops: false });
  stay.pet.create();
  stay.win.calls.length = 0;
  stay.pet.showOnCurrentDesktop();
  assert.deepEqual(
    stay.win.calls.map((c) => c[0]),
    ['workspaces', 'show', 'workspaces'],
  );
  const follow = harness({ followDesktops: true });
  follow.pet.create();
  follow.win.calls.length = 0;
  follow.pet.showOnCurrentDesktop();
  assert.deepEqual(
    follow.win.calls.map((c) => c[0]),
    ['show'],
  );
});

test('the renderer messages are bound to their handlers', () => {
  const h = harness();
  h.pet.create();
  const handlers = {};
  const log = [];
  h.pet.bind({
    ipcMain: { on: (ch, cb) => (handlers[ch] = cb) },
    hover: (over) => log.push(['hover', over]),
    click: () => log.push(['click']),
    move: (dx, dy) => log.push(['move', dx, dy]),
    moveEnd: () => log.push(['move-end']),
    contextMenu: () => ({ popup: (o) => log.push(['popup', o.window === h.win]) }),
    focusAgent: () => log.push(['focus']),
  });
  assert.deepEqual(
    Object.keys(handlers).sort(),
    [PET.CLICK, PET.CONTEXT_MENU, PET.FOCUS_AGENT, PET.HOVER, PET.MOVE, PET.MOVE_END].sort(),
  );
  handlers[PET.HOVER]({}, true);
  handlers[PET.CLICK]({});
  handlers[PET.MOVE]({}, 3, 4);
  handlers[PET.MOVE_END]({});
  handlers[PET.CONTEXT_MENU]({});
  handlers[PET.FOCUS_AGENT]({});
  assert.deepEqual(log, [['hover', true], ['click'], ['move', 3, 4], ['move-end'], ['popup', true], ['focus']]);
  if (process.platform !== 'linux')
    assert.deepEqual(
      h.win.calls.at(-1),
      ['ignore', false, { forward: true }],
      'the pointer over the pet makes it clickable',
    );
});
