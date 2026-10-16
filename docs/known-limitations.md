# Known limitations

What OpenPlead cannot do today, and why. Dates are when the limitation was last checked.

| Area | Limitation | Why | Checked |
| --- | --- | --- | --- |
| Agents | Only Claude Code and Cursor can receive text. | They are the agents whose hooks can inject context (`additionalContext` / `additional_context`) and continue a turn (`decision: block` / `followup_message`). An agent without that cannot be pleaded with, only watched. | 2026-10-13 |
| Cursor | A plea or thanks saved for your next message reaches the agent with that turn's first tool result. | Cursor's prompt hook cannot carry text. | 2026-10-13 |
| Cursor | Cursor imports Claude Code's user hooks as well as its own, so every prompt and session start reaches the pet twice. | Cursor's third-party hook import is on by default. The pet treats a repeat within two seconds as the same prompt. | 2026-10-13 |
| Cursor | `preToolUse` is registered and answered with `{}`. | Cursor documents permission hooks as blocking on a schema mismatch; whether `{}` counts is not confirmed on a real machine. If tools stall under Cursor, remove `preToolUse` from the native entries. | 2026-10-13 |
| macOS | "Only while my agent's window is in front" needs the hook to run from the agent's own app. | The app's bundle id comes from the hook's environment, written to `~/.openplead/hosts/` at every session start and prompt. Sessions started over SSH or inside tmux carry the id of whatever started tmux. | 2026-10-13 |
| Windows, Linux | "Only while my agent's window is in front" is new and unverified on real hardware. | Windows uses a PowerShell helper (user32) and process names from the hook's ancestry; Linux uses xprop, Hyprland or sway and `/proc`. Written against the documented interfaces; please report what you see. | 2026-10-13 |
| Linux | Wayland compositors other than Hyprland and sway cannot report the front window; GNOME and KDE on Wayland fall back to showing everywhere. Global hotkeys do not work on Wayland. | Wayland has no portable active-window API. | 2026-10-13 |
| Linux | AppImage requires the shim copy in `~/.openplead/`; an upgrade re-copies it at the next install. | The AppImage mount path vanishes on exit. | 2026-10-13 |
| Windows | A packaged app needs Node on the PATH of the shell that runs hooks. | The env-prefix form that lets the app run the shim with its own binary is POSIX only. | 2026-10-13 |
| Pet | The pet is on screen only while a session is alive, unless "Show Grovel on every app" is on or the show mode is Always. | By design: Grovel lives inside your agent. | 2026-10-13 |
| Pet | Pleas older than two minutes are dropped; thanks simply expire. | A stale plea would land in an unrelated tool call. | 2026-10-13 |
| Pet | The pet never answers a permission prompt and never types. | By design. | 2026-10-13 |

## Unsigned builds

The installers are not code-signed or notarized yet. macOS blocks them until the quarantine flag is cleared, Windows
shows a SmartScreen prompt, and Homebrew will not list an unsigned cask. The npm install path is unaffected. This waits
on an Apple Developer ID; the steps are in `docs/release-checklist.md`.

## Windows and Linux: verified in CI, not yet on hardware

On every change, CI starts the app on macOS, Ubuntu (under a virtual display) and Windows, waits for it to answer on
its port, walks one agent session through the hook endpoint and stops it (`npm run smoke`). The front-app probes for
Windows (PowerShell) and Linux (xprop, Hyprland, sway) are unit-tested against captured output, but nobody has yet
watched the pet hide and show on a real Windows or Linux desktop. Reports from those desktops are the most useful
first issues.

## Replies

Reply capture is verified on Claude Code; Cursor's per-message text event (`afterAgentResponse`) is wired but has not
yet been exercised on a real Cursor session. A reply is found by its shape, a sentence
addressed to "your notes" or to OpenPlead, one that starts with thanks, or one that echoes the words of a line that
went out, so an aside phrased differently can be missed, and a sentence about the user's own "notes" file could in
rare cases be mistaken for one. The text is read only while "Ask Claude to reply" is on, and only the matched
sentence (at most two, trimmed to a bubble) is kept; the rest of the message is never stored. Claude's text is not
logged to `openplead.log`.
