// @ts-check
'use strict';

// Fills the reply card from its query string. Everything is set as text, never as markup.
const q = new URLSearchParams(location.search);
const set = (id, text) => {
  document.getElementById(id).textContent = text;
};
set('plea', q.get('plea') || '');
set('reply', `“${q.get('reply') || ''}”`);
set('agent', `${q.get('agent') || 'The agent'} replied`);
set('label', q.get('label') || '');
set('when', q.get('when') || '');
// The sprite's frame is drawn onto a canvas: an off-screen window may never paint an animated image, a canvas it does.
const sprite = q.get('sprite');
if (sprite) {
  const img = new Image();
  img.onload = () => {
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('pet'));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    document.title = 'drawn';
  };
  img.src = sprite;
}
// Long lines shrink so both quotes stay on the card.
const fit = (id, sizes) => {
  const el = document.getElementById(id);
  const len = el.textContent.length;
  el.style.fontSize = `${len > 150 ? sizes[2] : len > 90 ? sizes[1] : sizes[0]}px`;
};
fit('plea', [40, 32, 26]);
fit('reply', [30, 26, 22]);
