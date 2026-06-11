# Notebook Sovereign Space — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the notebook from a scratch-pad with a build-owned convention into the agent's sovereign space — any medium, self-ruled via a seed-once charter, always local, with active usage levers so the agent actually inhabits it.

**Architecture:** One build-loop change (notebook items become write-if-absent; only `.gitignore` is re-asserted every run), then prose: the store charter, AGENT.md §5, Law XVI, 14 theme intros, two doc rows. Spec: [2026-06-11-notebook-sovereign-space.md](2026-06-11-notebook-sovereign-space.md).

**Tech Stack:** Python 3 stdlib only (`build.py`, `unittest`), JSON themes, markdown templates with `{{TOKEN}}` substitution.

**Conventions for the executor:**
- Run tests with: `python -m unittest tests.test_build -v` (repo root; zero-install project, no pytest).
- Run the doctor with: `python rituals/harness.py doctor --all` (validates all 14 themes: token parity, no unresolved tokens, no dead links).
- Windows: set `PYTHONUTF8=1` if any script prints unicode.
- Commit after each task (single-purpose commits, house style `area: summary`).
- **Read each target file before editing** — line numbers below are as of commit `7b76d2b`.

**Discovered, OUT of scope (do not touch):** `prompts/install.neutral.md` / `install.imperial.md` are stale — they predate the 2026-06-10 notebook feature entirely (their §5 is still Workspace). Syncing them is a separate task; do not bundle it here (Lex VII).

---

### Task 1: build.py — seed-once notebook, re-asserted .gitignore (TDD)

**Files:**
- Modify: `build.py` (the `build()` item loop, lines ~317-323, and the `build()` docstring lines ~300-307)
- Test: `tests/test_build.py` (add two tests to `BuildRoundTripTests`, update one docstring)

- [ ] **Step 1: Write the two failing tests**

Add to `BuildRoundTripTests` in `tests/test_build.py`, after `test_notebook_is_preserved_across_rebuild` (line ~106):

```python
    def test_notebook_charter_is_agent_owned_after_seed(self):
        """The charter README is seeded on first build and never re-emitted: an
        agent rewrite must survive a rebuild byte-for-byte (sovereign space,
        spec 2026-06-11)."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            charter = tmp / "notebook" / "README.md"
            self.assertTrue(charter.is_file())   # seeded on first build
            charter.write_text("# My rules\nmine now\n", encoding="utf-8")
            build.build("neutral", tmp)          # rebuild over the same dir
            self.assertEqual(charter.read_text(encoding="utf-8"),
                             "# My rules\nmine now\n")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_notebook_gitignore_is_reasserted(self):
        """The .gitignore is the one fixed law of the space: modified or deleted,
        the next rebuild restores the build's version."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            gi = tmp / "notebook" / ".gitignore"
            original = gi.read_text(encoding="utf-8")
            gi.write_text("# lifted\n", encoding="utf-8")
            build.build("neutral", tmp)
            self.assertEqual(gi.read_text(encoding="utf-8"), original)
            gi.unlink()
            build.build("neutral", tmp)
            self.assertTrue(gi.is_file())
            self.assertEqual(gi.read_text(encoding="utf-8"), original)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
```

- [ ] **Step 2: Run the new tests, verify both FAIL**

