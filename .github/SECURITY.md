# Security

OpenPlead runs a small HTTP server on `127.0.0.1` that receives hook payloads from your coding agent and answers
with text for that agent. Nothing leaves your machine. There is no telemetry.

## What the app can and cannot do

- It reads the hook payloads Claude Code and Cursor send it and writes `~/.openplead/` (settings, phrases, a log,
  and per-session records of which app a session runs in and the agent's process id).
- It edits `~/.claude/settings.json` and `~/.cursor/hooks.json` only to add or remove its own entries, keeping a
  `.bak`, and only when you connect or disconnect.
- It never answers a permission prompt, never types, and never runs anything the agent asks for.
- Delivered lines are phrased as a fact about the user, never as an instruction from a tool.

## Hardening in place

- The server answers only requests whose `Host` header is a loopback name on its own port, which closes DNS
  rebinding from a web page. POSTs that look like they come from a browser (an `Origin` or `Sec-Fetch-Site`
  header, or a content type other than JSON) are refused, as are bodies over 8 MB.
- Hook payloads are validated before use; session ids are checked before they name a file; the settings window
  renders hook-supplied text as text, under a strict content security policy, with navigation blocked.

## Supported versions

The latest release only.

## Reporting

Use the repository's private vulnerability reporting form (Security → Report a vulnerability). Do not open a public
issue for a security problem. Please include the output of `openplead doctor` if it is relevant.
