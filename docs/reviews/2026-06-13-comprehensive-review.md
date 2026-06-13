<div align="center">

# 🧬 Geneseed — Comprehensive Project Review

**A full-surface roundup: features, content, tooling, web UI, TUI, docs, tests — with a prioritized refactor plan and new-idea proposals.**

Date: 2026-06-13 · Scope: whole repository at `claude/project-comprehensive-review-5cdqan`

</div>

---

## 0. Verdict

Geneseed is a **mature, unusually coherent project** — well past prototype, genuinely close to a confident 1.0. The core idea (one neutral source → themed, tool-agnostic agent harness, rendered by a stdlib-only generator) is executed with rare discipline: hermetic bundles, theme-key parity gates, a self-validating `doctor`, cross-platform CI, and a content library (laws/agents/skills) whose every spec carries an output contract and a self-improvement loop.

The weaknesses are **not architectural** — they are the accumulated debt of fast, high-quality iteration: a few load-bearing files have grown large, a handful of patterns are duplicated across language boundaries, test coverage is patchy on the interactive/emit surfaces, and the documentation that *describes* the project has begun to lag the project itself.

**Headline recommendation:** stop adding surface for a cycle. Spend one consolidation milestone on (1) the few structural-debt items that will otherwise compound, (2) closing the test gaps that make refactoring scary, and (3) a documentation/versioning reconciliation — then cut **1.0**.

### Health scorecard

| Dimension | Grade | One-line |
| --- | --- | --- |
| Architecture & design | **A** | Clean layering, hermetic, theme/structure split is elegant |
| Content library (laws/agents/skills) | **A−** | Comprehensive, consistent; a few dense laws + leaked authoring artifact |
| Generator (`build.py`) | **B+** | Solid and gated; three emit paths drifting, JSONC parser scattered |
| CLI / TUI tooling (`rituals/`) | **B+** | Well-split; namespace-merge facade is clever but fragile |
| Web server (`web.py`) | **B** | API-first and secure; 900-line handler, broad excepts |
| Web UI (React) | **B** | Lean, tasteful; no mobile, graph logic duplicated, naive polling |
| Documentation | **B+** | Excellent prose; drifting from "what's actually shipped" |
| Tests & CI | **B−** | Strong on the generator core; thin on emit modes, TUI, JS plugins |
| **Overall** | **B+ / A−** | **Ship-ready; one consolidation pass from excellent** |

---

## 1. What to protect (do not regress)

These are the project's crown jewels. Any refactor must keep them intact.

1. **Stdlib-only, dependency-free critical path.** `setup`/`build`/`doctor` need only bare `python3`. This is a real differentiator — guard it ferociously.
2. **Structure vs. voice split.** Folder names, law numbers, links are *never* themed; only prose is. This is why tooling never breaks on a theme change. The `STRUCTURE` map + parity gate enforce it.
3. **`doctor` as a self-validating contract.** Unresolved tokens, dead/non-hermetic links, theme parity, authoring gates, rendered-bundle drift — all in one dependency-free check, in CI, on Linux + Windows.
4. **Output contract + self-improvement loop on every spec.** Each agent/skill ends with a crisp "what I return" and a "fold friction back into this file" beat. This is the cultural core.
5. **Consent-forward laws (IV, XX) and the guard plugin backstop.** Explicit commit/push consent *plus* a tool-boundary enforcement layer is a genuinely strong safety posture.
6. **Hermeticity with one git-ignored escape hatch (`context.json`).** Clean `subtree split` into any repo; host-specific knowledge never leaks into the published bundle.

---

## 2. Cross-cutting themes (the systemic issues worth naming)

Four patterns recur across every area. Fixing these *once* pays off everywhere.

### 2.1 Hand-authored registries that can silently drift
The `AGENT.md` agent/skill **tables are hand-authored**, while the spec files are globbed from `src/`. PR #8 already fought a partial-install dead-link bug rooted in exactly this divergence and added a `assert_source_complete()` gate — but the gate treats the hand-authored table as truth, it doesn't *remove* the duplication. The same shape recurs: skill/agent **counts are hard-coded in `tests/test_harness.py`** and in README badges; theme keys are hand-copied across 14 JSON files.
> **Direction:** generate the `AGENT.md` tables from `src/` at build time (or assert table↔files equality in `doctor`, not just files⊆table). Derive counts; stop hard-coding them.

