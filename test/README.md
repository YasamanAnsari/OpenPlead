# Tests

`npm test` runs every `*.test.js` under this folder with Node's built-in runner; `npm run check` adds ESLint and
Prettier and is what CI runs. No Electron is needed: the modules under test are plain Node.

The folders mirror `src/`:

| Folder      | Covers                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `core/`     | the pure reducer and everything that reasons without a window: state, tag, phrases, replies, queue, coach, demo, quiet, apps |
| `agents/`   | the two hook adapters: payload to event, reply to hook JSON                                     |
| `desktop/`  | what the Electron window shows: menu, bubbles, tray, settings view, card, parking, hit areas   |
| `system/`   | the machine side: config, hook installation, connection, the HTTP server, front-app probes, sessions, liveness, hosts |
| `renderer/` | code shared with the pages: label capitalization                                               |
| `e2e/`      | the real server, adapters, reducer and shim driven end to end over HTTP (`http-roundtrip`)          |
| `helpers/`  | shared scaffolding, not tests: the reducer runner and temp-directory helpers                   |

Conventions:

- One file per module, named after it. A test that needs the reducer uses `helpers/reducer.js` (`run`, `hook`,
  `inTurn`) instead of its own runner.
- Tests that touch the disk write only under a temp directory from `helpers/fs.js`; nothing reaches `~/.openplead`.
  Modules that resolve the home directory when they load are isolated with `isolateHome()` before the require.
- Nothing here talks to the network beyond loopback, and nothing starts the real app. `npm run smoke` starts it
  headless in CI; `npm run live` (needs a display; CI runs it on macOS and Linux) drives a hidden copy through real hooks
  and through every Settings control, and is the check to run after touching `src/main.js` or the settings window.
- Every test title is a sentence that states the rule being checked.
