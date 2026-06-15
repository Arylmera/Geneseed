# Spec — Runtime-Awareness & Review Discipline (Geneseed gap-fill)

> Fill the runtime-awareness gaps (MCP, web research, tool-call batching) and round
> out the discipline plane (receiving review, spec→plan→execute) without adding any
> script, adapter, or CLI surface. Pure `src/` authoring + theme tokens + doc sync.

**Date:** 2026-06-07
**Status:** implemented (verified 2026-06-15)
**Approach:** C (Balanced) — +1 Rule, +2 skills, 2 extensions.

## Background

Geneseed's discipline plane is mature; its gaps are **runtime-awareness** gaps that
post-date its design: it never mentions MCP, has no open-web research workflow, and
does not tell the agent to batch independent tool calls. The discipline plane also
lacks the *receiving*-review counterpart to `code-review` and the full
spec→plan→execute pipeline. Gap analysis ranked these and the user selected clusters
**G1, G2, G3** (core runtime trio) and **G4, G8** (discipline round-out).

## Components

### C1 — Rule XIX: Tool Discovery (G1 / MCP)
New law appended to `src/laws/universal.md` after Rule XVIII. Neutral body: the agent
must discover what the host exposes (built-in tools, shell, **connected MCP servers /
external tool providers**) before deciding a capability is missing; prefer a
purpose-built tool over reconstructing it by hand; never assert a tool is absent
without checking (ties to Rule III). Themed title token `LEX_XIX` added to all 8
themes (neutral: "Tool Discovery"). The law auto-appears in `AGENT.md` via the
existing `<!-- INCLUDE: laws/universal.md -->`.

### C2 — `research` skill (G2)
New `src/skills/research.md` (template shape: `# {{SKILL}}: research`, `> {{DESC_RESEARCH}}`,
Trigger/Procedure/Done-when). Procedure: decompose the question → multi-angle web
search (Rule XIX) → fetch + extract the slice (Rule XV) → cross-check each claim
against ≥2 independent sources (Rule III) → flag recency → synthesise with per-claim
source attribution. Token `DESC_RESEARCH` added to all 8 themes. Auto-rendered into
the bundle and the OpenCode native skill layer by `build.py`.

### C3 — `review-response` skill (G4)
New `src/skills/review-response.md`, the inverse of `code-review`. Procedure: read all
comments first → classify each (correct/partial/wrong/unclear) → verify wrong/unclear
against code or a test before replying (Rules III, VIII — neither comply nor dismiss
blindly) → respond per comment with action-or-reasoned-decline → apply accepted
changes one-intent-per-commit (Rule II) + re-verify → surface what the review missed.
Token `DESC_REVIEW_RESPONSE` added to all 8 themes.

### C4 — Rule XV clause (G3, extension)
Append one sentence to the neutral Law XV body: batch independent reads/commands in
one parallel call; reserve sequential calls for when one result feeds the next. No new
token (law bodies are neutral).

### C5 — `plan` skill extension (G8)
Extend `src/skills/plan.md` into spec→plan→execute-with-checkpoints: derive the plan
from a `brainstorm` design/spec when one exists; group steps into milestones; at each
milestone stop to verify (and surface for review on consequential directions). Body
edit only — `DESC_PLAN` unchanged across themes.

### C6 — Doc sync (Rule XI)
- `src/AGENT.md.tmpl`: add two skill-table rows (`research`, `review-response`).
- `README.md`: laws count 18 → 19 (+ "tool-discovery"); skills count 17 → 19 (+ the
  two skills in the list).
- Any other count references found by grep.

## Out of scope (explicit)
No new scripts, no `rituals/harness.py` changes, no adapter/plugin code, no new theme.
Computer-use, cron, notifications, LSP — intentionally excluded (host-runtime,
conflicts with the instructions-first/hermetic design).

## Verification
1. `python build.py` (neutral) + `python build.py --theme imperial` render clean.
2. `python rituals/harness.py doctor` — token parity (all 3 new tokens ×8 themes),
   no unresolved tokens, author-time gates (every new skill has a purpose line),
   drift check green.
3. `python -m unittest discover -s tests` — all pass.
4. Commit + push.

## Worklog
- [ ] C1 Rule XIX + LEX_XIX ×8
- [ ] C4 Rule XV clause
- [ ] C2 research.md + DESC_RESEARCH ×8
- [ ] C3 review-response.md + DESC_REVIEW_RESPONSE ×8
- [ ] C5 plan.md extension
- [ ] C6 doc sync (AGENT.md.tmpl, README, grep counts)
- [ ] build + doctor + tests green
- [ ] commit + push
