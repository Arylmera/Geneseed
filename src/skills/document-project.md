# {{SKILL}}: document-project

> {{DESC_DOCUMENT_PROJECT}}

**Trigger:** the project's docs are missing or have drifted from the code, or it needs a PRD, a design system, an architecture document or an AGENTS.md. Existing codebases only — every document is extracted from the code, never written ahead of it.

**Argument:** `[prd|design|architecture|agents|all]` — optional. It names the doc-set members to
write; with none, step 5 proposes them.

## Procedure
1. **Find the doc home.** Look for an existing `docs/`, `doc/`, `documentation/`, or
   `wiki/` folder at the project root, or a `context.json` pointer to one (the same
   convention [repo-map {{SKILL}}](repo-map.md) and the context loader use). Reuse the one
   that exists — never create a second. If none exists, create `docs/` at the root.
2. **Pick the docs format** — Markdown or AsciiDoc, once per project. A `Docs format:
   markdown|asciidoc` line in the root `AGENTS.md` decides; never re-decide it. Otherwise
   look at the project's existing docs (the doc home and the root `README`), ignoring the
   agent-runtime files below: only `.md` → Markdown; only `.adoc` → AsciiDoc; both → ask
   the user; no docs yet → AsciiDoc. Record the result as that line under *Non-obvious
   conventions* in `AGENTS.md`.
   - **Agent-runtime files stay Markdown whatever the format:** `AGENTS.md`, `CLAUDE.md`,
     `SKILL.md`, and the specs and ADR files that loops read — the tools need them so.
   - **In a Markdown project, propose — never impose — a switch to AsciiDoc** when the docs
     would gain from it: complex tables, many diagrams, content reused across pages,
     several versions, or PDF output. Say which need you saw, once; the user decides, and a
     yes rewrites the recorded line.
   - **In AsciiDoc,** apply *AsciiDoc mode* below wherever this skill shows Markdown.
3. **Interview first when the project has no docs yet** — before writing anything. The code
   gives the *what*; only the user gives the *why*. Ask one question at a time, offering
   options where you can: the audience and what they need to do; the project's purpose;
   goals and non-goals; the key decisions and the reason for each; constraints; what is out
   of scope. Read any spec, ADRs or design notes that exist, for facts. When an answer
   explains a decision, offer to record it as an ADR (in `architecture`'s *Decisions*) —
   accept or skip. Draft only once the user says the interview is done. Skip this step on a
   re-run or when docs exist: their prose already carries the intent.
4. **Survey the code, not the intent.** Map entry points, the public API / modules,
   commands, config, and key directories — read the actual behaviour ({{LAW:verify-before-asserting}},
   {{DOCTRINE:read-the-docs-first}}). If there is no `ARCHITECTURE.md`, run [repo-map {{SKILL}}](repo-map.md)
   first so you have the orientation map to build on.
5. **Select the doc set.** Unless the argument names the targets, propose which of the four
   documents apply and wait for the user's go-ahead — e.g. "no UI detected (no stylesheet,
   theme, or component tree) — skipping `DESIGN.md`". `AGENTS.md`, `PRD.md` and
   `architecture.md` apply to every project; `DESIGN.md` only when a UI exists.
   `all` still skips `DESIGN.md` when no UI exists, and says so in one line.
