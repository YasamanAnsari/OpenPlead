// @ts-check
'use strict';

// The hook half of the reducer: one handler per hook kind, each working on a ctx ({ next, sess, effects, event, id,
// now }) and free to replace ctx.next; put() changes the event's session inside it. onHook wraps them with what every
// kind does: the session's lastSeen, the active session, and the record of what went out.

const {
  sessionCount,
  clearFor,
  transient,
  freshSession,
  resetLadder,
  abort,
  mostRecent,
  deliverNextPrompt,
  deliverPending,
  fresh,
  queue,
  withPhrase,
  dropped,
  addressed,
  deliverQueued,
  follows,
  answerIn,
  PANIC_STREAK,
  DUPLICATE_TURN_MS,
  TRANSIENT_MS,
  SUSPICIOUS_FAILURES,
} = require('./state-shared');

/** @typedef {import('./types').State} State */
/** @typedef {import('./types').HookEvent} HookEvent */
/** @typedef {import('./types').Outcome} Outcome */

// One handler per hook kind. Each works on `ctx` ({ next, sess, effects, event, id, now }) and may replace
// ctx.next; put() changes the event's session inside it.
function put(ctx, patch) {
  ctx.sess = { ...ctx.sess, ...patch };
  ctx.next = { ...ctx.next, sessions: { ...ctx.next.sessions, [ctx.id]: ctx.sess } };
}

function onTurnStart(ctx) {
  const { event, id, now, effects } = ctx;
  if (ctx.sess.turnActive && now - ctx.sess.turnSince < DUPLICATE_TURN_MS) return; // the same prompt, reported twice
  if (ctx.sess.turnActive) {
    ctx.next = abort(ctx.next, now, effects, id);
    ctx.sess = ctx.next.sessions[id];
  }
  put(ctx, {
    turnActive: true,
    turnSince: now,
    errorStreak: 0,
    failedCommands: [],
    turnFailures: 0,
    thinkingSent: false,
    sent: [],
  });
  // Agents that cannot attach text to a prompt (event.injects === false) get it with the turn's first
  // tool result instead; the TTL restarts from this prompt.
  if (fresh(ctx.next.nextPrompt, now) && addressed(ctx.next.nextPrompt, id)) {
    ctx.next =
      event.injects === false
        ? { ...ctx.next, nextPrompt: { ...ctx.next.nextPrompt, at: now } }
        : deliverNextPrompt(ctx.next, effects);
  }
  ctx.next = { ...ctx.next, permissionWait: false };
}

function onAssistantText(ctx) {
  const found = answerIn(ctx.event.text, ctx.sess);
  if (!found) return;
  ctx.effects.push(found.effect);
  put(ctx, { sent: found.sent });
  ctx.next = { ...ctx.next, transient: transient('thank', ctx.now) }; // answered: a bow
}

function onToolStart(ctx) {
  put(ctx, { turnActive: true });
  if (ctx.event.injects !== false) ctx.next = deliverQueued(ctx.next, ctx.now, ctx.effects, ctx.id);
  ctx.next = { ...ctx.next, permissionWait: false };
}

function onToolOk(ctx) {
  const { event, now, effects } = ctx;
  const hadFailed = ctx.sess.failedCommands.includes(event.command);
  put(ctx, {
    turnActive: true,
    errorStreak: 0,
    failedCommands: ctx.sess.failedCommands.filter((c) => c !== event.command),
  });
  if (hadFailed) {
    ctx.next = { ...ctx.next, transient: transient('joy-cry', now) };
    effects.push({ type: 'sound', name: 'cheer' });
  }
  if (event.injects !== false) ctx.next = deliverQueued(ctx.next, now, effects, ctx.id);
  ctx.next = { ...ctx.next, permissionWait: false };
}

function onToolFail(ctx) {
  const { event, now, effects } = ctx;
  if (event.isInterrupt) {
    ctx.next = abort(ctx.next, now, effects, ctx.id);
    return;
  }
  const errorStreak = ctx.sess.errorStreak + 1;
  put(ctx, {
    turnActive: true,
    errorStreak,
    turnFailures: ctx.sess.turnFailures + 1,
    failedCommands: ctx.sess.failedCommands.includes(event.command)
      ? ctx.sess.failedCommands
      : [...ctx.sess.failedCommands, event.command],
  });
  if (errorStreak === PANIC_STREAK) {
    effects.push({ type: 'reply', kind: 'calm', level: 0 }, { type: 'sound', name: 'alarm' });
    ctx.next = { ...ctx.next, stats: { ...ctx.next.stats, panics: ctx.next.stats.panics + 1 } };
  }
  ctx.next = { ...ctx.next, permissionWait: false };
}

function onPermissionWait(ctx) {
  ctx.next = { ...ctx.next, permissionWait: true };
}

