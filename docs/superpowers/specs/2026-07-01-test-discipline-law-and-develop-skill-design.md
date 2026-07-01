# Test discipline: Law XXXV + `develop` skill — design

**Date:** 2026-07-01
**Status:** approved design, pre-implementation
**Author:** brainstormed with the user

## Problem

During development work the agent should, on every touched part of the code:

1. **Run the affected tests after modifying it** — a standing regression reflex, not a one-off verification at the end.
2. **Write tests covering the code it authored** — a default obligation, not an opt-in.

Neither is currently a standing rule in Geneseed's emitted footprint.

## What already exists (reviewed)

Geneseed emits a runtime-agnostic instruction footprint — 34 universal laws + agents + skills — themed at build time across 14 themes, to Claude Code and OpenCode. The pieces closest to the ask:

| Ask | Closest existing thing | Why it does not already cover it |
|---|---|---|
| Run tests after each change | **Law III** — "Run the verification command and read its output before claiming work is done… show that output as evidence" | Framed as *before claiming done*, not as an *after-every-touched-area* reflex; nothing mandates running the **affected** suite mid-work. |
| Write tests on AI-written code | **`tdd` skill** (test-first, opt-in), **`tester` agent** (dispatched), **Law XXVII** (honest/deterministic tests) | `tdd` is a skill the agent must choose to invoke; it cannot bind as a standing rule. XXVII governs test *quality*, not test *existence*. No law makes coverage of authored code a default. |

The genuinely missing rule is a standing **coverage obligation**: code the agent authors is not done until tests cover its behaviour and the affected suite runs green.

## Decision: new Law XXXV, not a strengthen — plus a new `develop` skill

**Considered and rejected: folding into existing laws.** The *run-after-change* half is largely Law III already, but the *coverage obligation* has no existing law whose domain fits it — Law III is verification-of-claims, Law XXVII is test *honesty*, and `tdd` is an opt-in skill that cannot bind as a standing rule. Bolting a genuinely new intent onto Law III (already the densest law in the file) or onto Law XXVII would violate the file's "one intent per law, named by domain" spirit and bury the new obligation in an unrelated law's paragraph.

**Chosen: a dedicated Law XXXV** that makes coverage the mandate and *defers* the run-and-show mechanics to Law III and test-honesty to Law XXVII rather than restating them — the same counterpart cross-referencing the file already uses (Law XI ↔ XVII, Law XII ↔ XXXIII).

**Plus a `develop` skill** as the operational *how* the law points to — the change-loop that `workflow` (deterministic orchestration) and `tdd` (only the test-first phase) do not cover. Law-plus-skill is the idiomatic pattern here (Law V ↔ skills; Law XXVII ↔ `tdd`): the law is the standing obligation, the skill is the loop that satisfies it. This is not duplication — `tdd` is a phase inside the `develop` loop, which `develop` references rather than restates.

`develop` was preferred over the name `implement` for consistency with the imperative, domain-named skill set (`plan`, `ship`, `refactor`, `commit`). `workflow` is already taken (multi-agent orchestration).

## Law XXXV text (`src/laws/universal.md`)

Appended after Law XXXIV, using the same `{{LAW}}` / `{{LEX_XXXV}}` token style:

> **{{LAW}} XXXV — {{LEX_XXXV}}**
> Code you author is not done until its behaviour is covered by a test you wrote and the affected tests run green. When you add or change behaviour that can be expressed as a test, write that test — new behaviour ships with the test that pins it, a bug fix with the test that reproduces it first (the tdd {{SKILL}} drives this). After each change, run the tests the change could affect — not the whole suite each time ({{LAW}} XV), the ones whose behaviour you touched — and read the output before moving on; a change left unrun is a regression you have not yet noticed. Verify against the project's real runner and show the result as evidence ({{LAW}} III); assert on observable behaviour, deterministically ({{LAW}} XXVII). Where the project has no suite or the change is genuinely untestable — a doc, a constant, a config — say so rather than invent a test; where a real test is out of scope, name the gap and stop rather than ship untested behaviour in silence ({{LAW}} II, {{LAW}} XXIV). Tests written after the code still guard the next change. The code you cannot re-verify on demand is the code you do not actually control.

**Proportionality is built into the wording** so the law does not overreach: no suite / untestable change → say so, don't invent a test; real test but out of scope → name the gap and stop (Law II, Law XXIV); affected tests only, not the full suite each time (Law XV).

## `develop` skill (`src/skills/develop.md`)

Authored from `src/skills/_template.md`, with the `{{SKILL}}` / `DESC_DEVELOP` token style.

