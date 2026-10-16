# Changelog

All notable changes to OpenPlead are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-10-15

### Added

- Two README diagrams, an architecture map and the sequence of one plea, hand-written as SVG in `docs/diagrams/`;
  `npm run diagrams` exports them to `docs/media/`.
- `npm run demo` renders the README GIFs (light and dark) from the real pet renderer: the plead ladder from respect
  to sacrifice, the top plea going out once, a calm line on panic, the Reaper and the thank-you. Every quoted line is
  looked up in the shipped phrases, so the demo fails to build rather than show words the app cannot say.
- Two sessions: the nameplate follows the conversation you last wrote in instead of flipping on every tool call;
  the chip names the session a queued line is addressed to (with a short id when both are the same agent); a line
  is carried only by its own session's events, including thank-yous and prompts; a "Plead to" radio group in the
  menu switches by hand. The deadline can be turned off (a radio group with Off, the running one checked, minutes
  left in the status lines), and turning it off withdraws a note that has not gone out yet.
- An opt-in setting, "Invite a one-line reply", off by default, adds one clause to each line that goes to the
  agent; with it off the line stays a plain fact about you, as before. With it on, the final text of each Claude Code
  turn is read for a sentence that answers the line: it shows in the bubble with the agent's name, is kept in a local
  log, and Settings → About lists the replies with Copy, Save as card (a PNG on the Desktop) and Clear. Claude Code
  only. Replies given mid-turn are caught as the text is displayed; the final text is read once more at the turn's
  end, and a line is answered at most once. The log is private to the owner and capped; markdown headings, bullets and
  code never pass as replies; the invitation goes only with lines a person would say, not the pet's status lines.
- The per-message text hooks (Claude Code's MessageDisplay, Cursor's afterAgentResponse) are registered only while the
  invitation is on, and removed when it is turned off, so the default setup never pays for them. A mid-turn reply earns
  a bow.
- A session that waits for you is no longer forgotten after ten quiet minutes while its agent process runs, and the
  autostarted pet no longer quits under it. If the pet is gone under an open Claude Code session, your next prompt
  brings it back.
- A click between turns no longer shrugs at you: it saves the line for your next message to that session, climbs
  the ladder like any click, shows "Plea 2 of 5 · next message" on the chip, and waits as long as you do. Without any
  session the pet says so in plain words. The menu's Plead item follows.
- The pet is called Grovel. The name is the project's own; the pixel art still nods to Anthropic's crab mascot, and
  the NOTICE says so.
- Mini mode: drop Grovel at a screen edge and he parks there with a sliver showing; hover, an outcome or queued words
  slide him in, and he slides back once the pointer has left. Dragged away from the edge he stays where he was dropped.
  He remembers which display he was parked on, and an edge that joins another display cannot be parked at. Also in the menu. A chime preview in Settings. `openplead version`.
- A "Show me (20 s)" demo on the Welcome tab: a whole fake turn through the real reducer on a state of its own,
  nothing sent anywhere; a real agent session ends it at once and the lifetime tally is untouched.
- A Phrases tab in Settings: every line the pet can say, editable in place, with validation, a confirmed reset, and a
  reload on every visit so edits made elsewhere are not overwritten. The file is written whole or not at all.
- Ladder dots on the nameplate chip while a plea is queued.
- Release preparation. `npm run smoke` starts the app in a throwaway home, waits for its port, walks one session
  through the hook endpoint and stops it; CI runs it on macOS, Ubuntu (virtual display) and Windows. The macOS build
  is explicitly unsigned until there is a Developer ID, and the README says what macOS and Windows will show. "Copy my
  record" on the About tab; phrase packs (`docs/phrase-packs.md`, `assets/phrase-packs/default.json`) with "Import a
  pack…" on the Phrases tab; a social preview card rendered from the pet (`npm run social`); a release checklist.
- A pass against the platform guidelines, recorded with sources in `docs/ux-guidelines.md`. On macOS the menu bar
  icon is a template image (black and clear, tinted by the system) with alpha-only state badges; Windows and Linux keep
  the color icons. Menu and button labels take the platform's case (title style on macOS, sentence style elsewhere)
  from one sentence-style source. The tray menu is four separated groups, one level deep, with no ellipsis on submenu
  labels and "Exit" last on Windows; the hotkey, reset-position and edit-phrases commands live in Settings only. The
  tray tooltip is a status statement within Windows' 127 characters. The settings window names its pane in the title
  and reopens on the last pane; the walkthrough and demo are reachable again from About. Transient bubbles stay four to
  ten seconds by word count. The queued chip settles once instead of breathing; panic pulses instead of flashing.