function onTurnEnd(ctx) {
  const { event, id, now, effects } = ctx;
  if (event.status === 'aborted') {
    ctx.next = abort(ctx.next, now, effects, id);
    return;
  }
  const suspicious = ctx.sess.turnFailures >= SUSPICIOUS_FAILURES;
  // The reply, if the turn's final text answers a line that went out earlier in the turn (never one sent now).
  // Then the slate is wiped: a second Stop (Claude continuing after a block) answers only what went out with it.
  const found = answerIn(event.lastMessage, ctx.sess);
  if (found) effects.push(found.effect);
  put(ctx, { turnActive: false, errorStreak: 0, failedCommands: [], turnFailures: 0, sent: [] });
  let next = ctx.next;
  // Only what is addressed to this session: a plea clicked for another conversation waits for that one.
  const mine = (item) => Boolean(item) && addressed(item, id);
  const carried = fresh(next.pending, now) && mine(next.pending) ? next.pending.level : 0;
  // A line another session is waiting for is never replaced by this turn's thanks or carried plea.
  const foreign = next.nextPrompt && !mine(next.nextPrompt);
  const carriedPhrase = carried ? next.pending.phrase : undefined;
  const carryOver = (n) => queue(n, now, withPhrase({ kind: 'plea', level: carried }, carriedPhrase), id);
  if (event.status === 'error') {
    next = {
      ...next,
      panicUntil: now + TRANSIENT_MS.panic,
      permissionWait: false,
      stats: { ...next.stats, panics: next.stats.panics + 1 },
    };
    effects.push({ type: 'sound', name: 'alarm' });
    if (carried && !foreign) next = { ...next, pending: null, nextPrompt: carryOver(next) };
    ctx.next = next;
    return;
  }
  // A plea clicked after the turn's last tool call: agents whose stop hook can carry text get it now
  // (the agent keeps working on it); otherwise it goes with the next prompt, replacing the thanks.
  if (carried && event.injects !== false) {
    next = deliverPending(next, effects);
    ctx.next = { ...clearFor(next, id), permissionWait: false };
    return;
  }
  const keepPending = carried && foreign; // nowhere to carry it: it waits, and expires visibly if nothing takes it
  next = {
    ...clearFor(next, id),
    ...(keepPending ? { pending: next.pending } : {}),
    transient: transient('thank', now),
    permissionWait: false,
    stats: { ...next.stats, thanks: next.stats.thanks + 1 },
  };
  effects.push({ type: 'sound', name: 'chime' });
  if (foreign) {
    // another session's line keeps its place; no thanks is queued over it
  } else if (carried) {
    next = { ...next, level: carried, nextPrompt: carryOver(next) }; // the ladder carries over with the plea
  } else if (next.settings.thanks) {
    next = { ...next, nextPrompt: queue(next, now, { kind: suspicious ? 'suspicious' : 'thanks' }, id) };
  }
  ctx.next = next;
}

function onSessionEnd(ctx) {
  const { id, now, effects } = ctx;
  let next = ctx.next;
  const { [id]: _gone, ...rest } = next.sessions;
  // What was addressed to the closing session goes to its successor when nothing else is alive (`claude
  // --continue`), and is dropped when another conversation is: a plea for one session never lands in another.
  const alone = !Object.keys(rest).length;
  const release = (item) => (item && item.to === id ? (alone ? { ...item, to: null } : null) : item);
  if (!alone && next.pending && next.pending.to === id) effects.push(dropped('plea', next.pending, 'session ended'));
  if (!alone && next.nextPrompt && next.nextPrompt.kind === 'plea' && next.nextPrompt.to === id) {
    effects.push(dropped('plea', next.nextPrompt, 'session ended'));
  }
  next = {
    ...next,
    sessions: rest,
    activeSession: mostRecent(rest),
    pending: release(next.pending),
    nextPrompt: release(next.nextPrompt),
  };
  if (next.activeSession) {
    ctx.next = next;
    return;
  }
  const since = next.runStats || { pleas: 0, thanks: 0 };
  const pleas = next.stats.pleas - since.pleas;
  const thanks = next.stats.thanks - since.thanks;
  // Same length as the goodbye pose: the window hides when the transient ends.
  effects.push(
    {
      type: 'bubble',
      text: `Bye! ${pleas} plea${pleas === 1 ? '' : 's'}, ${thanks} thank${thanks === 1 ? '' : 's'}`,
      ms: TRANSIENT_MS.thank,
    },
    { type: 'sound', name: 'bye' },
  );
  // A plea saved for the next message survives (e.g. `claude --continue`); thanks for a closed session does not.
  const keep = next.nextPrompt && next.nextPrompt.kind === 'plea' ? next.nextPrompt : null;
  if (next.pending) effects.push(dropped('plea', next.pending, 'session ended'));
  ctx.next = {
    ...resetLadder(next),
    nextPrompt: keep,
    transient: transient('thank', now),
    deadlineUntil: 0,
    deadlineMinutes: 0,
    permissionWait: false,
  };
}

const HOOK_HANDLERS = {
  turn_start: onTurnStart,
  assistant_text: onAssistantText,
  tool_start: onToolStart,
  tool_ok: onToolOk,
  tool_fail: onToolFail,
  permission_wait: onPermissionWait,
  turn_end: onTurnEnd,
  session_end: onSessionEnd,
  // session_start and noop only touch the session's lastSeen and the active session, done below for every kind.
};

/**
 * @param {State} state
 * @param {HookEvent} event
 * @param {number} now
 * @returns {Outcome}
 */
function onHook(state, event, now) {
  const effects = [];
  const id = event.sessionId;
  const prev = state.sessions[id] || freshSession(event.agent, now);
  const sess = { ...prev, lastSeen: now };
  const firstOfRun = !state.sessions[id] && !sessionCount(state);
  const ctx = {
    next: {
      ...state,
      lastHookAt: now,
      activeSession: follows(state, event, id),
      sessions: { ...state.sessions, [id]: sess },
      runStats: firstOfRun ? state.stats : state.runStats,
    },
    sess,
    effects,
    event,
    id,
    now,
  };
  const handle = HOOK_HANDLERS[event.kind];
  if (handle) handle(ctx);
  let next = ctx.next;
  // Remember what went out with this event, on the session it went to, until the turn ends.
  const went = effects
    .filter((e) => e.type === 'reply')
    .map(({ kind, level, phrase }) => ({ kind, level, phrase, invite: event.invite !== false }));
  if (went.length && next.sessions[id]) {
    const s = next.sessions[id];
    next = { ...next, sessions: { ...next.sessions, [id]: { ...s, sent: [...(s.sent || []), ...went] } } };
  }
  return { state: next, effects };
}

module.exports = { onHook };