- **Purpose line (`DESC_DEVELOP`):** drive a code change through the cover-and-verify loop — smallest change, tests written for it, affected suite green, committed one slice at a time.
- **Trigger:** implementing a feature, fixing a bug, or changing code behaviour in a repo that has (or should have) a test suite.
- **Procedure:**
  1. Orient on the project's own docs for what you are about to touch ({{LAW}} XVII).
  2. Make the smallest change that advances the task ({{LAW}} XXV).
  3. Cover the behaviour — test-first via [tdd](tdd.md) where the target is known up front; otherwise write the covering test alongside the change ({{LAW}} XXXV).
  4. Run the **affected** tests and read the output ({{LAW}} III); on failure, diagnose the cause, do not mask it ({{LAW}} XXIV).
  5. Tidy the green code via [refactor](refactor.md).
  6. Commit the green slice via [commit](commit.md) ({{LAW}} XX).
  7. Loop one slice at a time. Dispatch the [tester](tester.md) agent for heavier or unfamiliar coverage.
- **Done when:** behaviour changed, covered by tests written this session, the affected suite green with output shown, each slice committed.
- **Self-improvement:** standard skill self-improvement footer (copied from `_template.md`).

## Implementation touch-points (verified against the tree; audit-corrected)

This table was rebuilt after a five-axis adversarial audit of the tree (see "Audit" below). The original draft missed two `doctor`-gated **blockers** (`SKILL_CLASS`, and the precise nature of the theme gate) and several ungated prose mirrors. `[gated]` = `doctor`/tests fail if you forget it; `[ungated]` = nothing catches a mistake, so it must be edited by hand and eyeballed.

| File(s) | Change | Gate |
|---|---|---|
| `src/laws/universal.md` | append Law XXXV after XXXIV | `[gated]` unresolved-token gate (`_harness_build.py:92-93`) flags a raw `{{LEX_XXXV}}` in emitted output if no theme defines the label |
| `themes/*.json` — **all 14 real themes**, in the *same* change | add `LEX_XXXV` (short themed label, e.g. neutral "Cover and Verify") **and** `DESC_DEVELOP` (themed purpose prose) | `[gated]` parity gate (`_theme_parity_problems`, `_harness_build.py:98-115`) — see gate mechanics below |
| `themes/_TEMPLATE.json` | add the two tokens **for authoring correctness** so future themes inherit the placeholders | `[ungated]` — `_`-prefixed scaffolds are *excluded* from the parity set (`theme_files()`, `_build_render.py:18-23`; `test_harness.py:138-147`). Omitting it will **not** fail the build; it is good hygiene, not a gate requirement |
| `src/skills/develop.md` | new skill file from `_template.md` | `[gated]` — must resolve for the AGENT.md table + `SKILL_CLASS` gates below |
| `rituals/_harness_tui.py` | **BLOCKER** — add `"develop": "build"` to the `SKILL_CLASS` dict (line 278; `develop` is a build-loop skill, same category as `tdd`/`refactor`/`debug`) | `[gated]` `_count_table_problems` (`_harness_build.py:328-333`; `test_harness.py:156`) fails: `skills/develop.md has no category in SKILL_CLASS` |
| `AGENT.md.tmpl` | add a `develop` row to the skills table | `[gated]` `_count_table_problems` (`_harness_build.py:319-324`) flags a skill file missing from the table |
| `README.md` | **badges** (gated): `skills-38`→`39` (line 12) and `laws-34`→`35` (line 14). **Prose** (ungated): `:144` "34 universal laws" → "35" (and optionally append "cover-and-verify" before the trailing `…`); `:146` skills count `(37)`→`(39)` and add `develop` to the enumerated list | badges `[gated]` by `_count_table_problems` (`_harness_build.py:348-351`, badge regex only); the two prose lines `[ungated]` |
| `rituals/_web_core.py` | **Prose** (ungated): law count `34`→`35` at lines 130 and 181; add `[[develop]]` to the skills wikilink list at 200-207 (see pre-existing-drift note on the `25` count) | `[ungated]` — no gate scans this file's prose |
| `tests/test_harness.py` | update the two law-count assertions `34` → `35` (lines ~365 and ~742) | `[gated]` the tests themselves |
| verify | `python rituals/harness.py doctor --all` and `python -m unittest discover -s tests`, plus a real emit of one theme | — |

### Theme parity gate — how it actually works (audit correction)

The parity gate is **not** a presence check for `LEX_XXXV`/`DESC_DEVELOP` against a template. It is a **cross-theme union comparison** (`_harness_build.py:110-114`): `allkeys = union(every theme's keys)`, then each theme is flagged for any key in `allkeys` it lacks. Consequences that drive the implementation:

- The two tokens must be added to **all 14 real themes together** — all-or-nothing. A *partial* edit (some themes but not all) is exactly what trips the gate.
- If **all 14** were forgotten, the parity gate would stay green (the keys never enter `allkeys`) — but the omission is still caught downstream by the **unresolved-token gate** (`{{LEX_XXXV}}` / `{{DESC_DEVELOP}}` would render raw in the emitted AGENT.md and skill file) and by the emit step in verification. So the safety net exists, just not where the original spec claimed.
- `_TEMPLATE.json` is outside the parity set entirely (`_`-prefixed), so it is authoring hygiene, not a gate.

