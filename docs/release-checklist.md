# Release checklist

What a release takes, in order. The first releases are unsigned (no Apple Developer ID yet); the last section lists
what changes once there is one.

## Before the tag

1. `CHANGELOG.md`: rename the `Unreleased` heading to the version and today's date; start a new empty `Unreleased`.
2. `package.json`: set `version` (and run `npm install` so the lockfile follows).
3. `npm run check` (lint, format, tests) and `npm run smoke` (the app starts, serves, takes hooks, stops).
4. `npm run dist -- --dir` and open `dist/mac-arm64/OpenPlead.app` once: the tray icon, the menu, Settings.
5. `npm pack --dry-run`: the tarball lists `bin/`, `src/`, `assets/sprites/*.apng`, `assets/tray/*.png`,
   `assets/icon.png`, `LICENSE` and `NOTICE`, and nothing from `test/` or `docs/`.
6. Screenshots and GIFs are current: `npm run tray`, `npm run demo` (the README GIFs and the pet stills) if the renderer
   or the phrases changed, and `npm run diagrams` if the architecture changed.
7. `node scripts/render-social.js` if the pitch or the look changed; upload `docs/media/social-preview.png` in the repository's
   settings (Social preview) once the repository exists.

## The tag

1. Push the branch; the `check` workflow must be green on all three platforms, including the `smoke` job.
2. Tag `vX.Y.Z` and push the tag. The `release` workflow builds the installers and attaches them to a draft release.
3. Edit the draft: paste the changelog section, add the unsigned-build note from the README's install section, publish.
4. `npm publish` (runs `check` first). The README's install line is the npm path.
5. Repository settings: turn on private vulnerability reporting (SECURITY.md points there); description, topics (`claude-code`, `cursor`, `desktop-pet`, `electron`, `developer-tools`,
   `ai-agents`), social preview, Discussions on.

## After

- Answer issues within a day for the first weeks; label starter issues `good first issue`.
- Watch Insights → Traffic for referrers, and the npm download count, so the next release lands while attention lasts.

## When an Apple Developer ID exists

- Add repository secrets `CSC_LINK` and `CSC_KEY_PASSWORD` (the certificate), and for notarization either the App
  Store Connect API key set (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, preferred) or `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
- In `package.json`, remove `build.mac.identity: "-"` and `hardenedRuntime: false` (the defaults sign with the Developer
  ID and the hardened runtime) and add `"notarize": true`; electron-builder signs and notarizes on the tag.
- Remove the quarantine note from the README; submit a Homebrew cask; add `electron-updater` with the GitHub provider
  (updates are refused for unsigned apps on macOS, so this waits for signing).
- A Windows code-signing certificate removes the SmartScreen prompt the same way.
