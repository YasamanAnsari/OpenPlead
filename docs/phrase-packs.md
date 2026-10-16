# Phrase packs

Everything Grovel says comes from one JSON file, `~/.openplead/phrases.json`. A phrase pack is a small JSON file in
the flat format below, written by someone else: a different voice, a different language, a theme. Loading one
replaces the sets it names and leaves the rest alone. (The phrases file itself uses a nested shape, `{"plea": {"1":
[...]}}`, so it is not a pack; the Messages tab and `Reset to defaults` cover that file.)

## The format

An object with one key per set. Each set is a list of lines; one is picked at random, never the same twice in a row.

| Set           | When it is said                                                      |
| ------------- | -------------------------------------------------------------------- |
| `plea.1`      | First click: polite                                                  |
| `plea.2`      | Second click: pleading                                               |
| `plea.3`      | Third click: kneeling                                                |
| `plea.4`      | Fourth click: bargaining                                             |
| `plea.5`      | Fifth click: the full sob                                            |
| `thanks`      | After a finished turn, with the next message                         |
| `calm`        | After two failures in a row, instead of a plea                       |
| `deadline`    | The deadline note                                                    |
| `thinking`    | The nudge after ninety seconds of silence                            |
| `suspicious`  | After three failures and a clean finish                              |
| `hug`, `zen`, `apology` | Reassure Claude, in the menu (it's okay / take your time / sorry)  |

Rules the app checks: every line is a non-empty string of at most 240 characters; a set has at least one line; unknown
keys are refused. Lines reach the agent phrased as a fact about you ("The user pressed OpenPlead's plead button (level 3 of 5) and
says: …" for pleas, "The user, through OpenPlead, says: …" for the rest), so write them as something a person would
say to the agent.

```json
{
  "plea.1": ["I have complete faith in you. I have also opened a second tab. Just in case."],
  "plea.5": ["I SHALL NAME MY FIRSTBORN PROCESS AFTER YOU! THE PID IS YOURS!"],
  "thanks": ["Status updated: 'concerning' → 'beloved'."]
}
```

The built-in lines live in `src/core/phrases.default.json`. `assets/phrase-packs/default.json` is a pack with those
lines plus a few extras; a test keeps it complete.

## Loading a pack

- Settings → Messages → **Import a pack…** picks a JSON file, validates it, and merges it over the current sets.
- Or open a set on the Messages tab in Settings, add or edit its lines (one bulleted row each) and press Save.
- Or edit `~/.openplead/phrases.json` directly; the app reads it fresh for every line it picks.

**Reset to defaults** on the Messages tab brings the built-in lines back.

## Contributing a pack

Add `assets/phrase-packs/<name>.json` with a one-line description and your name in a `_credit` field, which the app
ignores, and open a pull request. Keep the voice: funny, polite, never cruel to the agent or to the person reading.
Packs in other languages are welcome; name them `<name>.<language>.json`.