- Accessibility: the settings panes are a WAI-ARIA tab list (arrow keys, Home/End, one tab stop); contrast meets WCAG
  2.2 AA (a dark label on the orange button, a deeper focus ring on light, unlit ladder dots and the waiting dot that
  read against the plate). On macOS a click on the menu bar icon opens the menu, as the HIG asks; on Windows it still
  shows the pet.
- A UX pass over both windows. The speech bubble has its tail back (it was clipped), and queued words are marked by an
  orange shadow and a slowly breathing chip instead of a blinking caret. The Welcome tab puts Connect and the demo
  first, with three two-line steps and Done in view. The Connection tab names sessions in plain words ("Claude Code ·
  session 5ec5b082") and no longer shows raw ids or "process unknown". Reset position lives under General; the phrases
  file opens from the Phrases tab, whose boxes grow with their lines and label every plea level. Keyboard focus is
  visible everywhere.
- The tray icon shows the state at a glance, which matters while Grovel is hidden behind another app: a red badge
  while the agent waits for your OK, a blue one while words are queued, dimmed in quiet mode, grey until connected.
  Rendered from the base icon by `npm run tray`.
- Chatter that kept losing its spot to outcomes for more than a few seconds is dropped instead of shown out of context
  (a goodbye six seconds late in the middle of the demo).
- The loopback server refuses requests from non-loopback Host names (DNS rebinding), browser-shaped POSTs (an Origin or
  Sec-Fetch-Site header, or a content type a page can send without a preflight) and bodies over 8 MB.
- README media captured from the renderer, light and dark, picked by the reader's theme: a banner (OpenWhip's
  terminal struck out next to Grovel pleading), a hero GIF, and three stills of one plea from click to thank-you.
  CONTRIBUTING, SECURITY, a code of conduct, issue and PR templates.
