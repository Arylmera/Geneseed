# {{SKILL}}: document-project

> {{DESC_DOCUMENT_PROJECT}}

**Trigger:** the project's docs are missing or have drifted from the code, or it needs a PRD, a design system, an architecture document or an AGENTS.md. Existing codebases only — every document is extracted from the code, never written ahead of it.

**Argument:** `[prd|design|architecture|agents|all]` — optional. It names the doc-set members to
write; with none, step 3 proposes them.

## Procedure
1. **Find the doc home.** Look for an existing `docs/`, `doc/`, `documentation/`, or
   `wiki/` folder at the project root, or a `context.json` pointer to one (the same
   convention [repo-map {{SKILL}}](repo-map.md) and the context loader use). Reuse the one
   that exists — never create a second. If none exists, create `docs/` at the root.
2. **Survey the code, not the intent.** Map entry points, the public API / modules,
   commands, config, and key directories — read the actual behaviour (universal {{LAW}} III,
   {{DOCTRINE}} process 4). If there is no `ARCHITECTURE.md`, run [repo-map {{SKILL}}](repo-map.md)
   first so you have the orientation map to build on.
3. **Select the doc set.** Unless the argument names the targets, propose which of the four
   documents apply and wait for the user's go-ahead — e.g. "no UI detected (no stylesheet,
   theme, or component tree) — skipping `DESIGN.md`". `AGENTS.md`, `PRD.md` and
   `architecture.md` apply to every project; `DESIGN.md` only when a UI exists.
   `all` still skips `DESIGN.md` when no UI exists, and says so in one line.
