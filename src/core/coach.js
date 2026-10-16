// @ts-check
'use strict';

// The pet explains itself the first time each thing happens, in one line, once. The flags live in the settings.
const LINES = {
  working: (agent) => `${agent} is working. Click me to plead.`,
  queued: (agent, soon) =>
    soon === 'next message'
      ? `That line goes with your next message to ${agent}.`
      : `That line goes to ${agent} with its next tool call.`,
  sent: (agent) => `Sent: ${agent} has it now.`,
  thanks: () => 'Turn done. I will thank it with your next message; that is a setting.',
  panic: () => 'Two failures in a row: I sent a calm line, never a plea.',
};

// The line to show for this moment, or null once it has been shown.
function coaching(settings, moment, agent, detail) {
  if ((settings.coached || {})[moment]) return null;
  const line = LINES[moment];
  return line ? line(agent, detail) : null;
}

const coached = (settings, moment) => ({ coached: { ...(settings.coached || {}), [moment]: true } });

module.exports = { MOMENTS: Object.keys(LINES), coaching, coached };
