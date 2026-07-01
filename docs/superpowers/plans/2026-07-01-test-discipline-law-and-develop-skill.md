# Test Discipline: Law XXXV + `develop` Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standing test-discipline rule to Geneseed — universal **Law XXXV** ("cover-and-verify") plus a **`develop`** dev-loop skill — emitted to every host.

**Architecture:** Geneseed emits a runtime-agnostic footprint (laws + agents + skills) themed at build time across 14 themes. A new law adds one entry to `src/laws/universal.md` + a themed `LEX_XXXV` label in every theme; a new skill adds one `src/skills/*.md` file + a `SKILL_CLASS` category + an AGENT.md table row + a themed `DESC_DEVELOP` line. Consistency is enforced by `doctor` (parity, badges, SKILL_CLASS, unresolved tokens) and the unit suite. This plan is edit-then-verify: the "test" is `doctor --all` + the existing suite, which already assert the gates.

**Tech Stack:** Python (build/harness in `rituals/`, `_build_*.py`), JSON theme files, Markdown law/skill sources.

**Design spec:** `docs/superpowers/specs/2026-07-01-test-discipline-law-and-develop-skill-design.md` (read it — it carries the audit-verified touch-point map and gate mechanics).

---

## Themed token values (authored per theme; embed verbatim)

`LEX_XXXV` format is `<Themed phrase> · Cover and Verify` (shared neutral gloss `Cover and Verify`; the `neutral` theme is bare, no `·`). `DESC_DEVELOP` is a single themed line (~15–22 words), one em-dash pivot, matching that theme's `DESC_TDD` register.

| theme | `LEX_XXXV` | `DESC_DEVELOP` |
|---|---|---|
| biker | `Ride It Before You Park It · Cover and Verify` | `Push a change through the run — the smallest turn of the wrench, a test written to cover it, the touched trials green, sealed slice by slice.` |
| commentator | `Cover the Line, Then Take the Flag · Cover and Verify` | `Drive the change through cover-and-verify — the smallest setup tweak, a trial written to time it, the affected laps green, sealed corner by corner.` |
| cyberpunk | `Cover the Trace, Run It Green · Cover and Verify` | `Drive the change through the loop — smallest edit, a test written to cover it, the touched rigs run green, committed slice by slice.` |
| gamer | `Clear It Green · Cover and Verify` | `Drive the change through the cover-and-verify loop — smallest move, tests written for it, the affected run green, committed slice by slice.` |
| imperial | `Tege et Proba · Cover and Verify` | `Drive a change through the cover-and-verify loop — the smallest stroke, the trials written to cover it, the affected suite green, sealed slice by slice.` |
| joker | `Cover the Bit, Then Watch It Land · Cover and Verify` | `Drive a change through the club's own laugh test — smallest bit, tests written to cover it, the affected set green, committed one beat at a time.` |
| marvin | `It's Never Truly Done · Cover and Verify` | `Drive a change to the bitter end — smallest edit, trials written to cover it, the affected suite green, sealed slice by slice; it's never truly finished.` |
| mean | `It's Not Done Till It's Green · Cover and Verify` | `Drive the change through the loop — smallest cut, a test that covers it, the affected suite green, committed slice by slice. Not one giant dump.` |
| military | `Cover Your Fire, Confirm the Hit · Cover and Verify` | `Drive the change through the cover-and-verify loop — smallest move, tests written to cover it, affected suite green, committed slice by slice.` |
| neutral | `Cover and Verify` | `Drive a change through the cover-and-verify loop — smallest change, tests written for it, the affected suite green, committed slice by slice.` |
| pirate | `Trials Rig the Work, Run Her Clean · Cover and Verify` | `Sail a change through the cover-and-verify tack — the smallest move, trials rigged to cover it, the touched trials run clean, sealed one cargo at a time.` |
| sports | `Cover Every Receiver, Then Snap the Tape · Cover and Verify` | `Drive it in on cover-and-verify — smallest gain, a test set on the new ground, the affected drills green, and log it snap by snap.` |
| verstappen | `Not Done Till the Trials Run Green · Cover and Verify` | `Drive the change home — smallest move, a test written to cover it, the affected trials green, and sealed commit by commit.` |
| wizard | `Cover the Casting, Then Confirm · Cover and Verify` | `Drive a working through the cover-and-confirm loop — the smallest casting, its trials written, the touched trials green, sealed rune by rune.` |

Each theme JSON keeps keys ordered `LEX_I…LEX_XXXV` (add `LEX_XXXV` right after `LEX_XXXIV`) and `DESC_*` in its existing block (add `DESC_DEVELOP` near the other skill DESCs; exact position is not gated, but keep it tidy).

---

## File structure (what each touch does)