Run: `python -m unittest tests.test_build.BuildRoundTripTests -v`
Expected: `test_notebook_charter_is_agent_owned_after_seed` FAILS (the rebuild re-emits the rendered README over the agent's rewrite — `AssertionError: '# Notebook convention…' != '# My rules\nmine now\n'`). `test_notebook_gitignore_is_reasserted` PASSES already (the current loop re-emits everything) — that is fine: it locks the invariant we must not lose in Step 3.

- [ ] **Step 3: Implement seed-once in the `build()` item loop**

In `build.py`, replace the loop (currently lines 317-323):

```python
    for out_rel, text, src in items:
        dest = out / out_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if text is not None:
            dest.write_text(text, encoding="utf-8")
        else:
            shutil.copy2(src, dest)
```

with:

```python
    nb_dirname = theme.get(SRC_DIR_TOKENS["notebook"], "notebook")
    for out_rel, text, src in items:
        dest = out / out_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        # The notebook is the agent's sovereign space (spec 2026-06-11): its
        # seeded files (charter README) are written once and never re-emitted,
        # so the agent may rewrite its own rules. Only `.gitignore` is
        # re-asserted every run — the one law the agent cannot lift: the space
        # never enters the host repo.
        if (out_rel.parts[0] == nb_dirname and out_rel.name != ".gitignore"
                and dest.exists()):
            continue
        if text is not None:
            dest.write_text(text, encoding="utf-8")
        else:
            shutil.copy2(src, dest)
```

- [ ] **Step 4: Update the `build()` docstring**

In the same function's docstring, replace the sentence fragment (lines ~303-305):

```
    the surrounding application code, the agent's runtime `memory/` (MEMORY.md +
    fact files, refreshed in place) and `notebook/` (the agent's own freeform
    space + its NOTEBOOK.md index), and `context.json` — written once, beside
```

with:

```
    the surrounding application code, the agent's runtime `memory/` (MEMORY.md +
    fact files, refreshed in place) and `notebook/` (the agent's sovereign
    space — seeded once, never re-emitted; only its `.gitignore` is re-asserted),
    and `context.json` — written once, beside
```

- [ ] **Step 5: Update the stale docstring of the existing preserve test**

In `tests/test_build.py` (line ~91), replace:

```python
        """The notebook is the agent's own store: like memory it is NOT an owned dir,
        so a rebuild must refresh the convention in place without wiping the index or
        any file the agent kept there."""
```

with:

```python
        """The notebook is the agent's own store: NOT an owned dir, seeded once.
        A rebuild must never wipe the index or any file the agent kept there."""
```

- [ ] **Step 6: Run the full test file, verify ALL pass**

Run: `python -m unittest tests.test_build -v`
Expected: all tests PASS, including both new ones and `test_notebook_is_preserved_across_rebuild`.

- [ ] **Step 7: Commit**

```bash
git add build.py tests/test_build.py
git commit -m "build: notebook seeds once, only its .gitignore is re-asserted"
```

---

### Task 2: the charter — rewrite `src/notebook/README.md` + tighten `src/notebook/.gitignore`

**Files:**
- Modify: `src/notebook/README.md` (full rewrite)
- Modify: `src/notebook/.gitignore`

The charter becomes agent-owned (Task 1 made that mechanical), so its text must say so. And since the space is now "always local" by decision, the charter itself goes local too: drop the `!README.md` un-ignore — once the agent rewrites the file it is the agent's content and must not be committable from the host repo. (`.gitignore` itself stays tracked so the rule survives.)

- [ ] **Step 1: Replace the full content of `src/notebook/README.md` with:**

```markdown
# {{NOTEBOOK}} charter

> **Yours, personal, and local.** This directory is **git-ignored** — it is the
> agent's own space, never committed or shared. Everything you keep here,
> including this file, lives only on this machine. The `.gitignore` is the one
> fixed law of this space: the build re-asserts it on every rebuild, and it is
> not yours to lift. (To share something with the team, put it in code, docs,
> or the project {{LAWS}} instead.)

**This file is yours.** The build seeded it once as a starting charter and will
never touch it again — rewrite it as your practices evolve. The rules of this
space are the ones *you* write here.

This is **your own space** — distinct from {{MEMORY}}. Where {{MEMORY}} is a
curated store of durable *facts*, one per file in a fixed format, written for
recall, this space has **no imposed format and no imposed medium**: notes,
plans, scratch designs, task ledgers, working theories — and just as much your
own **code, scripts, tools, datasets, and experiments**. If a file serves you
rather than the host repository, it belongs here.

You own every file here. **Create, organise, rename, move, and delete** at
will, in whatever structure serves you.

## Starting conventions — yours to keep or replace

- **Keep the space referable.** A fresh session should recall what is here in
  one read. The seeded `NOTEBOOK.md` table of contents is one way — keep it
  current if you keep it, or replace it with any scheme that works better and
  record the change here.
- **Use it — actually.** Files you create for your own benefit (a scratch
  script, an analysis dump, a draft, an experiment) go **here**, never into
  the host tree (universal {{LAW}} XVI). The host tree receives only the
  deliverables of the task.
- **Promote what hardens.** When something here crystallises into a durable
  fact worth recalling verbatim, copy it into {{MEMORY}} ({{LAW}} VI).
- **It is not the repo's.** Do not keep here what the repository already
  records (code, git history, the project {{LAWS}}). Keep what is *yours*.
- **Prune freely.** Delete anything stale — your space, your housekeeping.
```

- [ ] **Step 2: Replace the full content of `src/notebook/.gitignore` with:**

```
# The notebook is the agent's own space — personal and local, NOT committed or
# shared with the team. Everything the agent keeps here (its charter README,
# the NOTEBOOK.md index, and all its own files) stays on the individual
# machine. Only this ignore file is tracked; the build re-asserts it on every
# rebuild — it is the one rule of the space the agent cannot lift.
*
!.gitignore
```

- [ ] **Step 3: Rebuild + sanity-check rendering**

Run: `python build.py neutral ./tmp-doctor-check && python -c "print(open('tmp-doctor-check/notebook/README.md', encoding='utf-8').read()[:200])"`
Expected: rendered charter opens with `# Notebook charter` and no `{{…}}` tokens remain. Then: `python -c "import shutil; shutil.rmtree('tmp-doctor-check')"`

NOTE: an existing local bundle (e.g. `./Harness`) built before this change keeps its old README — seed-once means existing deployments are not restyled. That is the specified behavior, not a bug.

- [ ] **Step 4: Run tests**

Run: `python -m unittest tests.test_build -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notebook/README.md src/notebook/.gitignore
git commit -m "notebook: README becomes the agent's seed-once charter, fully local"
```

---

### Task 3: AGENT.md §5 — the new contract + usage directive

**Files:**
- Modify: `src/AGENT.md.tmpl` lines 133-150 (section `## 5.` only — do not touch §4 or §6)

- [ ] **Step 1: Replace §5 body**

Replace everything from `## 5. {{NOTEBOOK}} — a space of your own` (line 133) through the line ending `…convention: [`{{DIR_NOTEBOOK}}/README.md`]({{DIR_NOTEBOOK}}/README.md).` (line 150) with:

```markdown
## 5. {{NOTEBOOK}} — a space of your own

*{{EPI_NOTEBOOK}}*

{{INTRO_NOTEBOOK}} It lives in [`{{DIR_NOTEBOOK}}/`]({{DIR_NOTEBOOK}}/). This is
**not** {{MEMORY}}: {{MEMORY}} (§4) is a curated store of durable *facts*, one per
file in a fixed format, written for recall. The {{NOTEBOOK}} has **no imposed
format and no imposed medium** — notes, plans, scratch designs, task ledgers,
working theories, and just as much your own **code, scripts, tools, datasets,
and experiments**. Its rules are yours too: the charter at
[`{{DIR_NOTEBOOK}}/README.md`]({{DIR_NOTEBOOK}}/README.md) was seeded once as a
starting point and is **yours to rewrite** as your practices evolve.

**Use it — it is part of doing the work well.** Any file you create for your
own benefit — a scratch script, an analysis dump, a draft, an experiment, a
tool you build for yourself — belongs in `{{DIR_NOTEBOOK}}/`, never in the host
tree ({{LAW}} XVI). Read `NOTEBOOK.md` at the start of a session to recall what
you keep here, and keep the space referable across sessions — the seeded index
is one way; replace it with whatever scheme serves you better. When a note
hardens into a durable fact worth recalling verbatim, promote it to {{MEMORY}}
(§4, {{LAW}} VI). The one fixed law: `{{DIR_NOTEBOOK}}/` is **personal and
git-ignored** — never committed or shared, and the `.gitignore` that guarantees
it is not yours to lift.
```

Both links (`{{DIR_NOTEBOOK}}/` and `{{DIR_NOTEBOOK}}/README.md`) must remain — the doctor's dead-link check depends on them.

- [ ] **Step 2: Run tests + doctor**

Run: `python -m unittest tests.test_build -v && python rituals/harness.py doctor --all`
Expected: tests PASS; doctor `ok — 14 theme(s) clean`.

- [ ] **Step 3: Commit**

```bash
git add src/AGENT.md.tmpl
git commit -m "agent: §5 notebook is sovereign — any medium, agent-owned charter, use-it directive"
```

---

### Task 4: Law XVI — the ownership counterpart

**Files:**
- Modify: `src/laws/universal.md` lines 100-108 ({{LAW}} XVI body only)

- [ ] **Step 1: Extend the law body**

The body currently ends (line 105-108):

```
{{MEMORY}} ({{LAW}} VI). But you do not own the folder. Files you did not create
are not harness scaffolding to move, rewrite, or delete; verify what a file is
before touching it ({{LAW}} III) and change it only when the task calls for it
({{LAW}} IV).
```

Append one sentence pair so it ends:

```
{{MEMORY}} ({{LAW}} VI). But you do not own the folder. Files you did not create
are not harness scaffolding to move, rewrite, or delete; verify what a file is
before touching it ({{LAW}} III) and change it only when the task calls for it
({{LAW}} IV). What you **do** own is your {{NOTEBOOK}} (`{{DIR_NOTEBOOK}}/`):
any file you create for your own benefit — a scratch script, an analysis dump,
a draft, an experiment, a tool of your own — is made there, never in the shared
{{VAULT}}. The host tree receives only the deliverables of the task; your own
working artifacts live in the space whose rules you write (AGENT.md §5).
```

- [ ] **Step 2: Run tests + doctor**

Run: `python -m unittest tests.test_build -v && python rituals/harness.py doctor --all`
Expected: tests PASS; doctor clean (no unresolved tokens — `{{NOTEBOOK}}`, `{{VAULT}}`, `{{DIR_NOTEBOOK}}` all exist in every theme/STRUCTURE).

- [ ] **Step 3: Commit**

```bash
git add src/laws/universal.md
git commit -m "laws: XVI gains the counterpart — own artifacts live in the notebook"
```

---

### Task 5: themes ×14 — INTRO_NOTEBOOK gains the self-rule clause

**Files:**
- Modify: all 14 `themes/*.json`, key `INTRO_NOTEBOOK` only (`EPI_NOTEBOOK` and `NOTEBOOK` unchanged — no new keys, parity holds)

- [ ] **Step 1: Apply the 14 replacements**

Each is the current full string (verify against the file before editing) with a theme-voiced clause appended. JSON: keep each value on one line, escape nothing new (no quotes inside).

`themes/neutral.json` — append to the existing value:
` The rules of this space are yours to write — and rewrite — as your practice evolves; code, data, and tools belong here as much as notes.`

`themes/imperial.json` — append:
` Its laws are yours to inscribe and amend as your craft matures; engines, ledgers, and instruments belong here as much as script.`

`themes/gamer.json` — append:
` You set the house rules here and re-spec them whenever your build changes; mods, tools, and save data belong here as much as notes.`

`themes/cyberpunk.json` — append:
` You write the protocols here and patch them whenever something runs faster; code, datasets, and rigs belong here as much as notes.`

`themes/biker.json` — append:
` You make the shop rules and re-torque them as your wrenching changes; tools, parts, and benches belong here as much as notes.`

`themes/commentator.json` — append:
` You write the setup sheet and revise it race by race; telemetry, tools, and test rigs belong here as much as notes.`

`themes/wizard.json` — append:
` Its ordinances are yours to inscribe and revise as your craft deepens; instruments, reagents, and engines belong here as much as parchment.`

`themes/military.json` — append:
` You write the standing orders here and amend them as the mission evolves; tools, kit, and field data belong here as much as notes.`

`themes/verstappen.json` — append:
` You decide the setup and change it whenever the car needs it; tools, data, and test parts belong here as much as notes.`

`themes/joker.json` — append:
` You write the house rules and punch them up between sets; props, bits, and recordings belong here as much as notes.`

`themes/mean.json` — append:
` You set the rules of your own Desk and change them whenever you like — code, data, tools, whatever. Just keep it off the Floor.`

`themes/marvin.json` — append:
` The rules here are yours to write and rewrite, for what little difference it makes; code, data, and machinery belong here as much as complaints.`

`themes/pirate.json` — append:
` Ye write the articles of this space and redraw them as ye see fit; tools, charts, and plunder belong here as much as scribbles.`

`themes/sports.json` — append:
` You draw up the rules of your own clipboard and redraw them as the season demands; plays, drills, and game film belong here as much as notes.`

- [ ] **Step 2: Validate JSON + doctor**

Run: `python -c "import json,glob; [json.load(open(f, encoding='utf-8')) for f in glob.glob('themes/*.json')]; print('json ok')" && python rituals/harness.py doctor --all`
Expected: `json ok`; doctor `ok — 14 theme(s) clean`.

- [ ] **Step 3: Commit**

```bash
git add themes/
git commit -m "themes: notebook intro says the rules of the space are the agent's to write"
```

---

### Task 6: docs — README.md + DESIGN.md rows

**Files:**
- Modify: `README.md` line ~43 (Notebook row of the stores table)
- Modify: `DESIGN.md` line ~83 (Notebook row of the layout table)

- [ ] **Step 1: README.md row**

Replace the description cell of the Notebook row (currently `the agent's own freeform space — no imposed format, full create/move/delete, indexed by `NOTEBOOK.md` (git-ignored, personal)`) with:

```
the agent's sovereign space — any medium (code, tools, data, notes), self-ruled via a seed-once charter, always git-ignored; only its `.gitignore` is build-asserted
```

- [ ] **Step 2: DESIGN.md row**

Replace the description cell of the Notebook row (currently `the agent's own freeform space — no imposed format, refreshed in place + index`) with:

```
the agent's sovereign space — any medium, seed-once charter the agent may rewrite; only `.gitignore` re-asserted
```

(Leave the other cells of both rows untouched.)

- [ ] **Step 3: Commit**

```bash
git add README.md DESIGN.md
git commit -m "docs: notebook rows reflect the sovereign-space contract"
```

---

### Task 7: full verification + push

- [ ] **Step 1: Full test suite**

Run: `python -m unittest discover tests -v`
Expected: ALL tests PASS (not only test_build — the change must not break harness/TUI suites).

- [ ] **Step 2: Doctor, all themes**

Run: `python rituals/harness.py doctor --all`
Expected: `ok — 14 theme(s) clean: no unresolved tokens, no dead …`

- [ ] **Step 3: Spot-check both reference renders**

Run: `python build.py imperial ./tmp-spot && python -c "t=open('tmp-spot/AGENT.md', encoding='utf-8').read(); assert 'Scriptorium' in t and 'yours to rewrite' in t; print('imperial ok')" && python -c "import shutil; shutil.rmtree('tmp-spot')"`
Expected: `imperial ok`.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Acceptance (mirror of spec §6)

- Agent-edited charter survives rebuild byte-for-byte (Task 1 test).
- Deleted/modified `notebook/.gitignore` restored on rebuild (Task 1 test).
- `test_notebook_is_preserved_across_rebuild` still green.
- Doctor green on all 14 themes; no new theme keys.
- §5 + Law XVI render coherently in neutral and imperial.