### Notes

- OpenCode themes (`themes/opencode/*.json`) are colour-only (accent palettes), carry **no** `LEX_`/`DESC_` tokens, and are correctly excluded — no change there.
- The `develop` skill references only files that already exist — `src/skills/tdd.md`, `refactor.md`, `commit.md`, and `src/agents/tester.md` (all confirmed present) — so no cross-reference dangles.
- The design touches no OpenCode adapter logic; both hosts receive the new law and skill through the normal emit path.

### Pre-existing drift (flagged, out of scope for this change)

The audit surfaced ungated prose mirrors that are **already** stale, independent of this change — a `Law II` scope boundary:

- `README.md:146` skills prose reads `(37)` while the gated badge already reads `skills-38` — a pre-existing off-by-one. This change sets that prose to the correct post-change value `(39)`, which incidentally reconciles the pre-existing drift because the line is being edited anyway; called out here for consent.
- `rituals/_web_core.py:200-207` hardcodes `25 repeatable workflows` while the true count is 38 (→39) — drifted by 13. This change adds `[[develop]]` to the list but does **not** silently rewrite `25`→`39`; fixing that stale count is a separate defect.
- **Recommendation (separate task):** these prose/count mirrors (`README.md:144/146`, `_web_core.py:130/181/200-207`) are ungated and structurally drift-prone. A follow-up should either gate them (extend `_count_table_problems` to assert the prose mirrors) or derive them from the source counts. Out of scope here; recorded so it is not lost.

## Testing / verification

1. `python rituals/harness.py doctor --all` — catches the gated touch-points: `SKILL_CLASS` coverage, the AGENT.md skills-table row, README `laws`/`skills` badge counts, cross-theme parity (all-or-nothing across the 14 themes), and unresolved `{{...}}` tokens in emitted output.
2. `python -m unittest discover -s tests` — full suite, including the two updated law-count assertions in `test_harness.py` and `_count_table_problems() == []` (`test_harness.py:156`).
3. A real emit of at least one theme, confirming Law XXXV renders with its themed label and `develop` renders with its themed purpose in the emitted footprint for both hosts — this is what would surface a token forgotten in **all** 14 themes (which the parity gate alone would miss).
4. **Manual eyeball of the ungated prose mirrors** — no gate covers `README.md:144/146` or `rituals/_web_core.py:130/181/200-207`, so confirm those by hand.

## Out of scope

- No deterministic PostToolUse hook (host-specific to Claude Code; cannot auto-write tests; cannot generalise to OpenCode). The law + skill route was chosen precisely because it binds every host through the emit path.
- No change to Law III or Law XXVII wording — Law XXXV cross-references them; it does not restate or edit them.
- No lean/full footprint change — laws are always-on core in both modes; Law XXXV joins that core.

## Risks / open questions

- **Footprint cost.** Law XXXV adds to every session's footprint (both lean and full) and a themed label to 14 themes. Accepted: the coverage obligation has no cheaper home that preserves standing authority.
- **Overlap perception.** The verify half lightly echoes Law III. Mitigated by making coverage (not verification) the law's centre of gravity and deferring the run-and-show mechanics to Law III explicitly.
- **Theme voice.** Each theme needs a `LEX_XXXV` label and `DESC_DEVELOP` prose in its own register; these are authored per theme, not machine-generated, to match the existing 34 labels.

## Audit provenance

This spec was hardened by a five-axis adversarial audit against the actual tree (law-overlap, touch-point completeness, theme parity, skill registration, voice), each finding independently verified before folding.

**Confirmed and folded in (8):** the `SKILL_CLASS` blocker; the theme-parity gate being a union comparison (not a token-presence check); `_TEMPLATE.json` being outside the parity set; the `README.md` prose mirrors (`:144`/`:146`); and the `_web_core.py` prose mirrors (law count `:130`/`:181`, skills list `:200-207`).

**Refuted (not folded):**
- *Law XXXV length.* Flagged as a ~2.5× outlier vs its immediate neighbours — refuted: the file's register is not uniformly terse (Law XXVIII ≈ 145 words, others longer), so Law XXXV's length is in-band.
- *`SHIPPED.md` ledger.* Proposed as a required update — refuted: it is a point-in-time shipped record, not a live count (already reads `33 skills` vs 38 real), so it is not meant to track current totals.
- *Law-overlap.* No existing law duplicates or contradicts Law XXXV; its cross-references (III, XV, XXVII, II, XXIV) resolve to the correct laws and domains.
- *AGENT.md-table / "14 themes" findings.* Redundant with what the spec already stated.
