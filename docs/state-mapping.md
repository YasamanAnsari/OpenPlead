# State mapping

How a hook becomes a mood and, when it can, a line to the agent. The adapters in `src/agents/` turn hook names into
internal events; the reducer in `src/core/state.js` turns events into moods and effects; `src/main.js` only performs
effects. Current as of 2026-10-13.

| Internal event | Claude Code | Cursor | Pet | Can carry text |
| --- | --- | --- | --- | --- |
| session_start | `SessionStart` (command hook, async) | `sessionStart` | wakes; session counted; app and process recorded | no |
| turn_start | `UserPromptSubmit` (command hook) | `beforeSubmitPrompt` | working; a turn already open means the previous one was interrupted ("oh"); a repeat within 2 s is the same prompt | Claude Code yes, Cursor no |
| tool_start | `PreToolUse` | `preToolUse` | working | Claude Code yes, Cursor no |
| tool_ok | `PostToolUse` | `postToolUse` | working; error streak resets; joy-cry when this command failed earlier | yes |
| tool_fail | `PostToolUseFailure` | `postToolUseFailure` (not a denied permission) | panic at 2 in a row, with a calm line | yes (calm line only) |
| assistant_text | `MessageDisplay` (per displayed batch; only registered while "Ask Claude to reply" is on) | `afterAgentResponse` (per message; same condition) | if the text answers a line that went out this turn: the reply in the bubble with the agent's name, a bow, a line in `~/.openplead/replies.jsonl`; each line answered at most once | no |
| permission_wait | `Notification` (`permission_prompt`) | — | nameplate says "needs your OK"; deliveries wait | no |
| turn_end ok | `Stop` | `stop` (`completed`) | thank; ladder resets; a leftover plea is delivered here and the agent keeps working | yes (plea only) |
| turn_end aborted | inferred | `stop` (`aborted`) | "oh"; queue cleared and reported as dropped | no |
| turn_end error | `StopFailure` | `stop` (`error`) | panic flash; a leftover plea moves to the next prompt | no |
| session_end | `SessionEnd`, or the agent's process is gone | `sessionEnd` | goodbye wave with the run's tally when it was the last session | no |
| tick (1 s) | — | — | 90 s of silence mid-turn queues one nudge; 5 min counts as an interrupt; 60 s without hooks sleeps; 10 min without hooks forgets a session whose agent process is unknown or gone (a session whose process still runs is kept, however long you think) | — |

Queue rules: one plea at the highest clicked level, chosen words shown in the bubble until delivered; thanks, a
deadline note, a nudge, a question after three failures and the Reassure lines wait for the next chance to
speak. Nothing is delivered during a permission prompt or from a subagent. Every delivered line is phrased as a
fact about the user.

A click while the agent works queues the plea for its next tool call (two minutes, then dropped). A click while the
agent waits for you saves the plea for your next message to that session, replacing a thank-you waiting there; a
saved plea does not expire, and once it goes out the turn's clicks climb on from its level. With no session the pet
only says so.