- `src/laws/universal.md` — canonical Law XXXV text (tokenised).
- `src/skills/develop.md` — the dev-loop skill source.
- `themes/*.json` (14) — themed `LEX_XXXV` + `DESC_DEVELOP`.
- `rituals/_harness_tui.py` — `SKILL_CLASS["develop"] = "build"`.
- `AGENT.md.tmpl` — `develop` row in the skills table.
- `README.md` — `laws`/`skills` badges + prose mirrors.
- `rituals/_web_core.py` — law/skill prose mirrors.
- `tests/test_harness.py` — law-count assertions 34→35.

---

### Task 1: Add Law XXXV to the canonical laws

**Files:**
- Modify: `src/laws/universal.md` (append after Law XXXIV, currently ends ~line 343)
- Modify: `tests/test_harness.py:365` and `:742` (law-count assertions)

- [ ] **Step 1: Bump the failing count assertions first (test-first)**

In `tests/test_harness.py`, change the two law-count assertions from `34` to `35`:
- line ~365: `self.assertEqual(d["laws"], 34)` → `self.assertEqual(d["laws"], 35)`
- line ~742: `self.assertEqual(len(inv["laws"]), 34)` → `self.assertEqual(len(inv["laws"]), 35)`

- [ ] **Step 2: Run those tests, expect FAIL**

Run: `python -m unittest tests.test_harness -v 2>&1 | grep -Ei "laws|FAIL|ok" | head`
Expected: the two assertions now FAIL (source still has 34 laws).

- [ ] **Step 3: Append Law XXXV to `src/laws/universal.md`**

Add immediately after the Law XXXIV block:

```markdown

### {{LAW}} XXXV — {{LEX_XXXV}}
Code you author is not done until its behaviour is covered by a test you wrote
and the affected tests run green. When you add or change behaviour that can be
expressed as a test, write that test — new behaviour ships with the test that
pins it, a bug fix with the test that reproduces it first (the tdd {{SKILL}}
drives this). After each change, run the tests the change could affect — not the
whole suite each time ({{LAW}} XV), the ones whose behaviour you touched — and
read the output before moving on; a change left unrun is a regression you have
not yet noticed. Verify against the project's real runner and show the result as
evidence ({{LAW}} III); assert on observable behaviour, deterministically
({{LAW}} XXVII). Where the project has no suite or the change is genuinely
untestable — a doc, a constant, a config — say so rather than invent a test;
where a real test is out of scope, name the gap and stop rather than ship
untested behaviour in silence ({{LAW}} II, {{LAW}} XXIV). Tests written after the
code still guard the next change. The code you cannot re-verify on demand is the
code you do not actually control.
```

- [ ] **Step 4: Do NOT commit yet** — the source now has 35 laws but themes lack `LEX_XXXV`, so a build/emit would leave `{{LEX_XXXV}}` unresolved. Themes are added in Task 3; verification is Task 6. (Keeping the tree green at each commit means Tasks 1–5 land as one commit.)

---

### Task 2: Add the `develop` skill and register it

**Files:**
- Create: `src/skills/develop.md`
- Modify: `rituals/_harness_tui.py:278` (SKILL_CLASS dict)
- Modify: `AGENT.md.tmpl` (skills table)
- Modify: `README.md:12` (skills badge) and `:146` (skills prose + list)
- Modify: `rituals/_web_core.py:200-207` (skills wikilink list)

- [ ] **Step 1: Create `src/skills/develop.md`** (from `src/skills/_template.md`)

```markdown
# {{SKILL}}: develop

> {{DESC_DEVELOP}}

**Trigger:** implementing a feature, fixing a bug, or changing code behaviour in a repo that has (or should have) a test suite.

## Procedure
1. Orient on the project's own documentation for what you are about to touch ({{LAW}} XVII).
2. Make the smallest change that advances the task ({{LAW}} XXV).
3. Cover the behaviour — test-first via [tdd](tdd.md) where the target is known up front; otherwise write the covering test alongside the change ({{LAW}} XXXV).
4. Run the **affected** tests and read the output ({{LAW}} III); on failure, fix the cause, do not mask it ({{LAW}} XXIV).
5. Tidy the green code via [refactor](refactor.md).
6. Commit the green slice via [commit](commit.md) ({{LAW}} XX). Loop one slice at a time; dispatch the [tester]({{DIR_AGENTS}}/tester.md) {{AGENT}} for heavier coverage.

## Done when
- The behaviour changed is covered by tests written this session, the affected suite is green with its output shown, and each slice was committed.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
```

> Note: confirm the cross-reference token style used elsewhere in `src/skills/` before finalizing — e.g. how `refactor.md`/`commit.md` link sibling skills and reference the `tester` agent (`{{DIR_AGENTS}}` vs a plain relative path). Match the existing convention exactly rather than the illustrative form above.

- [ ] **Step 2: Register category** — in `rituals/_harness_tui.py` `SKILL_CLASS`, add after the other `"build"` entries:

```python
    "develop": "build",
```