4. **Write or refresh each selected document** from its template in *The doc set* below,
   under the rules in *Re-runs*. **Invent nothing**: every claim cites `path:line`, or carries
   the marker `⚠ to confirm` (in the user's language). When drafting is done, put every `⚠` to
   the user as **one** batch of questions — not one at a time — and fold the answers in as plain
   text. A command you could not run is recorded as `⚠ fails: <error>`, never as working.
   Every document follows the three page conventions in step 5.
5. **Reconcile the markdown (whole tree).** Check every existing page against the current
   implementation — renamed or removed APIs, changed flags, dead examples — and fix the
   drift. Add pages for significant undocumented surfaces; remove docs for features that no
   longer exist (deletion is deliberate — {{LAW}} IV). For substantial writing, dispatch
   the [docs {{AGENT}}](../{{DIR_AGENTS}}/docs.md). Keep examples runnable — run them.
   Every generated page follows three conventions:
   - **Typed frontmatter.** Open each page with YAML frontmatter carrying `type:` (one of
     `overview`, `module`, `api`, `flow`, `how-to`, `prd`, `design-system`, `architecture`),
     `mirrors-commit: <sha>`, and `generated: <date>` — so drift is auditable per page, not only
     in the HTML footer. The doc-home `index.md` is reserved and carries no frontmatter, and
     neither does the root `AGENTS.md` (agents read it raw) — though it still takes the
     fences below.
   - **Fenced generated regions.** Wrap each generated **section** between
     `<!-- geneseed:doc:start -->` and `<!-- geneseed:doc:end -->` markers — one pair per
     section, so prose a reader adds between sections survives — and on re-runs rewrite *only*
     inside them; hand-authored prose outside the markers is never touched.
   - **Diagrams as Mermaid, keyed by purpose.** In the markdown, render diagrams as fenced
     `mermaid` code blocks — they render natively on GitHub, Obsidian, and VS Code with no
     dependency. Pick the kind by what you are showing: sequence for runtime/request flows,
     ER for data models, state for lifecycles, flowchart for control flow and C4 views. Reserve
     hand-authored inline SVG for the offline HTML only (step 7).
6. **Keep an index.** Ensure the doc home has an index/README linking every page, the doc-set
   members included, current with the set you just reconciled.
7. **Regenerate the HTML** — self-contained files at the doc home, a visual parallel to the
   markdown and never a source of truth: regenerate them whole from the markdown each run
   ({{DOCTRINE}} ops 3: edit the source, not the surface).
   Overwrite the previous ones, but confirm each is the generated artifact before clobbering
   ({{LAW}} III, {{LAW}} IV). Both files:
   - **Stand alone, fully offline** — a single file, content pre-rendered to semantic HTML,
     all styling in one inline `<style>`, at most minimal vanilla JS (light/dark toggle, TOC
     scroll). No CDN, no external assets, no web fonts (use a system-font stack). Render any
     diagram as hand-authored inline SVG or CSS — never a CDN library.
   - **Stay project-facing** — clean and professional styling, never the harness voice; and
     footer it with `mirrors commit <sha> · generated <date>` so the sync is auditable.

   **`overview.html`** (always) must:
   - **Carry the digest** — hero (project name + one-line purpose), a quick-facts strip
     (language, entry point, build/test/run, license), an architecture section (component
     cards and an inline-SVG or CSS directory tree), and links out to the markdown docs for
     depth.
   - **Go deep on the hard parts** — identify the few subsystems that carry the project's
     essential complexity (the core engine, the load-bearing algorithms, the non-obvious
     control or data flow) and render *those* in depth: a plain-language explanation, the
     key code excerpt(s) in a styled monospace block, and the flow as inline SVG. Leave
     peripheral code at digest level.
   - **Present the doc set** that exists — *Product*: the one-line problem, FR and NFR counts
     per status as ✅ ◐ ✗ pills, journeys as cards, a link to `PRD.md`. *Architecture*: C4 L1
     and L2 as inline SVG, the ADR list (ID, title, one-line decision), a link to
     `architecture.md` for L3. *Design*: the main palette as a strip and a link to
     `design.html`.

   **`design.html`** (only when `DESIGN.md` exists) renders the design system as seen, not
   read: colour swatches with role and a computed AA/AAA contrast badge; the type scale at real
   sizes and weights; spacing, radius and shadow on sample squares; components as cards
   (variants, states, path) — no live rendering, which would need the project's framework; and
   the hard-coded-value drift in a separate callout.
8. **Do not auto-publish.** Leave the changes for the user to review; stage and commit only
   on consent, via the [commit {{SKILL}}](commit.md) ({{DOCTRINE}} process 5).

## The doc set

### `docs/PRD.md` — `type: prd`
One product PRD for the whole project — the intent reconstructed from the code and the user.
1. **Problem** — 2–4 sentences.
2. **Users** — the roles, inferred from auth, permissions, and screens.
3. **Goals**, then 4. **Non-goals** — the least code-derivable sections; expect most `⚠` here.
5. **User journeys** — the top 3–5, as "As a … I want … so that …"; add a Mermaid sequence
   diagram when more than two actors take part.
6. **Functional requirements** — a table `ID | Requirement | Acceptance criteria | Status | Code`.
   IDs run `FR-001`, `FR-002`, …; the requirement is one present-tense sentence; the acceptance
   criteria a checklist; the status ✅ implemented, ◐ partial, ✗ absent, or `retired`; the code
   the implementing path. Source them from routes, commands, screens, and tests.
7. **Non-functional requirements** — the same table plus a `Threshold` column, IDs `NFR-001`, ….
   The threshold is the measurable value the code or config fixes (timeout, rate limit, size
   budget), else `⚠`.

### `docs/DESIGN.md` — `type: design-system`
Only when a UI exists.
1. **Principles** — 3–5 lines on the visual character the code shows.
2. **Tokens** — one table per family (colour, typography, spacing, radius, shadow, motion):
   `Name | Value | Role | Source`. Colours add their semantic role and their WCAG 2.x contrast
   ratio (relative luminance) against the reference background; flag every pair below WCAG AA.
   A family the code has no scale for keeps its heading and one line: `⚠ no <family> scale
   found`. List **hard-coded values** found outside the token system separately, as drift —
   never legitimise them as tokens.
3. **Components** — each reusable component: role, variants, states, key props, path.
4. **Usage rules** — do / don't for layout, accessibility, and UI copy tone. Only rules the code
   actually follows — never generic best practice.

### `docs/architecture.md` — `type: architecture`
The detailed architecture. Open with a link to the root `ARCHITECTURE.md` (repo-map's short
map) and make sure the map links back — one fenced `geneseed:doc` line at its top, nothing else
in that file touched; repeat nothing between the two.
1. **Context (C4 L1)** — the system, its actors, and the external systems (APIs, SSO, shared
   databases), as a Mermaid flowchart.
2. **Containers (C4 L2)** — the deployable units and the protocols between them.
3. **Components (C4 L3)** — one diagram per *significant* container, not one per module. On a
   monorepo, work one container or package at a time.
4. **Decisions** — lightweight inline ADRs, `ADR-001`, …, four lines each: *context · decision ·
   consequences · evidence*. Structural choices only (framework, storage, architectural style,
   decomposition) — not details.

### `AGENTS.md` — repo root, at most ~60 lines
The short manual an agent reads before touching the repo.
1. **Commands** — build, test, lint, run: exact, and verified by running each one.
2. **Non-obvious conventions**.
3. **Do not touch** — generated files, vendored code, applied migrations.
4. **Before you change…** — targeted pointers: a UI → `docs/DESIGN.md`; a new flow or
   container → `docs/architecture.md`; a feature → `docs/PRD.md` (its FR ID).

Geneseed may own a block in this file, between `<!-- BEGIN GENESEED -->` and
`<!-- END GENESEED -->` — never write inside it. Create the file if it is absent; if it holds
only that block, add the project sections below it.

## Re-runs
- **Reader prose is sacred.** Rewrite only inside a section's `geneseed:doc` fences. A
  document that already exists **without** fences (a hand-written `PRD.md`, say) is never
  rewritten: offer to fence the sections you recognise, or to leave it and report its drift —
  the user chooses.
- **IDs are stable.** Before rewriting, read the existing FR, NFR and ADR tables. Keep every
  ID and any wording the user corrected; update only *Status*, *Code*, *Threshold*, and
  *Evidence*; append new rows with the next free number. A requirement that disappears becomes
  `retired` — never deleted, never renumbered. An ADR the code no longer bears is marked
  `superseded`, never deleted.
- **`mirrors-commit` moves only with a rewrite.** A document outside this run's target keeps
  its old value, so its staleness stays visible.
- **An answered `⚠` stays answered** — it is plain text now, not re-asked unless the code
  contradicts it.

## Done when
- Every selected doc-set member exists, follows its template, and cites its evidence or
  carries `⚠`; the batch of `⚠` questions has been put to the user.
- The doc home mirrors the current implementation: every markdown page carries typed
  frontmatter, wraps its generated sections in `geneseed:doc` markers, and is verified against
  the code or flagged; examples run, Mermaid fences are well-formed, and the index links
  them all.
- `overview.html` opens offline and shows the digest, the complex-core deep-dives, and the
  doc set; `design.html` does too wherever `DESIGN.md` exists; and any surface left
  undocumented is named explicitly.

<!-- INCLUDE: skills/_self-improvement.md -->
