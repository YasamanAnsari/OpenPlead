# Contributing

Thanks for helping Grovel plead better. Small, reviewable changes land fastest.

## Set up

```bash
git clone https://github.com/YasamanAnsari/OpenPlead.git && cd OpenPlead
npm install
npm start            # the pet, from the checkout; right-click Grovel → Connect to Claude Code…
npm run check        # eslint, tsc (the files with // @ts-check), prettier --check, node --test (what CI runs)
npm run live         # drives a hidden copy of the app through real hooks and every Settings control (needs a display)
npm run smoke        # starts the real app headless and runs one session through it
npm run test:coverage
npm run format       # prettier --write
```

Node 22 or newer, on macOS, Windows or Linux. The Windows and Linux "stay over the agent's app" probes are new: a real-machine
report, good or bad, is a valuable contribution on its own. See [docs/known-limitations.md](../docs/known-limitations.md).

## Where things live

- `src/core/state.js`, `state-hooks.js`, `state-shared.js`: the pure reducer (entry and clock, the hook handlers, the
  shared rules). Every rule about pleas, thanks, panic, timing and delivery lives there and is covered by
  `test/core/state.test.js`. Change behavior there first, with a test.
- `src/agents/`: one adapter per agent (`detect`, `normalize`, `reply`). Adding an agent whose hooks can inject context
  is one file plus a line in `src/agents/index.js`.
- `src/main.js`: the composition root, wiring only. The pieces it composes: `desktop/effects.js` (what each reducer
  effect shows or sends), `desktop/view.js` (what is on screen, the bubble, the pin), `desktop/actions.js` (every
  user action, the menu, the settings view), `system/lifecycle.js` (the tick, liveness, recovery, the port move),
  `system/health.js`, `desktop/pet-window.js`, `desktop/sounds.js`, `desktop/demo-runner.js`. `src/core/` holds the logic it calls (`queue`,
  `replies`, `tag`, `phrases`, `quiet`, `coach`, `demo`; `phrases` and `replies` also own their files on disk), `src/system/` the modules that touch disk, network or the OS
  (`config`, `log`, `install`, `server`, `hosts`, `front`, `liveness`), and `src/desktop/` the Electron windows and
  menus (`tray`, `menu`, `bubbles`, `park`, `hit`, `card`, `settings-window`, `settings-view`, preloads).
- `bin/openplead-hook.js`: the stdio shim the agents run. It must never block an agent: 1.5 s ceiling, `{}` on
  any failure. It cannot `require` anything from `src/`.
- `src/renderer/`: the pet window and the settings window. No framework; a strict CSP.
- `docs/state-mapping.md`: how hooks become moods and lines. Update it when the reducer changes.

## Rules of the house

- Pleas, thanks and calm lines are delivered only through hook responses, phrased as a fact about the user. The pet
  never types, never answers a permission prompt, and never decides anything for the user.
- Keep the user informed: every queued item is shown before it goes out, and every outcome is acknowledged.
- Prettier and ESLint are the style guide; `npm run check` must pass.
- Tests first for anything in the reducer or a pure module. Renderer changes get a headless render before merging.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, …).

## Phrases

Packs of lines, in any voice or language, are the easiest contribution: see [docs/phrase-packs.md](../docs/phrase-packs.md).

The default lines live in `src/core/phrases.default.json`. Keep them polite, direct and short: the research in
[the original brief](../docs/archive/project-brief.md) is the reason the pet pleads instead of whipping.

## Media

Every image in the README and `docs/` is rendered from the real app, so it cannot drift from what Grovel does.
`npm run demo` renders the banner, the demo GIF, the pet stills and the reply card (light and dark), and fails rather
than quote a line the app cannot say. `npm run social` renders the social preview.

### Sprites

Every animation is an SVG in `assets/svg/` (CSS or SMIL animation, one file per state), rendered to a transparent
APNG (used by the pet) and a GIF preview by `scripts/render-sprites.js`. The APNG files in `assets/sprites/` are
committed, so users never need this step; the GIF previews are generated locally and not tracked.

```bash
npm run sprites                      # assets/svg/*.svg -> assets/sprites/*.{apng,gif} + index.html
open assets/sprites/index.html       # preview every state on light and dark backgrounds
node scripts/render-sprites.js assets/svg/plead-2.svg out/ --fps 12 --scale 2 --duration 1000
```

Requires `ffmpeg` on PATH. Frames are captured deterministically (the SVG clock is paused and seeked per frame).
Anatomy is checked before rendering: one `data-part="body"` (96x60), exactly two `data-part="arm"` (20x20) and
exactly four `data-part="leg"`. Clasped or raised hands move the arms rather than adding new ones, and kneeling
folds each leg instead of shortening it. Grovel has a skeleton and we respect it.

### Diagrams

The README and guide diagrams are hand-written SVG in `docs/diagrams/*.html`, one file per diagram, open them in a browser to
edit. `npm run diagrams` screenshots each one at 2x into `docs/media/`.

## Reporting a bug

Run `openplead doctor` and attach its output and the tail of `~/.openplead/openplead.log`. Say which agent, which
platform, and whether the pet was launched by a hook or by hand.
