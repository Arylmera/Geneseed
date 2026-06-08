# Spec — Harness Perfection Workplan

> Generated 2026-06-08 from a multi-agent workflow: 4 web-research agents
> (AGENT.md conventions, skill design, subagents/councils, context-engineering)
> + 4 internal-review agents (laws/entrypoint, skills, agents, build/tooling)
> → 1 synthesis pass. 9 agents, ~458k tokens.
>
> **Status (2026-06-08): EXECUTED, commits `7d0b6d4..ca46224`.** Phases 0–4 landed.
> Several synthesis claims were verified FALSE against the code and dropped (tester
> bash marker, stale `test_build.py` filename, the `_authoring_problems` doctor fn).
> Deferred with rationale in the Phase 4 commit: the learn-plugin flush-on-exit and
> the memory-freshness wrapper (the latter needs a hook-vs-convention decision).
> Result: 20 laws / 19 skills / 16 agents; doctor --all clean; 88 unittests pass.

## Executive verdict

Geneseed is already a mature, well-architected harness: the build pipeline
(verbatim-unknown-tokens, STRUCTURE-pinning, `assert_source_complete`, layered
doctor checks) is genuinely strong, the laws are mostly orthogonal, and the
agent/skill templates self-enforce. The work to make it "perfect" is
**overwhelmingly subtraction and sharpening, not addition** — the external
research is unanimous that instruction-following degrades with bulk, and
Geneseed's 20/20/16 law/skill/agent counts already sit at the edge of the safe
zone. There is exactly one correctness bug worth treating as urgent
(`tester.md` missing its `<!-- bash: allow -->` marker). Two coverage gaps
(error/partial-failure law, agent model-routing field) are real and high-value;
everything else is consolidation, cross-referencing, and trigger tightening.

**Verified correction:** the build-review claim "count asserts are missing" is
FALSE — they exist in `tests/test_harness.py` L568-570. The memory note's
`test_build.py` filename is stale.

**Sizing note — the multiplication tax:** changing a law or skill *body* is
cheap, but adding/removing a **slot** ripples: a new law/skill needs its token
defined in all **8 theme JSONs** + a row in `AGENT.md.tmpl` + a bump to the
count asserts in `tests/test_harness.py` (L568-570). So "add a law" = M-to-L
even when the prose is trivial; "tighten a trigger" = S.

Decision flags that need the user's call before touching slots are marked 🚩.

---

## Phase 0 — Correctness (do first, ship alone)

| ✓ | Task | Files | Sev | Eff | Traces to |
|---|------|-------|-----|-----|-----------|
| ☐ | Add `<!-- bash: allow -->` after the Allowed-tools section of tester.md, matching reviewer.md/security.md. **Verified real:** tester's procedure says "Runs the suite" but has no marker, so the OpenCode emit can deny bash and make "confirm it passes" impossible. | `src/agents/tester.md` | **critical** | S | agents-review (tester Allowed tools) |
| ☐ | Add a cycle-safety guard to `render_file()` INCLUDE resolution: pass a `visiting` frozenset, emit `<!-- CIRCULAR INCLUDE: path -->` instead of recursing; add a test with a temp circular include. | `build.py` (render_file ~L61-72), `tests/test_build.py` | medium | S | build-review (INCLUDE not cycle-safe) |
| ☐ | **Correct the false "missing count asserts" finding.** Asserts exist in `tests/test_harness.py` L568-570 (agents==16, skills==20, laws==20). Fix the stale `test_build.py` filename in the memory note, AND add a sharper guard: a test asserting every skill/agent row in `AGENT.md.tmpl` has a backing `src/skills/*.md` / `src/agents/*.md` file. | memory note, `tests/test_harness.py` | low | S | build-review (re-scoped — original claim invalid) |

---

## Phase 1 — Coverage gaps (must-do additions; minimal bulk)

| ✓ | Task | Files | Sev | Eff | Traces to |
|---|------|-------|-----|-----|-----------|
| ☐ | **Add an error/partial-failure law.** "When a step fails or returns an unexpected result, stop, surface the error verbatim, state what you attempted, and wait for direction; do not silently proceed, do not retry more than once without reporting." Reclaim the slot by folding Law VII into Law V (Phase 2) so the count stays at 20. 🚩 **Decision:** approve this law + the VII→V fold, or keep 20 by replacing a different law. | `src/laws/universal.md`, 8× theme JSONs, `tests/test_harness.py` | **high** | M | gov-review (no error-handling law) |
| ☐ | **Add a Model-routing field to every agent spec** (one line after Allowed tools). Read-only → "sonnet (read-only)"; synthesis (architect, reviewer) → "sonnet/opus, caller decides"; mutating (tester, docs) → "sonnet". Surfaces routing at the spec, not buried in CLAUDE.md. | all 17 `src/agents/*.md` | **high** | M | agents-review (model routing absent) + research: tier-split saves 40-60% |
| ☐ | **Add a cross-session handoff clause** to Law VI or XIV: "When a session ends mid-task, write a resumption note to memory — current step, next step, blockers, irreversible changes already made." (Body edit — no new slot.) | `src/laws/universal.md` | medium | S | gov-review (no multi-session handoff) |