### 2.2 The same logic re-implemented across language/file boundaries
- **JSONC parsing** lives in three places: `build.py`, `geneseed-context.js`, `geneseed-guard.js` (the JS copies are byte-similar `stripJsonc`).
- **The distil prompt** is duplicated between `rituals/_harness_learn.py` and `geneseed-learn.js` (a `doctor` gate keeps the literal *extractable*, but nothing asserts the two copies are *equal*).
- **Python-probe and self-heal** logic is copied across `geneseed`, `geneseed.cmd`, `geneseed.ps1`, `bootstrap`, `upgrade.sh`, `sync-self.sh`.
- **Force-directed graph layout** is ~200 LOC duplicated between `web/src/pages/Graph.jsx` and `Dashboard/MiniGraph.jsx`.
> **Direction:** one shared helper per concern, per language. For the cross-language pairs (JSONC, distil prompt), pick a single source-of-truth file and load it from both sides, or add a `doctor` equality assertion.

### 2.3 Large single-responsibility-violating files
A handful of files concentrate disproportionate complexity: `web.py` (1,855), `_harness_tui.py` (1,715), `build.py` (1,225, three emit paths at ~60% shared code), `web/src/pages/Graph.jsx` (328), `web/src/styles.css` (811). The codebase *as a whole* is well-split (the `harness.py` facade + `_harness_*` modules, the web `api/`+`hooks/`+`lib/` split) — these few files are the exceptions that didn't get the same treatment.
> **Direction:** the HTTP handler → a route table; the three emit paths → one parameterized emitter; extract the graph layout util.

### 2.4 Test coverage trails the surface area
The generator core, CLI data functions, and web API functions are well-tested (~225 Python tests + web units). But the **emit modes** (opencode-global manifest/prune, claude-code layer), the **TUI**, the **lifecycle hooks**, the **JS plugins**, and the **HTTP routing layer** are largely untested — and `tests/context_delivery.test.mjs` exists but **is not run by CI** (the workflow lists only three of the four `.mjs` suites). These are exactly the surfaces a refactor would touch, so the gap makes consolidation riskier than it should be.
> **Direction:** add emit-mode fixture tests and wire the orphaned `.mjs` suite into CI *before* the structural refactors.

---

## 3. Area-by-area findings

### 3.1 Content library — `src/laws`, `src/agents`, `src/skills`, `src/memory`, `src/notebook`

**State:** the strongest part of the project. 20 laws, 16 capability agents (6 execution + 10 council seats), 27 skills, all consistent in format, with crisp triggers, "when NOT to dispatch" boundaries, output contracts, and self-improvement loops. The 10-seat council (advocate/skeptic spine + pragmatist/steward/operator/visionary/framer/empiricist/historian/user-advocate) is a genuinely sophisticated, non-redundant debate architecture.