6. **Write or refresh each selected document** from its template in *The doc set* below,
   under the rules in *Re-runs*. **Invent nothing**: every claim cites `path:line`, or carries
   the marker `⚠ to confirm` (in the user's language). When drafting is done, put every `⚠` to
   the user as **one** batch of questions — not one at a time — and fold the answers in as plain
   text. A command you could not run is recorded as `⚠ fails: <error>`, never as working.
   Every document follows the three page conventions in step 7.
7. **Reconcile the docs (whole tree).** Check every existing page against the current
   implementation — renamed or removed APIs, changed flags, dead examples — and fix the
   drift. Add pages for significant undocumented surfaces; remove docs for features that no
   longer exist ({{LAW:deletion-is-deliberate}}). For substantial writing, dispatch
   the [docs {{AGENT}}](../{{DIR_AGENTS}}/docs.md). Keep examples runnable — run them.
   Every generated page follows three conventions (in AsciiDoc mode, their *AsciiDoc mode*
   forms):
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
   - **Diagrams as Mermaid, keyed by purpose.** In the doc pages, render diagrams as fenced
     `mermaid` code blocks — they render natively on GitHub, Obsidian, and VS Code with no
     dependency. Pick the kind by what you are showing: sequence for runtime/request flows,
     ER for data models, state for lifecycles, flowchart for control flow and C4 views. Reserve
     hand-authored inline SVG for the offline HTML only (step 9).
8. **Keep an index.** Ensure the doc home has an index/README linking every page, the doc-set
   members included, current with the set you just reconciled.
9. **Regenerate the HTML** — self-contained files at the doc home, a visual parallel to the
   doc pages and never a source of truth: regenerate them whole from the pages each run
   ({{DOCTRINE:edit-the-source-not-the-surface}}).
   Overwrite the previous ones, but confirm each is the generated artifact before clobbering
   ({{LAW:verify-before-asserting}}, {{LAW:deletion-is-deliberate}}). Both files:
   - **Stand alone, fully offline** — a single file, content pre-rendered to semantic HTML,
     all styling in one inline `<style>`, at most minimal vanilla JS (light/dark toggle, TOC
     scroll). No CDN, no external assets, no web fonts (use a system-font stack). Render any
     diagram as hand-authored inline SVG or CSS — never a CDN library.
   - **Stay project-facing** — clean and professional styling, never the harness voice; and
     footer it with `mirrors commit <sha> · generated <date>` so the sync is auditable.

   **`overview.html`** (always) must:
   - **Carry the digest** — hero (project name + one-line purpose), a quick-facts strip
     (language, entry point, build/test/run, license), an architecture section (component
     cards and an inline-SVG or CSS directory tree), and links out to the doc pages for
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
10. **Do not auto-publish.** Leave the changes for the user to review; stage and commit only
   on consent, via the [commit {{SKILL}}](commit.md) ({{DOCTRINE:consent-before-push}}).

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
2. **Non-obvious conventions** — first, the `Docs format:` line from step 2.
3. **Do not touch** — generated files, vendored code, applied migrations.
4. **Before you change…** — targeted pointers: a UI → `docs/DESIGN.md`; a new flow or
   container → `docs/architecture.md`; a feature → `docs/PRD.md` (its FR ID) — with the
   extension the docs format gives them.

Geneseed may own a block in this file, between `<!-- BEGIN GENESEED -->` and
`<!-- END GENESEED -->` — never write inside it. Create the file if it is absent; if it holds
only that block, add the project sections below it.

## AsciiDoc mode
When step 2 picks AsciiDoc, every doc page this skill writes is AsciiDoc; `AGENTS.md` and
the other agent-runtime files stay Markdown.
- **Page names:** `.adoc` for every page — `PRD.adoc`, `DESIGN.adoc`, `architecture.adoc`,
  `index.adoc`. A `README.adoc` is fine: GitHub shows it as the repo homepage.
- **Typed header, not frontmatter:** the page title (`= Title`) followed by attributes —
  `:geneseed-type: prd`, `:geneseed-mirrors-commit: <sha>`, `:geneseed-generated: <date>`.
  `index.adoc` carries none.
- **Fences:** `// geneseed:doc:start` and `// geneseed:doc:end` comment lines, one pair per
  section, with the same rewrite-only-inside rule.
- **Diagrams:** Mermaid in a `[source,mermaid]` listing block delimited by `----` — GitHub
  renders it like a Markdown `mermaid` fence. Not `[mermaid]` blocks (asciidoctor-diagram)
  and no STEM: GitHub renders neither.
- **No `include::`** in a generated page — GitHub does not resolve it, and an agent reading
  the raw file would see the directive instead of the content. Each page reads whole on its
  own, and no Markdown copy is kept beside it: two sources drift.
- **Tables** use `|===` blocks; the FR/NFR columns are unchanged.

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
- The doc home mirrors the current implementation: every page carries typed frontmatter
  (header attributes in AsciiDoc mode), wraps its generated sections in `geneseed:doc` markers, and is verified against
  the code or flagged; examples run, Mermaid fences are well-formed, and the index links
  them all.
- `overview.html` opens offline and shows the digest, the complex-core deep-dives, and the
  doc set; `design.html` does too wherever `DESIGN.md` exists; and any surface left
  undocumented is named explicitly.
- `AGENTS.md` records the `Docs format:` line.
- In AsciiDoc mode, every page written passes `asciidoctor --failure-level=WARN -o - <page>`
  (output discarded) when `asciidoctor` is on PATH. Without it, the report says
  `asciidoctor lint: SKIPPED — not installed` — never silently passed over, never installed
  for the user.

<!-- INCLUDE: skills/_self-improvement.md -->