- [ ] **Step 3: Add the AGENT.md skills-table row** — in `AGENT.md.tmpl`, add a `develop` row to the skills table, matching the existing row format (find the `tdd`/`refactor` rows and mirror their column shape).

- [ ] **Step 4: README skills badge + prose** — in `README.md`:
- line 12: `badge/skills-38` → `badge/skills-39`
- line 146: skills prose `(37)` → `(39)` and add `develop` to the enumerated `·`-separated list (see spec's pre-existing-drift note — the `(37)`→`(39)` also reconciles a pre-existing off-by-one).

- [ ] **Step 5: Web skills prose** — in `rituals/_web_core.py:200-207`, add `[[develop]]` to the skills wikilink list. (Leave the stale `25` count as-is per the spec's Law II scope boundary, or fix it only if you also fix it as a called-out separate concern.)

---

### Task 3: Add themed `LEX_XXXV` + `DESC_DEVELOP` to all 14 themes

**Files:**
- Modify: `themes/biker.json` … `themes/wizard.json` (all 14 real themes)
- Modify: `themes/_TEMPLATE.json` (authoring hygiene; not gated)

- [ ] **Step 1: For each of the 14 themes**, add `LEX_XXXV` (after `LEX_XXXIV`) and `DESC_DEVELOP` (in the DESC block) using the exact values from the token table above. This MUST be done for all 14 together — the parity gate is a cross-theme union comparison, so a partial edit fails.

- [ ] **Step 2: `_TEMPLATE.json`** — add `LEX_XXXV` and `DESC_DEVELOP` placeholders matching the template's existing token style (hygiene so future themes inherit them; not enforced by any gate).

---

### Task 4: Update law-count prose mirrors (ungated)

**Files:**
- Modify: `README.md:14` (badge) and `:144` (prose)
- Modify: `rituals/_web_core.py:130` and `:181`

- [ ] **Step 1: README** — `badge/laws-34` → `badge/laws-35` (line 14); prose `34 universal laws` → `35 universal laws` (line 144), optionally appending `cover-and-verify` to the trailing `…` list.
- [ ] **Step 2: `_web_core.py`** — `34 universal Rules` → `35` (line 130) and `34 universal laws` → `35` (line 181).

---

### Task 5: Verify everything green

- [ ] **Step 1: doctor**

Run: `python rituals/harness.py doctor --all`
Expected: no problems — parity (14 themes agree, incl. the two new tokens), `laws`/`skills` badges match source counts, `SKILL_CLASS` covers `develop`, no unresolved `{{...}}` tokens.

- [ ] **Step 2: full suite**

Run: `python -m unittest discover -s tests`
Expected: all pass, including the updated law-count assertions and `_count_table_problems() == []`.

- [ ] **Step 3: real emit spot-check**

Build/emit at least one theme (e.g. `neutral`) and one flavoured theme (e.g. `imperial`), and confirm Law XXXV renders with its themed label and `develop` renders with its themed purpose — this catches a token forgotten in *all* 14 themes (which parity alone would miss). Use the repo's normal build entry point (`build.py` / `harness.py build`); confirm the exact command from the spec/README before running.

- [ ] **Step 4: eyeball ungated prose** — visually confirm `README.md:144/146` and `_web_core.py:130/181/200-207` read correctly; no gate covers them.

---

### Task 6: Commit

- [ ] **Step 1: Review the diff** — `git status` + `git diff --stat`; confirm only the intended files changed.
- [ ] **Step 2: Present the commit for consent (Law XX)** — plain-language summary + exact message; wait for the user's yes.
- [ ] **Step 3: Commit** with a `feat(harness):` message describing the new law + skill.

---

## Integration (after implementation)

Per the user's request — rebase the feature branch onto latest `main`, then merge:

1. `git fetch origin`
2. On `feat/test-discipline-law`: `git rebase origin/main` (replay the spec commit + implementation commit onto latest main; resolve any conflicts).
3. `git checkout main && git merge --ff-only feat/test-discipline-law`.
4. Push `main` **only with explicit consent (Law XX)** — note: pushing to `main` may be blocked at the tool boundary (protected branch). If blocked, fall back to opening a PR from the feature branch.

## Self-review notes

- **Spec coverage:** every touch-point row in the spec maps to a task here (Law → T1; skill+SKILL_CLASS+AGENT.md+README skills+web skills → T2; themes → T3; law-count mirrors → T4; verify → T5; commit → T6). ✓
- **No new bespoke unit tests** are added because the feature is declarative and already guarded by existing gates (parity, badge counts, `SKILL_CLASS`, unresolved-token, law-count assertions). The TDD beat is "bump the count assertion → watch it fail → add the law → green" in Task 1.
- **Green-at-commit:** Tasks 1–5 land as a single commit (Task 6); an intermediate commit with the law but no theme tokens would leave `{{LEX_XXXV}}` unresolved.
