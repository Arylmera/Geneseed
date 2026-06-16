# awesome-opencode additions

**Date:** 2026-06-15
**Status:** shipped

## Problem

[awesome-opencode](https://github.com/awesome-opencode/awesome-opencode) catalogues
~100 community plugins. Most are already covered by Geneseed's four plugins or are
off-philosophy (npm/vector-DB/proxy/TTS dependencies, OpenCode-only UIs). But a few
ideas are genuinely missing, zero-dependency, and fit the "enforce/act by injection,
don't just instruct" stance. This records the three that were adopted and why the
rest were skipped.

## Adopted

1. **Law XXI — "Commands Must Return"** (from *Shell Strategy*). Agents routinely
   hang on interactive commands — `git rebase -i`, pagers, REPLs, editors, unbounded
   processes — burning the context window on a shell that never returns. This is a
   pure law addition (agent discipline), runtime-agnostic, themed in all 14 voices,
   cross-referencing Law IV (IV governs *whether* to run a command; XXI governs
   *how*). Brings the law count 20 → 21.

2. **Model self-awareness** (from *Model Announcer* / *Agent Identity*). The
   `geneseed-context` block now carries a best-effort `current model:` line, read
   from the transcript's assistant `info.providerID/modelID` (the same fields the
   learn plugin reads) with a `GENESEED_MODEL` fallback. Added per request, outside
   the block cache, so one cache serves every model; omitted when unknown.

3. **Command discovery** (from *Command Inject*). The same block lists the repo's
   runnable targets — `Makefile`, `package.json` scripts (with the runner chosen by
   lockfile), `justfile`, `Taskfile` — so the agent invokes real entry points instead
   of guessing. Root-level, best-effort parse, capped at 40 per group.

4. **`geneseed-notify` plugin** (from *Opencode Notify*). A fifth plugin: on
   `session.idle` it sends a native OS notification (macOS `osascript`, Linux
   `notify-send`, Windows PowerShell balloon) so a user can step away from a long run
   and be called back. Anti-spam gate: only fires when the turn exceeded
   `GENESEED_NOTIFY_MIN_SECONDS` (default 30); subagent and `geneseed-*` throwaway
   sessions are skipped. Dependency-free, spawned detached, every failure swallowed.

## Skipped (and why)

- **Memory / safety / context / orchestration / handoff** plugins (Agent Memory,
  CC Safety Net, Cupcake, With Context MCP, Subtask2, Swarm, Handoff, …) — already
  covered by `geneseed-learn` / `geneseed-guard` / `geneseed-context` /
  `workflow` + `council` / `handoff`.
- **Heavy or off-philosophy:** Beads (issue tracker), worktree-memory-sync (Geneseed
  memory is global, not per-worktree), OTEL, proxies, auth shims, Morph fast-apply,
  and the tmux/zellij/neovim front-ends — all need dependencies or a runtime Geneseed
  deliberately avoids.
- **Dynamic context pruning** — serves the context-economy law but is the riskiest
  (mis-pruning live state); deferred to its own design pass.

## Tests

- Law XXI: doctor's theme-parity + README-badge gates enforce the `LEX_XXI` key in
  every theme and the count bump; `test_harness.py` asserts the law count is 21.
- Context extras: `tests/context_extras.test.mjs` — command discovery (make targets,
  lockfile-correct runner) and the model line (from transcript, from `GENESEED_MODEL`,
  omitted when unknown).
- Notify: `tests/notify.test.mjs` — the pure `shouldNotify` gate (long/quick/child/
  throwaway/unknown/`minMs=0`) and `lastUserMs` transcript reader. The OS spawn is a
  side effect and is not unit-tested.
- Doctor `node --check`s every plugin, including `geneseed-notify.js`.
