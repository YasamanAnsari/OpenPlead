// @ts-check
'use strict';

const pet = /** @type {HTMLImageElement} */ (document.getElementById('pet'));
const bubble = document.getElementById('bubble');
const bubbleText = bubble.querySelector('.text');
const tag = document.getElementById('tag');
const tagLine1 = tag.querySelector('.t1');
const tagLine2 = tag.querySelector('.l2');
let bubbleTimer = null;
let currentMood = '';

const SPRITE = { idle: 'grovel-base' };

window.openplead.onView(({ mood, tag: t = { line1: '', line2: '', phrase: '', dot: 'off', queue: '' }, spriteDir }) => {
  if (mood !== currentMood) {
    currentMood = mood;
    // A fresh query string restarts the APNG from frame 0 when the same mood repeats.
    pet.src = `${spriteDir}/${SPRITE[mood] || mood}.apng?${Date.now()}`;
  }
  // Nameplate: shown while an agent session is alive; the second line carries the queue state.
  tagLine1.textContent = t.line1;
  tagLine2.textContent = t.line2;
  if (t.level) {
    const ladder = document.createElement('span');
    ladder.className = 'ladder';
    for (let i = 1; i <= t.max; i += 1) {
      const dot = document.createElement('i');
      if (i <= t.level) dot.className = 'on';
      ladder.append(dot);
    }
    tagLine2.append(' ', ladder);
  }
  tag.className = [t.line1 ? 'show' : '', t.line2 ? 'has2' : '', t.dot, t.queue].filter(Boolean).join(' ');
  for (const p of pupils) p.classList.toggle('show', mood === 'idle');
});

// Idle eyes: main sends the cursor direction as a unit-box offset; pupils move up to 3 px across, 2 px down.
const pupils = [document.getElementById('pupilL'), document.getElementById('pupilR')];
window.openplead.onEyes(({ dx, dy }) => {
  for (const p of pupils) p.style.transform = `translate(${Math.round(dx * 3)}px, ${Math.round(dy * 2)}px)`;
});

// Two kinds of bubble: a sticky one holding the queued words until they go out, and transient ones that show
// for `ms` and then give the sticky one back.
let sticky = '';
function showBubble(text, queued) {
  bubbleText.textContent = text;
  bubble.classList.toggle('queued', queued);
  bubble.classList.add('show');
}
function hideBubble() {
  bubble.classList.remove('show', 'queued');
}
window.openplead.onBubble(({ text, ms, sticky: isSticky }) => {
  if (isSticky) {
    sticky = text;
    if (!bubbleTimer) sticky ? showBubble(sticky, true) : hideBubble();
    return;
  }
  clearTimeout(bubbleTimer);
  showBubble(text, false);
  bubbleTimer = setTimeout(() => {
    bubbleTimer = null;
    if (sticky) showBubble(sticky, true);
    else hideBubble();
  }, ms);
});

// Sounds: short oscillator envelopes, no audio files. Each entry is [waveform, [[freqHz, startS, lengthS], ...]].
// The thank chime's top note rises a semitone per thank in this run, up to an octave.
const SOUNDS = {
  chime: [
    'sine',
    [
      [660, 0, 0.12],
      [880, 0.12, 0.25],
    ],
  ],
  sob: [
    'triangle',
    [
      [440, 0, 0.18],
      [370, 0.18, 0.18],
      [294, 0.36, 0.35],
    ],
  ],
  alarm: [
    'square',
    [
      [880, 0, 0.07],
      [880, 0.14, 0.07],
    ],
  ],
  cheer: [
    'sine',
    [
      [523, 0, 0.1],
      [659, 0.1, 0.1],
      [784, 0.2, 0.3],
    ],
  ],
  bye: [
    'sine',
    [
      [660, 0, 0.15],
      [494, 0.15, 0.3],
    ],
  ],
  startle: ['square', [[1320, 0, 0.06]]],
};
let audio = null;
window.openplead.onSound(({ name, thanks = 0 }) => {
  const spec = SOUNDS[name];
  if (!spec) return;
  audio = audio || new AudioContext();
  const [wave, notes] = spec;
  const rise = name === 'chime' ? 2 ** (Math.min(thanks, 12) / 12) : 1;
  for (const [freq, at, len] of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = wave;
    osc.frequency.value = freq * (freq === 880 && name === 'chime' ? rise : 1);
    const t0 = audio.currentTime + at;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + len + 0.02);
  }
});

// The window is click-through except while the pointer is over the sprite or the nameplate.
for (const el of [pet, tag]) {
  el.addEventListener('mouseenter', () => window.openplead.hover(true));
  el.addEventListener('mouseleave', () => window.openplead.hover(false));
}
// A click on the nameplate brings the agent's app forward.
tag.addEventListener('click', () => window.openplead.focusAgent());

// Press and move more than DRAG_PX moves the window; a press without movement is a click.
const DRAG_PX = 4;
let drag = null; // { x, y, moved } in screen coordinates
pet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.screenX, y: e.screenY, moved: false };
  pet.setPointerCapture(e.pointerId);
});
pet.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.x;
  const dy = e.screenY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
  drag = { x: e.screenX, y: e.screenY, moved: true };
  window.openplead.move(dx, dy);
});
pet.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  pet.releasePointerCapture(e.pointerId);
  if (moved) window.openplead.moveEnd();
  else window.openplead.click();
});
pet.addEventListener('pointercancel', () => {
  drag = null;
});
pet.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.openplead.contextMenu();
});
