// @ts-check
'use strict';

// Mute: no sounds and no chatter, only outcomes. quietUntil in the settings is a time, 0 for off, -1 for
// "until I turn it off".

const isQuiet = ({ quietUntil = 0 } = {}, now = Date.now()) => quietUntil === -1 || quietUntil > now;

const quietUntil = (minutes, now = Date.now()) => (minutes === -1 ? -1 : minutes > 0 ? now + minutes * 60_000 : 0);

function quietLabel(settings, now = Date.now()) {
  if (!isQuiet(settings, now)) return '';
  if (settings.quietUntil === -1) return 'Muted until turned off';
  const at = new Date(settings.quietUntil);
  return `Muted until ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
}

module.exports = { isQuiet, quietUntil, quietLabel };
