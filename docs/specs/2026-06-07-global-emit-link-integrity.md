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
- **In-skill-body links (`build.py`):** native skill bodies are *de-linked*, the
  same way as the AGENT.md tables — `_strip_skill_body_links(body)` reduces every
  relative `.md` cross-link (sibling skills, `../agents/x.md`, `_template.md`) to
  plain text, applied in `_write_native_layer` (shared by both opencode emits). This
  retires the earlier path-nesting rewrite (`_renest_skill_links`) entirely: the
  native emits are link-clean by construction, nothing to renest, nothing to break.
  The authoring template (`_template.md`) is still shipped verbatim and flat so an
  author following create-skill's "Copy `_template.md`" has the scaffold on disk.

## Tests
- `GlobalEmitDoctorTests`: the `opencode-global` emit is token/link/escape-clean for
  neutral and imperial (would fail on any of the three defects above).

## Follow-up: de-link AGENT.md tables in the OpenCode emits

OpenCode loads agents/skills by native discovery (HOW-OPENCODE-LOADS §4), so
AGENT.md's per-row table links are navigation-only and never followed — and they
were the recurring dead-link source. Decision: **drop the per-row links in the
OpenCode emits only** (the portable `files` emit keeps them, since its specs are
flat siblings that resolve and a human may browse them).

- `build._strip_capability_links(text)` reduces `[name](agents|skills/x.md)` to
  plain `name`; folder pointers (`](agents/)`, `](skills/)`) and memory links are
  untouched. Applied to `out/AGENT.md` in `emit_opencode` and to `agent_text` in
  `emit_opencode_global` (replacing the old nested-path rewrite — nothing left to
  break). The trigger column and the section folder pointers are preserved.
- In-skill-body cross-links (inside SKILL.md) are de-linked too, by the same
  rationale — see `_strip_skill_body_links` above. The link text stays, so the prose
  still reads ("run verify if unsure", "the reviewer Agent").

## Result
`doctor --all` reports 8 themes clean, now including the global emit. The OpenCode
AGENT.md carries no per-row spec links (nothing to break); the portable build keeps
them.