- The pet explains itself once per moment, on the real event: the first working turn, the first click, the first
  delivery, the first finished turn and the first panic. Chips say where a line goes ("Plea 2 of 5 · next tool
  call", "Sent to Claude Code ✓"). The tray tooltip says why the pet is hidden. The menu is five items with the
  rest under "More…". "Connect" replaces "install hooks" everywhere a user reads it. `openplead install` opens
  the Welcome tab reliably.
- "Only over my agent's app" on Windows and Linux: the shim records the apps in the hook's ancestry (terminal, editor)
  by process name; a PowerShell helper (Windows) or xprop, Hyprland or sway (Linux) reports the front app and whether
  its window is on screen. Unverified on real hardware. "Go to the agent's app" works on Linux through xdotool.
- A settings window (General, Hooks, About) that opens on a Welcome walkthrough on first run.
- Linux: the pet can be clicked, dragged and given a menu (the window takes the mouse over the sprite and the
  nameplate by polling the cursor; the tray carries a context menu). AppImage builds keep a copy of the shim next
  to the config and launch the AppImage itself. Hotkeys default to Control+Alt on Windows and Linux.
- Quiet mode (for an hour, or until turned off): no sounds, no chatter, outcomes still shown.
- "Go to the agent's app" in the menu and by clicking the nameplate (macOS).
- "Keep Grovel on screen until the next session ends" in the menu, for trays without a click.
- GitHub Actions: `check` on macOS, Ubuntu and Windows; `release` builds installers on a version tag.
- `docs/known-limitations.md` and `docs/state-mapping.md`.
- The shim records each session's agent process; the pet ends sessions whose agent died without a SessionEnd
  within five seconds and, when it starts, wakes up at once for sessions whose agent still runs.
- `openplead start` and `openplead install` wait for the app to answer on its port and report a failure instead
  of claiming success. Launching from inside VS Code or Cursor no longer dies silently (the inherited
  `ELECTRON_RUN_AS_NODE` is stripped), and a global install finds the `npx` that came with the running Node.
- Sounds, synthesized in the renderer (no audio files): a chime when a turn completes that rises a semitone per
  thank in the run, a sob at plea level 5, two blips on panic, an arpeggio for happy tears, a soft fall at
  goodbye and a blip when startled. Ten-second cooldown per sound; silent while hidden or when another app is in
  front. **Settings → Sounds** turns them off.
- Idle eye tracking: Grovel's pupils follow the pointer while he is idle.
- A startled wake-up: the pointer touching the sleeping pet plays a new `startled` sprite and "I WASN'T ASLEEP. I WAS CACHING."
- The lifetime record in the tray menu and `openplead doctor` ("On record: N pleas, N thanks, N panics"); the
  goodbye wave counts the current run only.
- An optional global plead hotkey (**Settings → Plead hotkey**: Control+Shift+P or Control+Shift+Space).
- After the machine wakes from sleep the pet redraws itself, re-checks the hook files and the front app.
- A nameplate under the pet in the style of a session HUD: which agent is doing what (working, needs your OK,
  waiting for you, ×N sessions) and the queue status as a chip (`pleading · level 2/5`, `Sent ✓ plea level 2/5`, `Dropped · reason`). The bubble
  carries only what is said; every status is on the nameplate.
- The line that will be sent is chosen the moment you click and stays in the bubble, with a caret, until it goes
  out; the agent receives exactly those words.
- Every outcome is acknowledged: expired, interrupted and session-ended pleas are reported; thanks simply expire.
- The shim records which app each session runs in (`~/.openplead/hosts/`) at every session start and prompt, so
  "Only over my agent's app" works for sessions the pet did not see start.
- `openplead doctor` and `GET /health` report the apps the pet stays over, its visibility, and sessions with no
  known app.
- ESLint and Prettier configuration, `npm run check`, and a `prepublishOnly` gate.
- An end-to-end test over HTTP covering the server, both adapters, the reducer, phrases and the stdio shim.

### Changed

- Repository layout: community files live in `.github/`, README media in `docs/media/`, tray icons in
  `assets/tray/`, developer scripts in `scripts/`, and the hook shim beside the CLI in `bin/`. `src/` is grouped by
  concern: `core/` (pure logic), `agents/`, `system/` (disk, network, OS), `desktop/` (windows and menus),
  `renderer/`. The sprite GIFs and preview page are build output and no longer committed; `npm run sprites`
  regenerates them.
- The phrase catalogue is tighter across the dignity ladder: less generic flattery, cleaner escalation and stronger
  bargains, while keeping the firstborn-process promise at level 5.
- The reply card is redesigned: the plea set large in a serif with a hanging quote, the reply in a glass bubble
  beneath it, Grovel lit from below in the pose that said the line (the plea's own ladder step, or the thank-you
  pose), and the date and "Plea N of 5" in the header. Replies now record the plea's level for this.
- The right-click menu is four plain groups that each answer one question. What is happening: two status lines
  ("Claude is working", "Next up: plea 2 of 5 …"). What to send: "Plead with Claude", "Thank Claude", "Reassure
  Claude" (it's okay / take your time / sorry for my tone), "Set a deadline", and "Cancel the next message" while
  something waits. What came back: "Claude's replies" with the last three replies (click one to save a card), the
  "Ask Claude to reply" switch and "See all replies…". How he behaves: "Mute for an hour", "Show Grovel on every
  app", "Go to Claude Code". On macOS 14.4 and newer every item carries a second, smaller line that explains it.
  Park, Quick settings, Disconnect, the hotkey line and the tally moved to Settings.
- Settings is five panes. Grovel: one choice for when he is on screen (instead of "Always show" plus "Only over my
  agent's app" plus the pin), sound and mute, the hotkey, position. Messages: the automatic messages and the phrase
  sets by plain name, each with when Grovel uses it. Replies: every reply as a card, "Save as card" first, with the
  switch at the top. Connection: the status in a sentence, "Also watch Cursor", "Check the connection", and the
  technical details under Advanced. About: the version and the tally as a sentence. In `config.json`,
  `alwaysShow` and `onlyOverAgent` became `showMode` (`agentFront`, `session`, `always`); old files
  are migrated on load.
- `openplead install` and `openplead doctor` now honor the "Ask Claude to reply" setting, so the reply hooks are
  kept and the doctor no longer reports a false failure while it is on. The menu offers "Connect to Claude Code…"
  while not connected, and the first bubble points at it.
- Muting is called Mute everywhere: the bubble, the tray tooltip, the menu and Settings.
- The main process is a composition root again: effects, the view, the user's actions, the lifecycle, health, the
  window, sounds and the demo each live in their own module, and the reducer is split into its entry, its hook
  handlers and the shared rules. Every source file is under the 400-line lint limit.
- Electron is pinned to one exact version, and `openplead install` fetches it once instead of leaving it to the
  first session start. The type checker runs in `npm run check` over every source file (the pages declare their globals
  in `src/renderer/env.d.ts`), and a test requires every silent catch to say why.
- Every module split out of the main process has a unit test of its own (effects, view, actions, lifecycle, health,
  sounds, demo runner, pet window), as do the log and the channel names; 180 tests in all. CI runs the live suite on
  macOS and Linux next to the smoke test.
- The factories take only what has side effects; pure helpers are required where they are used. The two live
  scripts share one harness module. One `sessionCount` serves the reducer, the nameplate, the menu and health.
- Fixed, with two sessions open: one session's turn end or interrupt no longer delivers, drops or replaces a line
  clicked for the other, and an interrupt ends only the interrupted session's turn.
- Fixed: a hook relaunching an already running pet no longer pops the Settings window open; an autostarted pet no
  longer quits under an open Settings window; an API error clears a leftover "needs your OK".
- Fixed: the app no longer rewrites the hooks with a bare `node` when its own environment cannot find node; it looks on
  PATH, then in the user's login shell, then keeps the absolute path already installed, and looks only once.
- Fixed: a config.json with a typo is never overwritten with defaults; the hook files are written atomically and keep
  a symlink; an unsigned app run from a disk image or Downloads refuses to write its temporary path into the hooks;
  reply cards saved in the same minute no longer overwrite each other.
- Fixed: after `openplead uninstall` the running app kept reporting itself connected; it now follows the files.
  `npm run live` also drives the first run: no config, Welcome opens by itself, Connect, the first session, Done.
- Fixed: the settings window came up blank after the restructure, because its sandboxed preload could not load the
  shared channel names; the preload is self-contained again and a test keeps its names identical. `npm run live`
  now drives a hidden copy of the app through real hooks and every Settings control, so a blank window cannot pass.
- Removed what nothing used: the migration of pre-release config keys, two one-line host wrappers, the badge
  helper, a reply wrapper, options no caller set, and a hand-rolled timestamp.
- The phrase editor shows every line as its own bulleted row, so long lines never run into each other; a row can
  be removed and a line added at the end.

- The phrase catalogue is rewritten. Pleas no longer tell the agent what to do (it knows the task); the five
  levels now measure how much dignity the pet trades for a favor: respect, flattery, begging, bargaining,
  sacrifice. Every set has five or more lines and no line is shared between sets. An existing
  `~/.openplead/phrases.json` keeps its own lines; delete it to get the new ones.
- The main process is split into focused modules: `front` (front-app watcher), `bubbles` (bubble priority),
  `queue` (phrase filling and outcome lifecycle), `menu` (context menu template), `log`, `hosts` and `tag`.
- The window grew to 280×280 to fit a wrapping bubble and the nameplate; a saved position is clamped into the
  display's work area instead of being discarded.
- A prompt reported twice within two seconds (Cursor runs its native and the imported Claude Code hook) is no
  longer treated as an interrupt.

### Fixed

- At quit the pet writes only its tally, so settings changed meanwhile by the CLI survive. `openplead install` asks for
  the Welcome tab through a marker file, and starting the app while it already runs opens Settings instead of doing
  nothing.
- The pet holds the screen as it is while a newly seen app is being probed, and stops hiding after three missed
  probe answers, so a broken helper never hides it for good. Helpers get a longer first timeout and back off between
  restarts. The shim's record step is bounded, and on Windows it runs in the background. The Welcome tab opens only
  on a true first run, never when a hook launched the pet. Recovery revives only recent records of enabled agents.
- The pet now steps aside when the agent's app is minimized or its window is on another desktop, not only when
  another app is active. The front-app probe is a long-lived JavaScript-for-Automation helper reading the
  Core Graphics window list; no permission prompt, about a millisecond per check.
- The npm package ships only the adapter files from `src/agents/`.
- The install test no longer risks overwriting the real Claude settings file on Windows.
- A failing server test can no longer hang the suite.
- After installing or uninstalling the hooks from the menu, the pet's visibility and nudges follow the new
  state at once instead of waiting for the next menu open.

[Unreleased]: https://github.com/YasamanAnsari/OpenPlead/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YasamanAnsari/OpenPlead/releases/tag/v0.1.0
