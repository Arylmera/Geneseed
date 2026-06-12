# {{SKILL}}: document-project

> {{DESC_DOCUMENT_PROJECT}}

**Trigger:** the project's own documentation is missing, or it has drifted from the
current code — and you want the markdown docs *and* a single visual overview brought back
into line with the implementation.

## Procedure
1. **Find the doc home.** Look for an existing `docs/`, `doc/`, `documentation/`, or
   `wiki/` folder at the project root, or a `context.json` pointer to one (the same
   convention [repo-map {{SKILL}}](repo-map.md) and the context loader use). Reuse the one
   that exists — never create a second. If none exists, create `docs/` at the root.
2. **Survey the code, not the intent.** Map entry points, the public API / modules,
   commands, config, and key directories — read the actual behaviour (universal {{LAW}} III,
   {{LAW}} XVII). If there is no `ARCHITECTURE.md`, run [repo-map {{SKILL}}](repo-map.md)
   first so you have the orientation map to build on.
3. **Reconcile the markdown (whole tree).** Check every existing page against the current
   implementation — renamed or removed APIs, changed flags, dead examples — and fix the
   drift. Add pages for significant undocumented surfaces; remove docs for features that no
   longer exist (deletion is deliberate — {{LAW}} IV). For substantial writing, dispatch
   the [docs {{AGENT}}](../{{DIR_AGENTS}}/docs.md). Keep examples runnable — run them.
4. **Keep an index.** Ensure the doc home has an index/README linking every page, current
   with the set you just reconciled.
5. **Regenerate the HTML overview** — one self-contained file at the doc home (e.g.
   `docs/overview.html`), a visual parallel to the markdown. Overwrite the previous one,
   but confirm it is the generated artifact before clobbering ({{LAW}} III, {{LAW}} IV). It
   must:
   - **Stand alone, fully offline** — a single file, content pre-rendered to semantic HTML,
     all styling in one inline `<style>`, at most minimal vanilla JS (light/dark toggle, TOC
     scroll). No CDN, no external assets, no web fonts (use a system-font stack). Render any
     diagram as hand-authored inline SVG or CSS — never a CDN library.
   - **Carry the digest** — hero (project name + one-line purpose), a quick-facts strip
     (language, entry point, build/test/run, license), an architecture section (component
     cards and an inline-SVG or CSS directory tree), and links out to the markdown docs for
     depth.
   - **Go deep on the hard parts** — identify the few subsystems that carry the project's
     essential complexity (the core engine, the load-bearing algorithms, the non-obvious
     control or data flow) and render *those* in depth: a plain-language explanation, the
     key code excerpt(s) in a styled monospace block, and the flow as inline SVG. Leave
     peripheral code at digest level.
   - **Stay project-facing** — clean and professional styling, never the harness voice; and
     footer it with `mirrors commit <sha> · generated <date>` so the sync is auditable.
6. **Do not auto-publish.** Leave the changes for the user to review; stage and commit only
   on consent, via the [commit {{SKILL}}](commit.md) (universal {{LAW}} XX).

## Done when
- The doc home mirrors the current implementation: every markdown page is verified against
  the code or flagged, examples run, and the index links them all; the single-file
  `overview.html` opens offline and shows both the digest and the complex-core deep-dives;
  and any surface left undocumented is named explicitly.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- The run taught something durable that is *not* a flaw in this file — record it
  to {{MEMORY}} ({{LAW}} VI).
- No friction, nothing learned — move on; this loop earns no ceremony.
