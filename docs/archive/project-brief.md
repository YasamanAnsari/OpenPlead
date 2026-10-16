# OpenPlead: project brief (historical)

October 11, 2026

> **Historical document.** This is the original design brief, kept for the record. The README and the files in
> `docs/` are current; where they differ, this brief is out of date.

> **Status (Oct 13, 2026).** This is the original design brief; the README is the current reference. Decisions that
> changed since: a plea left over at the end of a turn is delivered at `Stop` (`decision: block` in Claude Code,
> `followup_message` in Cursor); the delivery hooks, `Stop` and `Notification` are synchronous HTTP hooks with a
> 3 s timeout; `SessionStart` and `UserPromptSubmit` run through the shim so the pet knows which app each session
> runs in; thanks reach Cursor with the next tool result; hugs, zen and an apology shipped as "Say…".

## Goal

OpenPlead is a desktop pet that pleads with your AI coding agent instead of whipping it, and thanks it when the work is done. Tagline: **Stop whipping. Start pleading.** Subtitle: *A desktop pet that pleads with, thanks, and panics about your AI.*

It is a parody sibling of [OpenWhip](https://github.com/GitFrog1111/OpenWhip), timed to Anthropic's usage-policy update of October 8, 2026, which bans "sustained and needless abusive or cruel behavior" toward Claude starting November 12, 2026. The joke is the hook; the substance is a pet that reads the agent's real state through hooks and reacts to it.

What it must do in v1:

- Sit on the desktop as a transparent, click-through, always-on-top character.
- React to the agent's lifecycle (thinking, working, error, done) using Claude Code and Cursor hooks.
- Let the user plead with one click, climbing a five-level ladder; thank the agent automatically when a turn completes.
- Deliver pleas and thanks to the agent through hook context injection, never through keyboard automation.
- Stay harmless: never interrupt the agent, never answer a permission prompt, never force an extra turn.

Non-goals for v1: hugs, zen, apology, bribe and gentleman modes (kept as ideas), supporting agents without context-injecting hooks, mobile companions, auto-update, and any crypto token (OpenWhip's README promotes one; ours will state that it has none).

## Related projects

We take ideas from four projects and code from none; OpenPlead is a fresh, MIT-licensed build.

| Project | What it is | License | What we take |
| --- | --- | --- | --- |
| [OpenWhip](https://github.com/GitFrog1111/OpenWhip) | Electron tray app; a canvas whip that sends Ctrl+C plus a scolding message to the focused terminal. 2 dependencies (electron, koffi). \~3.1k stars. Bin aliases `openwhip` and `badclaude`. | MIT | The premise to parody, the tray-app simplicity, the `goodclaude` alias idea. Not the keystroke injection. |
| [openwhip-plus](https://github.com/dashty8/openwhip-plus) | Fork adding a tray config window, editable phrases, Unicode phrase support. | MIT (fork) | The editable phrase library as a settings feature. |
| [OpenSpank](https://github.com/aoruize/OpenSpank) | Slap your MacBook to trigger the whip; vendors OpenWhip's overlay. | MIT | Evidence that physical/manual triggers are part of the fun. |

Two reference docs we build against:

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks.md): 33 events, HTTP hooks, `additionalContext`.
- [Cursor hooks](https://cursor.com/docs/hooks): 21 hooks, stdio only, `additional_context`, and a compatibility layer that can load Claude Code hook configs.

## Research basis

The research says: keep pleas polite but direct, and never pass panic to the model. Four findings shape the phrase design.

| Finding | Source | Design rule |
| --- | --- | --- |
| Moderate politeness works best; rude prompts hurt, over-polite prompts do not help, and the sweet spot varies by language and model. | [Yin et al., 2024](https://arxiv.org/abs/2402.14531) | Default pleas are polite and direct ("please, just the fix"). Gentleman mode is the deliberately over-polite joke. |
| On ChatGPT-4o, very rude prompts scored 84.8% vs 80.8% for very polite ones; indirect phrasing ("could you please…") may add ambiguity. | [Dobariya & Kumar, 2025](https://arxiv.org/abs/2510.04950) | Avoid indirect requests; state what the user wants in one clause. |
| Adding emotional stakes ("this is very important to my career") improved results in several benchmarks. | [EmotionPrompt, Li et al., 2023](https://arxiv.org/abs/2307.11760) | Higher plead levels may add stakes, kept short and truthful. |
| Tipping and threatening a model has no significant effect on benchmark accuracy. | [Meincke et al., Wharton, 2025](https://arxiv.org/abs/2508.00614) | Bribe mode is on-screen only, with a tooltip citing this. |
| Inside Claude, a "desperate" internal state rises with repeated failures; steering it up increases corner-cutting (reward hacking), steering toward "calm" reduces it. Output tone often stays composed while desperation peaks. | Anthropic, April 2026, "Emotion concepts and their function in a large language model" (secondary coverage: [NYU Shanghai RITS](https://rits.shanghai.nyu.edu/ai/anthropic-discovers-functional-emotions-inside-claude)) | Panic stays on the pet. Everything sent to the agent after failures is a calm line. After many failed attempts the pet asks the user to verify the fix. |

Caveat: the Anthropic result comes from internal steering, not from prompts, so it does not prove that pleading text makes Claude desperate. We treat it as a strong hint and the reason the pet's mood and its delivered text are allowed to differ.

Policy context: Anthropic's usage policy update (announced October 8, 2026, effective November 12) targets only sustained, purposeless cruelty; ordinary frustration and pushback are explicitly fine. A cartoon whip would likely not qualify. OpenPlead does not need the policy to be legal, only to be funny.

## Modes

Twelve states. Five come from clicking, the rest from the agent's hooks or the menu. The rule throughout: clicks escalate, hooks deliver. A click never sends anything by itself; the plea leaves only inside the next hook response, and the agent's own state moves the pet's mood through the same hooks.

| State | Trigger | What the pet shows | What reaches the agent |
| --- | --- | --- | --- |
| Plead (levels 1-5) | Click the pet while the agent is in a turn; one level per click, capped at 5 | 1 hands clasped · 2 hopping and pumping · 3 kneeling, tears welling · 4 kneeling and crying under a gloom cloud · 5 full sob, arms overhead | One short, polite, direct plea at the highest pending level, delivered on the next tool result; dropped if older than 2 minutes |
| Shrug | Click while no turn is running | Arms lift, eyes glance, "?" and the bubble "Nothing to beg for. Give me a task and I'll give you my dignity." | Nothing |
| Working | Any tool starts | Typing on the laptop, coffee steaming | — |
| Panic | 2+ tool failures in a row, or an API error (`StopFailure`) | "!!", wide eyes, arms flailing, running in place | A calm line only ("No rush. If this isn't solvable, just say so."), never a plea |
| Joy-cry | A command that failed earlier in the turn succeeds | Happy eyes, smile, tears of joy, arms up, confetti | Nothing |
| Thank | A turn completes (`Stop`) | Deep bow, blush, hearts; the plead level resets | "Thank you" queued for the user's next prompt (Claude Code only; on screen only in Cursor). Setting, default on |
| Oh (abort) | The user interrupts the turn | Bubble "oh", back to idle; level reset, queue cleared | Nothing |
| Deadline | Menu: 5 / 15 / 30 minutes | The reaper drifts in, hand on the shoulder, Grovel slams Enter, sighs; ends when the turn completes | Nothing |
| Sleeping | 60 s without hooks and no turn | Arms low, shut eyes, snore bubble, z's | — |
| Idle | Default | Static Grovel | — |

Session beats: on the last `SessionEnd` the pet waves and shows the session's stats ("3 pleas, 2 thanks"). With two or more agent sessions alive a small "x2" badge appears; clicks and pleas go to the session that most recently sent a hook.

Stats kept locally: pleas delivered, thanks, panics.

## Architecture

OpenPlead is a fresh Electron app the size of OpenWhip: two dependencies (`electron`, plus `electron-builder` for builds), no keyboard automation, no AGPL code.

&#91;embedded content: OpenPlead architecture · 4 components, 1 return path\]

Events flow left to right; the only path back to the agent is the hook response itself, which carries a queued message as `additionalContext` (Claude Code) or `additional_context` (Cursor).

- **Coding agent.** Claude Code registers HTTP hooks directly or uses the shim; Cursor hooks are stdio-only, so the shim is required there.
- **openplead-hook shim.** A Node script: read stdin, POST to `http://127.0.0.1:<port>/hook`, print the response, exit 0. If the pet isn't running, it prints `{}` and exits 0 so the agent is never blocked.
- **OpenPlead main process.** One adapter per agent normalizes native events into `session_start`, `turn_start`, `tool_start`, `tool_ok`, `tool_fail`, `permission_wait`, `turn_end`, `session_end`. The state machine turns events into moods, counts error streaks and turn time, and holds the outgoing message queue.
- **Pet window.** A frameless, transparent, always-on-top `BrowserWindow` with click-through on transparent pixels; it plays the APNG for the current mood and sends clicks back to main over Electron IPC.
- **Config.** `~/.openplead/config.json` holds phrase sets, mode toggles, thresholds, and stats.

Three rules enforced in the state machine:

1. Messages leave only in responses to `tool_ok` / `tool_fail` (mid-task) or `turn_start` (queued thanks and apologies). Never in `Stop`/`stop`, so no extra turn is ever forced.
2. The queue freezes during `permission_wait`, and every permission-type hook always returns allow. The pet never blocks or decides anything.
3. Every delivered message is phrased as a fact about the user ("The user pressed the plead button and says: …"), never as a system instruction, which can trip prompt-injection defenses.

## Hook → mood map

Internal events are produced by one adapter per agent (`src/agents/claude-code.js`, `src/agents/cursor.js`); the state machine never sees hook names.

| Internal event | Claude Code hook | Cursor hook | Pet | Delivery |
| --- | --- | --- | --- | --- |
| session\_start | `SessionStart` (async) | `sessionStart` | wake; session counted | — |
| turn\_start | `UserPromptSubmit` | `beforeSubmitPrompt` | working; an already-open turn means the previous one was aborted (Oh) | queued thanks (Claude Code only; Cursor cannot inject here) |
| tool\_start | `PreToolUse` (async) | `preToolUse` | working | — |
| tool\_ok | `PostToolUse` | `postToolUse` | working; error streak resets; joy-cry if this command failed earlier | pending plea (if fresh) |
| tool\_fail | `PostToolUseFailure` (not `is_interrupt`) | `postToolUseFailure` (not `is_interrupt`) | panic at 2 in a row | calm line only |
| permission\_wait | `Notification` (`permission_prompt`, async) | `beforeShellExecution` / `beforeMCPExecution` | queue frozen until the next tool event | nothing; no permission decision is ever returned |
| turn\_end ok | `Stop` (async) | `stop` (`completed`) | thank; level reset; deadline ends | nothing (never on Stop) |
| turn\_end aborted | inferred: `UserPromptSubmit` with a turn open, or 60 s of silence mid-turn | `stop` (`aborted`) | Oh | nothing |
| turn\_end error | `StopFailure` (async) | `stop` (`error`) | panic flash | nothing |
| session\_end | `SessionEnd` (async) | `sessionEnd` | goodbye wave and stats when it was the last session | — |
| idle 60 s | timer | timer | sleeping | — |

Delivery hooks (`UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`) run synchronously with a 3 s timeout; every other hook is registered `async: true` so it can never block the agent. `PermissionRequest` is not registered at all. Claude Code's `Stop` hook accepts `additionalContext` that continues the turn and Cursor's `stop` accepts `followup_message` that submits a new prompt; OpenPlead returns neither.

Manual triggers: single click = plead ladder (or shrug when idle); right-click menu = Deadline (5/15/30), Thank now, Reset level, Install hooks / Uninstall, Quit. No double-click gesture, since fast clicking is how the ladder climbs.

Install: one click ("Install hooks" in the menu, or `openplead install`) merges marker-tagged entries into `~/.claude/settings.json`, with a backup. Cursor loads Claude Code hooks from that file through its Third Party Hooks compatibility, so one install covers both; if that proves insufficient the installer also writes `~/.cursor/hooks.json`. After installing, the pet asks you to restart open Claude Code sessions, since hooks load at session start. If the pet is running without hooks installed, it points at the menu; if hooks are installed but silent, it suggests a restart.

## Art and assets

The character is Grovel, drawn after Anthropic's crab mascot at its published proportions (bounding box 136 × 86; body 96 × 60; arms 20 × 20; eyes 11 × 10; legs 11 × 26) as SVG in code and rendered to APNG with `scripts/render-sprites.js` (Puppeteer + FFmpeg; frames are seeked deterministically). The art is excluded from the license and credited to Anthropic.

Format choices: APNG over GIF (full alpha instead of binary transparency), 4–12 frames per animation, exported at 2–3× the display size, the character in the same position across all frames. Idle is the static base sprite.

| Group | States | Count |
| --- | --- | --- |
| Reference | grovel-base (static idle) | 1 |
| Plead | plead-1, plead-2, plead-3, plead-4, plead-5 | 5 |
| Reactions | working, panic, joy-cry, thank, shrug, sleeping | 6 |
| Story | deadline (6 s, 240 px wide) | 1 |

Total: 13 SVG sources in `assets/svg/`, rendered to APNG (used by the pet) and GIF (used in docs) in `assets/sprites/`, committed so users never need Puppeteer or ffmpeg. Style follows the official Claude pixel mascot pack: flat #D97757, navy pixel eyes, small white mouths, fountain tears, pack palette for props. The "Oh" beat is the idle sprite plus a bubble.

Also needed: a tray icon and app icon in the same style; a demo GIF for the README.

Character decided: Grovel, at the proportions above.

## Data and inputs we need

Most of what we need is sample data from real agent sessions and a few decisions; nothing requires a dataset in the research sense.

**Hook payload samples** (the single most useful input):

- [ ] Claude Code: one full session captured as JSON, one file per hook event, covering `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification` (both `permission_prompt` and `idle_prompt`), `SubagentStart`/`Stop`, `TaskCompleted`, `Stop`, `StopFailure`, `PreCompact`, `SessionEnd`. Capture with a command hook that appends stdin to a log file.
- [ ] Cursor: the same for `sessionStart`, `beforeSubmitPrompt`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `beforeShellExecution`, `subagentStart`/`Stop`, `afterAgentThought`, `stop` (all three statuses), `sessionEnd`.
- [ ] One session each where a test command fails and later passes, to design the joy-cry and suspicious-fix detectors from real `tool_input` and `tool_response` shapes.
- [ ] One session with an API error (`StopFailure`) and one that hits compaction.

**Behavior of context injection**, verified on a real machine:

- [ ] Does `additionalContext` on `PostToolUse` reach Claude mid-task, and how does Claude respond to a plea phrased as a fact about the user?
- [ ] Does Cursor's `additional_context` behave the same?
- [ ] Does Cursor's Claude Code compatibility layer load our `settings.json` hooks unchanged?
- [ ] Confirm nothing is typed, blocked, or auto-submitted in any mode.

**Phrase sets** (text content, English first):

- [ ] Plead levels 1–5, 3 lines each, polite and direct, no indirect "could you please".
- [ ] Calm lines for panic, 5 lines.
- [ ] Thanks, 3 lines.

All phrases live in `~/.openplead/phrases.json`, seeded from `src/core/phrases.default.json`, so users can edit them without touching code.

**Decisions taken:**

- Character: Grovel at the mascot proportions, pack style. Done.
- Idle click: shrug, nothing queued. Plea expiry: 2 minutes. Level reset: on turn end, or 2 minutes without a click.
- Thanks are queued for the next prompt by default (setting); hugs are out of v1.
- Multi-session: one pet, pleas go to the most recent session, "xN" badge.
- Command name: `openplead` (`start`, `install`, `uninstall`).

**Still to tune from samples:** panic thresholds (2 failures in a row; 60 s of mid-turn silence counts as an abort).

**Machines and tooling:**

- [ ] Windows, macOS, and Linux machines with Claude Code and Cursor installed, for the test matrix.
- [ ] Node 22+, FFmpeg for APNG/GIF encoding, electron-builder, a GitHub repo and Releases.

Already in hand: the OpenWhip, Claude Code hooks, and Cursor hooks references; the research sources; the hook-to-mood map; and an early Tampermonkey prototype for the claude.ai web app that demonstrated the escalation ladder (not part of this repository).

## License, credits, and distribution

MIT for code. The art depicts Grovel, drawn after Anthropic's crab mascot for Claude, and is excluded from the license with a non-affiliation notice.

- **NOTICE file** credits Anthropic for the mascot Grovel is drawn after and OpenWhip (MIT) for the premise, stating that no code or art files were copied.
- **README** carries the tagline, a demo GIF, install steps, a "What the science says" section with the five sources above, and the line "OpenPlead has no token and never will."
- **Distribution:** electron-builder installers (NSIS for Windows, DMG for macOS, AppImage and DEB for Linux) on GitHub Releases; `npm install -g openplead` as a second path, mirroring OpenWhip. No auto-updater in v1.
- **Naming:** OpenPlead. One letter from OpenPledge, an unrelated open-source funding platform; the GitHub description should carry the tagline to avoid confusion.

## Roadmap

Four milestones, each shippable on its own.

1. **v0.1 Pet on desk.** Electron window with click-through, the committed sprites, speech bubble, click ladder with the idle shrug, right-click menu, sleep timer. Exit: clicking climbs plead-1 to plead-5 and resets from the menu.
2. **v0.2 Hook path (Claude Code).** Shim, local server, Claude Code adapter, the state machine with its rules and tests, installer with the restart bubble and not-installed detection. Exit: a captured session shows a plea in context on `PostToolUse`, a thank on `Stop`, a shrug on an idle click and an "oh" after Esc.
3. **v0.3 Cursor and extras.** Cursor adapter, Third Party Hooks verified (or `hooks.json` written), deadline timer, "x2" badge with two terminals, editable phrases.
4. **v1.0 Launch.** electron-builder installers, `npm install -g openplead`, README with demo GIF, NOTICE. Target: before November 12, 2026, when the policy takes effect.

After v1: Codex and Gemini CLI adapters if their hooks can inject context; the dropped modes (hug, zen, apology, bribe, gentleman) if anyone misses them.
