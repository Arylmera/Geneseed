# 0007 — Gates fail closed, each host to its own ceiling

- **Status:** Accepted
- **Date:** 2026-10 (`onFailure: "block"` since 4.0.0, #241); amended 2026-11 (OpenCode 2 asks on a gate error)

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
(`adapters/opencode/plugins/geneseed-guard.js`) on OpenCode 1 has the same ask-tier gap through a
different mechanism: a block there is a thrown error, and its own inspection code logs an internal
failure and allows the call rather than throwing, the opposite of Claude's ask on `gate-error`,
because failing closed with no ask tier is a lockout nothing in the host can answer.

Amended 2026-11. "OpenCode has no ask tier" no longer holds on OpenCode 2: its
`permission.hook("evaluate")` runs for a tool's `permission.assert` and may raise the effect to
`ask`, which the guard already uses for a rule-store write. A V2 with no permission domain, and
every OpenCode 1, still have no prompt a plugin can raise. The same amendment ends a second fault:
the guard ran all its gates inside one `try`, so an error in an early gate also skipped the secret
scan, the catastrophic-shell and loss gates and the wiki gate behind it, and left no record.

## Decision

A gate fails closed on everything it can evaluate and has an opinion on, to the ceiling its host
can hold. Claude Code gets the fullest answer: every evaluation failure asks, and every detectable
launch failure now blocks too. Bob holds only its judgement-free rules (`BLOCK_RULES`) to a hard
block; a rule needing the user's call, and a crashed gate, degrade to a warning. OpenCode's guard
blocks what it can evaluate. On its own internal errors, since 2026-11:

- Every gate runs in isolation on both majors. One gate's error is logged, ledgered once per call
  as `gate-error`, and never stops the next gate, whose refusal still stands.
- OpenCode 2 with the permission domain asks: the call is marked by its id, and `evaluate` raises
  its first `permission.assert` to `ask` with the `gate-error` text. A call that asserts nothing
  is never asked about, and runs.
- OpenCode 1, and a V2 with no permission domain, fail open, the same ceiling as Bob's
  `gate-error`, and tell the user once per gate per process (a V1 toast, a V2 synthetic message).

## Consequences

- `tests/unit/hook_gates.test.mjs` and the hook fuzz suite exercise `guardGate`'s ask-on-throw
  path; `tests/plugins/guard.test.mjs` exercises the guard plugin's fail-open path and the gate
  that still refuses behind a failed one, and `tests/plugins/opencode_v2.test.mjs` the V2 ask.
- A new gate rule decides for itself whether it belongs in `BLOCK_RULES`; the default is the
  warning tier.
- `onFailure: "block"` is Claude-only: Bob and OpenCode 1 have no ask tier to fall back to, and
  OpenCode 2's is reached from inside the plugin, which a launch failure never loads. See
  [0008](0008-host-parity-ceiling-of-the-weakest-host.md) for why a feature the weakest host
  cannot hold does not ship piecemeal, and
  [`docs/concepts/enforcement-table.md`](../concepts/enforcement-table.md) for the full matrix.
