# 0007 — Gates fail closed, each host to its own ceiling

- **Status:** Accepted
- **Date:** 2026-10 (`onFailure: "block"` since Task 1 of the host-opportunities series)

## Context

A hook gate can fail two different ways, and the harness treats them differently. It can run and
decide — the normal case, always exit 0, signalling through stdout (`js/hosts/hooks.mjs`'s
`guardGate`). Or it can fail to evaluate at all: an unreadable payload, a path primitive that
throws, a bug. `guardGate` wraps every gate verb so the second case becomes an `ask` carrying the
error as its reason, never a silent allow (`'Geneseed gate error — ...'`, `js/hosts/hooks.mjs:308`).

A third failure sits one layer up, outside the gate's own code: the process that was supposed to
run it never starts, or starts and exits on a bad argument. Before Task 1, `bin/geneseed-hook.mjs`
answered an unknown flag with exit 1, and on Claude Code a non-zero exit from a `PreToolUse` hook
was simply ignored (the default `onFailure` behaviour) — so a stale machine-wide shim handed a flag
only a newer install knows (`--no-consent`, say) silently stopped gating, with nobody told. Claude
Code v2.1.295 added `onFailure: "block"`: a hook that cannot start, times out, or exits anything
but 0 or 2 now blocks the tool call instead. That is the right default for a gate — but only once
an argv error cannot reach it. `bin/geneseed-hook.mjs` answers an unknown verb with exit 1 always
(never 2, which is the one code that blocks a Claude or Bob call); for the three gate verbs
specifically, an argv error now exits 0 instead, so the lockout `onFailure: "block"` would otherwise
produce becomes "the gate is silent this one call" (`bin/geneseed-hook.mjs`, `GATE_VERBS`
comment, and the `main` argv-error path). Turning `onFailure: "block"` on before this fix would
have meant that a stale machine-wide shim handed a newer flag blocked every Bash and Write call on
the machine.

Not every host can hold the same ceiling. Bob's `PreToolUse` has no ask tier: stdout is ignored and
the only refusal is exit code 2 (`js/hosts/hooks.mjs:219-223`). A hard block on every rule would
leave Bob unable to commit at all, so `BLOCK_RULES` holds only the checks that admit no judgement
call — Law I (secrets), Law IV (destructive git), rigor-5 (External Gate: a protected check the
agent could edit is not a check), and ops-2 (a root-scan, where a warning would let a multi-hour
scan start anyway) — and everything else, including `gate-error` itself, degrades to a stderr line
and an allow (`js/hosts/hooks.mjs:226-237`, `BLOCK_RULES`). A crashed gate blocking every tool call
on a host with no prompt to clear it would be a lockout, not a safeguard.

OpenCode's guard plugin (`adapters/opencode/plugins/geneseed-guard.js`) has the same ask-tier gap —
upstream declares a `permission.ask` hook type but never calls it (`geneseed-guard.js:21-29`) — but
a different mechanism: it is not a separate verb reading stdin, it runs inside the host's own
`tool.execute.before`, and a block is a thrown error. Its own inspection code is wrapped so that an
internal failure is logged and the call allowed, not thrown (`geneseed-guard.js:627-631`,
`// any inspection error must never break a tool call`) — the deliberate opposite of Claude's
`gate-error` ask, for the same reason Bob's `gate-error` is a warning: with no ask tier, failing
closed on an inspection bug would throw on every tool call, a lockout nothing in the host can
answer. The checks it CAN enforce (secrets, destructive git, the root scan, protected checks) still
block, by throwing (`geneseed-guard.js:560-565`).

## Decision

A gate fails closed on everything it can evaluate and has an opinion on, to the ceiling its host
can hold:

- **Claude Code** gets the fullest answer: every gate-evaluation failure becomes an `ask`
  (`guardGate`), and since the argv-error fix, every verb-launch failure the host itself detects
  now blocks too (`onFailure: "block"`, Claude only — `js/hosts/settings.mjs`'s `onFailureBlock`).
- **Bob** has no ask tier, so only the judgement-free rules (`BLOCK_RULES`) are worth a hard
  block; a rule that needs the user's call (process-1, process-5) degrades to a warning instead of
  locking Bob out of committing, and so does a crashed gate.
- **OpenCode**'s plugin blocks what it can evaluate (secrets, destructive git, the root scan,
  protected checks) and fails OPEN on its own internal errors — the same ceiling as Bob's
  `gate-error`, reached through a different mechanism (a caught exception instead of a warning
  line), because there is no ask tier here either and the alternative is a lockout.
- The machine-wide, last-writer-wins hook shim means an older checkout's `bin/geneseed-hook.mjs`
  can be handed a flag it has never heard of; an argv error on a GATE verb always exits 0, so
  `onFailure: "block"` on Claude never turns a stale shim into a blocked machine.

## Consequences

- `tests/unit/hook_gates.test.mjs` and `fuzz/*.fuzz.mjs` exercise `guardGate`'s ask-on-throw path;
  `tests/plugins/guard.test.mjs` exercises the OpenCode guard's fail-open path and keeps its
  `rootScan` constants in step with `js/hosts/hooks.mjs`'s.
- A new gate rule decides for itself whether it belongs in Bob's `BLOCK_RULES` — the default for a
  new rule is the warning tier, and `BLOCK_RULES` is the exception that needs a reason as sharp as
  Law I's or Law IV's.
- `onFailure: "block"` is Claude-only. Giving Bob or OpenCode an equivalent would need an ask tier
  neither host exposes; see [0008](0008-host-parity-ceiling-of-the-weakest-host.md) for why a
  feature the weakest host cannot hold does not ship piecemeal to the hosts that can.
