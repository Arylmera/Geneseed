# Ponytail — minimal-code discipline as a skill + plugin

**Date:** 2026-06-16
**Status:** draft

## Problem

Coding agents drift toward *more* code: speculative abstractions, options nobody
asked for, a framework where a function would do. The harness already discourages
this in pieces — Law II (one intent), Law XII (search before creating), the
`pragmatist` agent, and the new Law XXV (smallest viable diff) — but there is no
single, opt-in mode that says "be a lazy senior dev: write the least code that
fully works, and nothing more." Upstream `ponytail`
(DietrichGebert/ponytail) packages exactly that persona, and users asked for it.

Two distinct needs sit behind one idea:

- **One-shot:** "for this task, take the simplest path." A procedure to invoke.
- **Sustained:** "stay lazy for the rest of this session, and don't drift back."
  A rule re-asserted every turn.

A skill answers the first; a sustained system-prompt injection answers the second.

## Fix

Ship ponytail in two complementary, **opt-in** halves, distilled into Geneseed's
voice rather than ported verbatim.

### Part 1 — the skill (`src/skills/ponytail.md`)

The invokable half. Triggers on `ponytail`, "be lazy", "simplest path", or an
over-engineering complaint. Carries the YAGNI ladder, three intensity levels
(`lite` / `full` / `ultra`), the `ponytail:` shortcut-comment convention, and the
**never-simplify guardrails** (security, correctness, and explicit requirements are
never sacrificed for brevity). It is a skill, **not a Law**: minimal-code is a
preference the user opts into, not a universal safety rule binding every task.

### Part 2 — the plugin (`adapters/opencode/plugins/geneseed-ponytail.js`)

The sustained half, the 6th OpenCode plugin. Two hooks mirror upstream:

1. `experimental.chat.system.transform` — appends the ruleset to the system
   prompt each turn, at the active level, so the discipline does not drift as the
   session grows.
2. `command.execute.before` — intercepts `/ponytail lite|full|ultra|off` and
   persists the chosen level to `~/.config/opencode/.geneseed-ponytail`.

**Defaults OFF**, unlike upstream's always-on default, to preserve opt-in
semantics; `GENESEED_PONYTAIL=lite|full|ultra` flips the default for new installs.
All failures are swallowed (the plugin can never break a turn), and the pure
helpers (`normalizeMode`, `defaultMode`, `ponytailInstructions`) are exported for
tests.

### Why both

The skill is discoverable and reviewable (it themes, it passes `doctor` parity);
the plugin is the anti-drift enforcement the skill cannot provide on its own. The
skill is the one-shot; the plugin is the sustained mode — and `/ponytail off`
returns to normal at any time.

## Verification

- `python -m unittest discover -s tests -p "test_*.py"` — generator/CLI suite green.
- `tests/ponytail.test.mjs` — 5 cases over the pure helpers, wired into CI.
- `build.py --emit opencode` ships the plugin at `.opencode/plugins/` and
  `node --check` parses it.
- `doctor` reports zero ponytail/skill findings; `DESC_PONYTAIL` defined in every
  theme for parity.
