# Global-emit link integrity

**Date:** 2026-06-07
**Status:** implemented

## Problem

Setting up `opencode-global` (the recommended install) produced an AGENT.md whose
links looked dead, and the doctor never noticed — because it never checked the
global emit at all. Three distinct defects:

1. **Doctor blind spot.** `doctor` validated the `files` build and `./Harness`, but
   never the `opencode` / `opencode-global` emits. The recommended install was
   entirely unverified.
2. **Non-hermetic memory links.** The global emit *absolutised* AGENT.md's memory
   links to `<cfg>/memory/` (an absolute `/Users/…` or `C:/…` path). Functional but
   non-hermetic, and a markdown viewer renders it as a broken link.
3. **Broken nested-skill cross-links.** Native skills are emitted nested
   (`skills/<name>/SKILL.md`), but skill bodies are authored flat: sibling links as
   `verify.md`, agent links as `../agents/x.md`, and `create-skill` links the
   authoring template `_template.md`. One directory deeper, all of these are dead —
   12 links × every theme. This was the actual "dead links even though the skills
   table is present" symptom.

## Fix

- **Doctor (`harness.py`):** new `_global_emit_problems(theme)` renders the
  `opencode-global` emit into a temp config dir and link/token-checks it like a
  files build (labelled `<theme> global`). Wired into `_doctor_collect`'s per-theme
  loop, so every theme the doctor checks now also validates its global emit.
- **Memory links (`build.py`):** stop absolutising. AGENT.md and the store are
  siblings in the global layout (`<cfg>/AGENT.md` + `<cfg>/memory/`), so relative
  `memory/` links are correct *and* hermetic. Plugins locate the store via
  `$GENESEED_HARNESS`, so recall does not depend on the link.
- **Nested-skill links (`build.py`):** `_renest_skill_links(body)` rewrites a
  skill body for the deeper path — `../x` → `../../x`, bare `sibling.md` →
  `../sibling/SKILL.md`, `_template.md` → `../_template.md`. Applied in
  `_write_native_layer` (shared by both opencode emits, so both are fixed). The
  authoring templates (`_template.md`) are now shipped verbatim and flat into the
  native dir so the link resolves and authors have the scaffold.

## Tests
- `GlobalEmitDoctorTests`: the `opencode-global` emit is token/link/escape-clean for
  neutral and imperial (would fail on any of the three defects above).

## Result
`doctor --all` reports 8 themes clean, now including the global emit.
