# Development

## Contract

- `/pause` calls `ctx.requestPause(): boolean`. Idle is a no-op; repeated requests are harmless.
- Pause is scheduling state, not cancellation. It does not abort the model or any tool signal.
- Finish the current response and its entire tool batch, including nested codemode work. Persist results before stopping.
- `finishTurn` returns `end`; the low-level loop rechecks after awaited `turn_end` observers. A request during preparation is checked before streaming the next response.
- The session skips automatic retries, compaction and pre-settlement continuation once pause is requested. Already-running preparation or extension callbacks are allowed to finish.
- Steering/follow-up queues are retained. Extension-triggered messages remain queued, including messages sent from `agent_settled`.
- `agent_settled` reports `paused: true`, separately from `aborted`. The next ordinary user prompt clears pause and resumes scheduling. There is no `/resume` command.
- No pause marker is persisted or sent to the model. Pause does not alter declarations, system prompts, history or cache keys. Other extensions can still append or transform context through their normal handlers. Provider cache retention is not guaranteed.
- Pause is process-local. Existing extensions such as pi-goal keep their own state; `/pause` does not change goal status or its timer. Explicit extension commands that only enqueue messages do not clear pause.

## Setup

Requires Pi 1.3.0. From this repository:

```bash
node scripts/patch.mjs /path/to/node_modules/@earendil-works --check
node scripts/patch.mjs /path/to/node_modules/@earendil-works
pi install /path/to/pi-pause
```

Restart Pi; `/reload` does not reload core modules. To undo, run the same patch command with `--restore`, remove the extension with `pi remove /path/to/pi-pause`, then restart.

## Core patch

`scripts/changes.mjs` contains exact edits to the published JS and declarations of `pi-coding-agent` and `pi-agent-core` 1.3.0. No source checkout or build is required. Other versions are rejected.

`scripts/patch.mjs` validates every replacement before writing, backs up originals, and checks installed-file hashes before declaring an installation patched or restoring it. Backups live in `node_modules/@earendil-works/.pi-pause-backup`. Do not patch while an installation is being upgraded. Stop Pi first; restart after patching or restoring. A runtime upgrade may replace the patch; do not blindly apply it to a new version.

## Tests

```bash
PI_PAUSE_NODE_MODULES=/path/to/pi/runtime/node_modules node --test test/pause.test.mjs
npm run check
```

Tests copy the two affected packages into a temporary installation and patch only those copies. Other dependencies are linked read-only. A mock provider exercises the real SDK and codemode, without credentials or network calls. The host installation is not changed.

Coverage includes response completion, whole tool batches, nested tools, queues, extension-triggered continuations, retry suppression, preparation/settlement races, startup, prefix preservation on resume, and patch restore integrity.