🚩 **Decision — missing skills.** Research says prove a gap before adding (20-30
focused skills beats 80 broad). Recommendation: add **only** `migrate.md`
(non-obvious safe procedure: read guide → branch → one dep at a time → test
between → version-bump as separate commit). Do **not** add standalone
`security.md` (covered by the security *agent*) or `setup.md` (belongs as a
§Setup section in `repo-map.md`). Each new skill = M-L.

---

## Phase 2 — Consolidation (trim slots, sharpen triggers)

| ✓ | Task | Files | Sev | Eff | Traces to |
|---|------|-------|-----|-----|-----------|
| ☐ | **Merge `code-review.md` + `review-response.md` → `review.md`** with two headed sections (§ Reviewing / § Responding). Removes "which skill?" nav ambiguity, frees a slot. | `src/skills/`, `AGENT.md.tmpl`, 8× theme JSONs, `tests/test_harness.py` (20→19) | medium | M | skills-review (overlap) |
| ☐ | **Fold `roast-me.md` into `review.md` as a `severity: brutal` mode** (structurally identical: correctness → quality → ranked findings, only tone differs). Widen trigger to "honest feedback / what's wrong / critique this". 🚩 **Decision:** merge away vs keep standalone with widened trigger? | `src/skills/roast-me.md`, `review.md`, 8× theme JSONs | low | M | skills-review (roast-me brittle trigger) |
| ☐ | **Demote Law VII into a parenthetical under Law V** ("for skills: one domain, extend before creating, name by domain"). Frees the law slot for the error-handling law. Renumbering ripples — re-check internal `Law N` refs. | `src/laws/universal.md`, 8× theme JSONs, `tests/test_harness.py` | low | M | gov-review (V/VII same root) |
| ☐ | **Demote/absorb `create-skill.md`** — a meta-chore that won't spontaneously trigger. Move its real friction points (token in 8 themes, count assert, AGENT.md row) into a comment block in `_template.md` or AGENT.md §4. 🚩 **Decision:** absorb (frees slot) vs keep but enrich? | `src/skills/create-skill.md`, `_template.md` | medium | M | skills-review (create-skill thin) |
| ☐ | **Decide `verify.md`'s fate** — a 4-step restatement of Law III. Either (a) delete and fold "state what you ran + its result" into Done-when of debug/tdd/ship, or (b) enrich (reading CI output, running the test suite, behaviour when DoD undefined). 🚩 **Decision:** delete-and-fold (recommended, frees slot) vs enrich? | `src/skills/verify.md` (+ debug/tdd/ship if folding) | medium | M | skills-review (verify thin) |

---

## Phase 3 — Sharpening (no slot changes; mostly S)

| ✓ | Task | Files | Sev | Eff | Traces to |
|---|------|-------|-----|-----|-----------|
| ☐ | Add explicit cross-references between overlapping laws: III↔XVII (runtime state vs authored docs), XII→XI (duplication includes docs), XX "(specialises Law IV for git history)", align readiness-sigil phrasing with Law XVIII + "(this is Law XVIII — see §1)". | `src/laws/universal.md`, `AGENT.md.tmpl` | low | S | gov-review (law overlaps) |
| ☐ | Sharpen brainstorm vs plan triggers: brainstorm = "no design exists yet"; plan = "a design/spec exists, sequence it" + "if design missing, run brainstorm first" guard atop plan.md. | `brainstorm.md`, `plan.md` | medium | S | skills-review (overlap) |
| ☐ | Wire repo-map into the chain: reference it in `ship.md` step 6 and `refactor.md` Done-when; add "or when ship/refactor signals an architecture change" to repo-map's trigger. | `ship.md`, `refactor.md`, `repo-map.md` | medium | S | skills-review (weak trigger) |
| ☐ | Flag cmux as environment-conditional: "(cmux hosts only)" in its AGENT.md row, env-gating qualifier in all 8 `{{DESC_CMUX}}`; add inverse link parallel-agents.md → cmux. | `AGENT.md.tmpl`, 8× theme JSONs, `parallel-agents.md` | low | S | skills-review (env-gating) |
| ☐ | Tighten agent output contracts: architect → per-step schema `N. <file/module> — <change> — <acceptance criterion>`; docs → files-changed + verified-runnable checklist + surfaces-NOT-updated list. | `architect.md`, `docs.md` | medium | S | agents-review (contracts underspecified) |
| ☐ | Sharpen advocate vs visionary contracts (advocate → "minimum change that captures the value"; visionary → "the capability the 10x version unlocks + the single bet"); note in council.md that seating both is for ambition-level debates only. | `advocate.md`, `visionary.md`, `council.md` | low | S | agents-review (redundancy) |
| ☐ | Add null-result escape hatches to operator/framer/user-advocate ("return 'no signal — seat dropped'"), mirroring historian; add the 6-capability-agents-excluded-from-council note to council.md. | `operator.md`, `framer.md`, `user-advocate.md`, `council.md` | low | S | agents-review (null-result, roster clarity) |
| ☐ | Allow framer + empiricist direct-dispatch (not council-only): framer before a contested plan, empiricist to audit a spec for unsupported claims. Keep council use first. | `framer.md`, `empiricist.md` | low | S | agents-review (over-gating) |