**Concrete refinements:**
- **`laws/universal.md` Law VII ships an authoring artifact.** The line ends with `(Skill-coherence — one domain, reuse before creating — moved into {{LAW}} V.)` — an editorial note that leaked into the shipped law text. Remove it. *(Verified directly.)*
- **Law III is overloaded.** It bundles three distinct duties: verify *state* before planning, verify *claims* before asserting, and confirm *intent* when ambiguous. It reads dense. Option: keep it as one law but lead with the three duties as a short list; or split intent-confirmation into its own law (the roster has room conceptually, though renumbering touches every theme's `LEX_*`).
- **Law XIV's "non-trivial" threshold is defined in the `plan` skill, not the law.** Inline the heuristic ("more than a couple of steps, or touching several files") directly so the law is self-contained.
- **No explicit testing/verification-discipline law.** Law III privileges verification generically but nothing names automated tests as the arbiter of "done." For a code-focused harness this is conspicuous; consider folding a sentence into Law III or XI rather than adding a 21st law.
- **`memory/README.md` and `notebook/README.md` lack a worked example.** Both explain the convention well but show no sample fact-file body or notebook structure. A 4-line example each would materially speed adoption.
- **Skill-boundary fuzziness: `code-review` vs `fresh-eyes` vs `roast-me`.** All three critique an artifact; their triggers differ (diff review / spec-compliance / open-ended teardown) but a newcomer will conflate them. Add a one-line cross-reference in each "when NOT to dispatch."
- *(Correction to an earlier draft finding: the `council` skill's round-2 rebuttal is **not** under-specified — it explicitly bounds rounds and scopes rebuttal to genuine conflicts. Leave as is.)*

**New-skill candidates (ranked):** `incident-triage` (alert → root-cause → rollback/fast-fix, on-call-aware) and a `dependency-audit` (security/deprecation/license sweep) are the two most defensible additions for a code harness. `performance-profile` and `data-migration` are nice-to-haves; resist adding low-value skills (Law V — reuse before creating).

### 3.2 Generator — `build.py`

**State:** solid, well-commented, gated against partial renders. The token/STRUCTURE discipline is exemplary.

**Refactor opportunities (in priority order):**
1. **Unify the three emit paths** (`build`, `emit_opencode`, `emit_opencode_global`) behind a single `RenderContext`/`Emitter` so `render_all` changes only have to be validated once.
2. **Split `_write_native_layer`** into `_write_agents` + `_write_skills` (+ override resolution) — it currently returns a 3-tuple consumed differently at three call sites.
3. **Extract JSONC parsing** to one helper and add edge-case/fuzz tests (escaped quotes, mixed comment styles, trailing commas inside strings).
4. **Generate the `AGENT.md` tables from `src/`** (see §2.1) — removes the single most likely source of a dead-link regression.

### 3.3 CLI & TUI — `rituals/harness.py` + `_harness_*` + `_winterm.py`

**State:** the big-bang split (PR #15, 4,200 → 228-line facade + 11 modules) was the right call. The remaining smell is the **shared-namespace facade**: submodules are imported, their globals merged into one dict, then re-injected into every module. It preserves the historic flat namespace and the `import harness` surface, but it hides dependencies, defeats IDE/type tooling, and lets a rename fail silently at runtime.

**Refactor opportunities:**
- Longer-term: replace the namespace merge with explicit imports, breaking the real cycles with `if TYPE_CHECKING:` / late imports. This is an 8–10h job touching many files — schedule it deliberately, behind good tests.
- The TUI (1,715 lines) is effectively untested. Even a handful of `App.run_test`-style or pure-data-function tests would de-risk it. Note the curses panel is the dependency-free fallback; the optional Textual layer is the modern path.

### 3.4 Web server — `rituals/web.py`

**State:** API-first (pure `api_*` functions are unit-tested), security-conscious (localhost bind, `X-Geneseed-Token` on every mutation, slug-guarded memory delete, path-escape `_within` checks). Good.

**Refactor opportunities:**
- **The 900-line `make_handler`** should become an explicit route table (`{(method, pattern): handler}`) or small handler classes. This is the file's dominant complexity.
- **Broad `except Exception`** in several spots silently degrades to a 500; catch specifically and log the traceback at error level.
- **JobManager on Windows** doesn't terminate child process groups cleanly (`npm run build` can orphan children) — use `CREATE_NEW_PROCESS_GROUP`.
- Extract the markdown section-slicer + frontmatter skip into a reusable helper (it's grown two ad-hoc metadata patterns).

### 3.5 Web UI — `web/`

**State:** a lean, tasteful React 18 SPA (only `react` + `marked` at runtime), hand-rolled hash routing, hooks-only state, a single intentional "Cultivar" design system in `styles.css`. The architecture deliberately mirrors the Python layering (`lib/` ≈ `_harness_core`, `api/` thin facade). Accessibility basics are present (`aria-current`, focus outlines, listbox roles).

**Refactor opportunities (high-value, low-risk first):**
1. **Extract `layoutGraph(nodes, edges, iterations)`** — kills ~200 LOC duplicated between `Graph.jsx` and `MiniGraph.jsx`.
2. **Add `prefers-reduced-motion`** handling — genome cells and the readiness ring animate unconditionally.
3. **Extract a `TwoPane` layout** shared by Docs/Specs/Section/Library.
4. **Harden data fetching** in `useAsync`/`useJobs`: request dedup, a job-poll timeout/backoff (currently a hard 600ms forever), and fetch timeouts via `AbortController`.
5. **Mobile/responsive pass** — the 232px rail is always-on and there are no breakpoints; unusable below tablet width. Lower priority for a localhost console, but cheap to start.

**New UI ideas worth considering:** in-browser markdown editing of agent/skill/law bodies (today you must pull → edit → rebuild); a deployment/build history with rollback-to-fingerprint; graph export to SVG/PNG; a `?` keyboard-shortcut cheat sheet; syntax highlighting in markdown code blocks.

### 3.6 Documentation, themes & CI

**State:** README/SETUP/DESIGN are genuinely excellent and well-linked; 22 dated specs capture rationale; themes have a rigorous parity gate.

**Gaps & fixes:**
- **No "what's shipped" registry.** With 22 specs spanning a week and `version` frozen at `0.1.0`, it's unclear which specs are deployed vs. aspirational. Add a `SHIPPED.md` (or a `status:`/`shipped-in:` field per spec) and reconcile to a real 1.0 tag.
- **No theme-authoring kit.** Adding a theme means hand-copying ~96 keys with no template or single-file validator. Ship `themes/_TEMPLATE.json` (commented) and a `build.py --validate-theme NAME` shortcut over the existing parity logic.
- **`docs/superpowers/` overlaps `docs/specs/`.** Two parallel "plans/specs" trees (the web-UI and cultivar-reskin explorations live in `superpowers/`) invite confusion about which is canonical. Fold or clearly demarcate.
- **CI gap:** wire `tests/context_delivery.test.mjs` into the node test step (currently omitted). Consider a coverage report and at least a smoke test of the Windows launchers.
- **Web-UI user guide is missing** as prose (the UI is described in README only). A short `docs/web-ui.md` keyed to each view would help.

---

## 4. Refactor plan (phased)

Sequenced so that **safety nets land before structural change**, and high-value/low-risk work comes first.

### Phase A — De-risk (tests & guardrails first)
- [ ] Wire `context_delivery.test.mjs` into CI. *(trivial)*
- [ ] Add emit-mode fixture tests: `opencode-global` manifest+prune, `opencode` per-repo, `claude-code` layer; assert no stale files on rebuild. *(2–3h)*
- [ ] Add a `doctor` self-test (corrupt a theme key → assert it's flagged) and an `AGENT.md` table↔files equality assertion. *(1–2h)*

### Phase B — Kill cross-boundary duplication (high value, low risk)
- [ ] One JSONC helper in Python; one in JS; fuzz tests. *(2–3h)*
- [ ] Single source for the distil prompt; `doctor` asserts Python/JS copies match. *(1–2h)*
- [ ] Shared shell `_probe-python.sh` / self-heal snippet across the 6 launcher/script files. *(2–3h)*
- [ ] `layoutGraph` util shared by Graph + MiniGraph. *(2h)*

### Phase C — Decompose the big files (medium effort)
- [ ] `build.py`: unify three emit paths behind one emitter; split `_write_native_layer`. *(6–8h)*
- [ ] `web.py`: route table + specific exception handling. *(4–6h)*
- [ ] Generate `AGENT.md` tables from `src/`; derive counts; drop hard-coded test counts. *(3–4h)*

### Phase D — Structural cleanups (deliberate, behind tests)
- [ ] Replace `harness.py` namespace-merge with explicit imports (`TYPE_CHECKING` for cycles); add type hints to `_harness_*`. *(8–10h)*
- [ ] Web: `TwoPane` extraction, `useAsync` dedup + job-poll timeout, `prefers-reduced-motion`, start a responsive pass. *(ongoing)*

### Phase E — Docs & release reconciliation
- [ ] `SHIPPED.md` + per-spec status; `themes/_TEMPLATE.json` + `--validate-theme`; fold/demarcate `docs/superpowers/`; `docs/web-ui.md`; cut **1.0** and tag.

---

## 5. New ideas & design directions (ranked by leverage)

1. **Generated registries everywhere (highest leverage).** Once `AGENT.md` tables and counts are derived from `src/`, adding an agent/skill/law becomes "drop a file + add theme `DESC_`" and the parity gate catches the rest. Removes the project's most error-prone manual step.
2. **A `harness lint`/authoring assistant.** A single command (and TUI/web action) that, given a new skill/agent/theme, scaffolds the file, the `DESC_`/`LEX_` token across all themes, and the registry row — turning the multi-step authoring checklist in `_template.md` into one action. Directly serves Law V.
3. **`incident-triage` and `dependency-audit` skills** — the two genuinely missing lifecycle moves for a code harness.
4. **In-web editing loop.** Closing the edit→rebuild loop inside the web console (edit body, preview render, rebuild) would make the web UI a true authoring surface, not just a reader — a natural extension of the "web as front door" arc (PRs #17–#20).
5. **Deployment history + rollback.** The fingerprint (`.geneseed-version`) already exists; surfacing a timeline with rollback-to-fingerprint turns drift management from a diff into a first-class feature.
6. **Coverage + a tiny benchmark in CI.** Not to gate, but to make the test gap visible and prevent silent regressions in the dependency-free startup time you've worked to keep fast.

---

## 6. Suggested 1.0 definition

A defensible 1.0 is *this milestone done*, not "more features":
- Phase A + B complete (safety nets + duplication gone).
- `AGENT.md` registries generated; counts derived.
- `context_delivery` in CI; emit modes tested.
- `SHIPPED.md` reconciled; `docs/superpowers` resolved; theme-authoring kit shipped.
- Version bumped from the frozen `0.1.0` to `1.0.0` with a tag and a changelog.

Everything in Phases C–D and §5 is excellent **post-1.0** work; none of it should block the release, and most of it is safer *after* Phase A lands.

---

*Generated as a whole-project review. Findings were synthesized from a fan-out exploration across the content library, generator/CLI/scripts, web UI, and docs/tests, then cross-checked against the source directly. Nothing here has been changed in the codebase — this is the map, not the edit.*
