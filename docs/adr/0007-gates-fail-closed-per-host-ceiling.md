# 0007 — Gates fail closed, each host to its own ceiling

- **Status:** Accepted
- **Date:** 2026-10 (`onFailure: "block"` since 4.0.0, #241)

## Context

A hook gate fails two ways. It can run and decide, the normal case, always exiting 0 and
signalling through stdout (`guardGate` in `js/hosts/hooks.mjs`). Or it can fail to evaluate at all,
from an unreadable payload or a bug; `guardGate` turns that into an `ask` carrying the error, never
a silent allow.

A third failure sits above the gate's own code: the process that should run it never starts, or
exits on a bad argument. Claude Code's `onFailure: "block"` turns such a launch failure into a
blocked tool call, but only safely once an argv error cannot reach it: the machine-wide,
last-writer-wins hook shim can hand an older `geneseed-hook` a flag only a newer install knows. An
argv error on a gate verb now always exits 0, so a stale shim no longer blocks every tool call once
`onFailure: "block"` is on.

Not every host can hold that ceiling. Bob's `PreToolUse` has no ask tier: stdout is ignored and the
only refusal is exit code 2. A hard block on every rule would leave Bob unable to commit at all, so
`BLOCK_RULES` holds only the checks that admit no judgement call, and everything else, including a
crashed gate, degrades to a warning and an allow. The OpenCode guard plugin
(`adapters/opencode/plugins/geneseed-guard.js`) has the same ask-tier gap through a different
mechanism: a block there is a thrown error, and its own inspection code logs an internal failure
and allows the call rather than throwing, the opposite of Claude's ask on `gate-error`, because
failing closed with no ask tier is a lockout nothing in the host can answer.

## Decision

A gate fails closed on everything it can evaluate and has an opinion on, to the ceiling its host
can hold. Claude Code gets the fullest answer: every evaluation failure asks, and every detectable
launch failure now blocks too. Bob holds only its judgement-free rules (`BLOCK_RULES`) to a hard
block; a rule needing the user's call, and a crashed gate, degrade to a warning. OpenCode's guard
blocks what it can evaluate and fails open on its own internal errors, the same ceiling as Bob's
`gate-error`.

## Consequences

- `tests/unit/hook_gates.test.mjs` and the hook fuzz suite exercise `guardGate`'s ask-on-throw
  path; `tests/plugins/guard.test.mjs` exercises the guard plugin's fail-open path.
- A new gate rule decides for itself whether it belongs in `BLOCK_RULES`; the default is the
  warning tier.
- `onFailure: "block"` is Claude-only, since the other hosts have no ask tier to fall back to. See
  [0008](0008-host-parity-ceiling-of-the-weakest-host.md) for why a feature the weakest host
  cannot hold does not ship piecemeal, and
  [`docs/concepts/enforcement-table.md`](../concepts/enforcement-table.md) for the full matrix.
