// @ts-check
'use strict';

const { fillSentPhrase, MAX_LEVEL } = require('../core/state');
const { labelOf } = require('../core/tag');
const { agentName, shortName } = require('../core/apps');

// Performs the reducer's effects: what each one shows, plays, records, or turns into the reply the agent receives.
// perform() returns only what main must keep, { state?, outcome?, reply? }, so this file owns nothing.

//   say(text, ms, priority), sound(name)   the pet's voice
//   phrases, replies                        src/core/phrases and src/core/replies
//   inviteReply()                           the setting, live
//   log, report
function createEffects({ say, sound, phrases, replies, inviteReply, log, report }) {
  function perform(effect, { state, input }) {
    switch (effect.type) {
      case 'bubble':
        say(effect.text, effect.ms, effect.priority);
        return {};
      case 'sound':
        sound(effect.name);
        return {};
      case 'queued': {
        const item = state.pending || state.nextPrompt;
        if (!(item && item.phrase)) {
          const where = effect.soon === 'next message' ? 'saved for your next message' : 'queued';
          say(`Plea ${effect.level} of ${MAX_LEVEL} ${where}`, 4000);
        }
        return {};
      }
      case 'dropped':
        if (effect.reason === 'expired') say('Dropped after 2 min: nothing to attach it to', 5000, 2);
        return {
          outcome: { kind: 'dropped', text: `Dropped · ${labelOf(effect)} · ${effect.reason}`, phrase: effect.phrase },
        };
      case 'reply-seen':
        say(`${agentName(effect.agent)}: “${effect.reply}”`, undefined, 2);
        try {
          replies.record({
            at: Date.now(),
            agent: effect.agent,
            kind: effect.kind,
            level: effect.level,
            plea: effect.plea,
            reply: effect.reply,
          });
        } catch (err) {
          report('keeping the reply', err);
        }
        log(`reply from ${effect.agent} (${effect.reply.length} chars)`); // the words stay out of the log
        return {
          outcome: {
            kind: 'reply',
            text: `${shortName(effect.agent)} replied · right-click for the card`,
            phrase: effect.reply,
          },
        };
      case 'reply':
        try {
          const reply = {
            ...effect,
            ...phrases.render(phrases.load(), effect.kind, effect.level, effect.phrase, { invite: inviteReply() }),
          };
          const next = input.type === 'hook' ? fillSentPhrase(state, input.event.sessionId, reply.phrase) : state;
          return { reply, state: next };
        } catch (err) {
          report('rendering the line', err); // a broken phrases.json: the bubble says what is wrong
          say(err.message, 8000, 2);
          return {};
        }
      default:
        return {};
    }
  }
  return { perform };
}

module.exports = { createEffects };