---

## Phase 4 — Template & authoring conventions (research-driven polish)

| ✓ | Task | Files | Sev | Eff | Traces to |
|---|------|-------|-----|-----|-----------|
| ☐ | Add the three-part description formula to the skill template as a comment: "[What it produces]. Use when [trigger phrases]. Do NOT use when [boundary]." + third-person POV note. (For adopters — Geneseed's own skills use `{{DESC_*}}` tokens.) | `_template.md` | medium | S | research: skill-authoring |
| ☐ | Add a `## References` convention to `_template.md` for skills >~40-50 lines + a "no time-sensitive conditionals / no OS-specific paths / one default library" note. | `_template.md` | low | S | research: progressive disclosure, anti-patterns |
| ☐ | Add a memory freshness wrapper: on memory-body reads, surface days-since-creation + "verify before asserting". 🚩 **Decision:** hook-enforced vs convention-documented in `memory/README.md`? | `memory/README.md`, possibly `rituals/harness.py` | low | M | research: context-engineering (stale-memory poison) |
| ☐ | Widen guard-plugin tool-name matching to substring patterns (write/edit/create/patch/save; run/exec/command); document covered patterns in the plugin header. | `adapters/opencode/plugins/geneseed-guard.js` | low | S | build-review (exact-string matching fragile) |
| ☐ | Add a flush-on-exit handler (exit/SIGTERM) to the learn plugin that clears pending timers and best-effort writes the distil prompt to a temp file; document the async-on-SIGTERM limitation. | `adapters/opencode/plugins/geneseed-learn.js` | low | S | build-review (debounce lost on close) |
| ☐ | Resolve the orphaned `version` field in harness.config.json (remove with a "canonical version = source fingerprint" comment, or wire it as a human-readable semver shown by `harness status`). | `harness.config.json`, `rituals/harness.py` | low | S | build-review (orphaned version field) |
| ☐ | Add a doctor authoring-check that warns when a `src/skills/*.md` body contains relative `.md` links that the OpenCode emit's `_strip_skill_body_links` would silently remove. | `build.py` (_authoring_problems) | low | S | build-review (silent link stripping) |

---

## Explicitly NOT doing (research not strong enough / over-engineering)

- **No JSON-schema-enforced subagent output-contract validation layer.** Advocated
  for multi-tenant production agent graphs; Geneseed is a single-user portable
  harness where prose contracts + OpenCode tool gating already suffice.
- **No standalone security-review or setup skill** (covered by the security agent +
  a repo-map §Setup section).
- **No AGENTS.md-vs-AGENT.md rename.** The template header (L14-16) already
  documents "rename or symlink"; a second physical file = dual source of truth.
- **No mass model-routing or context-budget logging hook** beyond the per-spec
  Model field — visibility before enforcement.

---

## Suggested sequencing & batching

1. **Phase 0** as its own commit/PR — correctness fix + test, no slot churn.
2. **Phase 2 slot-trimming** BEFORE **Phase 1 additions**, so freed slots absorb
   the new error-handling law and the count never transiently breaks. Batch all
   8 theme-JSON token edits for a given slot change at once.
3. **Phase 3** — independent body-only edits, safe in any order, one PR.
4. **Phase 4** — adapter/template polish, lowest priority, batch at end.
5. Run `harness doctor --all` + `python -m pytest tests/` after **every** slot
   change — count asserts and parity checks are the safety net.
