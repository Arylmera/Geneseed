# Vendored skill — diagram-design

This folder is a third-party skill vendored into Geneseed, not a Geneseed-authored skill. It
rides along in the rendered bundle and is exempt from Geneseed's authoring gates (token,
dead-link, hermeticity, skill counts) — it is listed in the generator's `VENDORED_SKILL_DIRS`.

- **Upstream key:** diagram-design (repo, pinned commit, author and licence: `src/upstreams.json`)
- **Credit:** {{CREDIT:diagram-design:skills/diagram-design}}

The licence (MIT) is in `LICENSE`, copied from upstream's root `LICENSE` at the pinned commit.
`THIRD_PARTY_LICENSES.md` is upstream's notice file. `references/primitive-icons.md` embeds Tabler
(MIT), Simple Icons (CC0), log-z/logos (MIT) and Devicon (MIT: `spss-plain`, `rstudio-plain`)
artwork, and that file names each source and its licence. Geneseed appended one section to it: the
full MIT texts, with their copyright lines, of Tabler, log-z/logos and Devicon, fetched from each
repository's `LICENSE` on its default branch on 2026-10-29 (upstream only linked to them). Some paths
the notice names (`scripts/vendor/`, `assets/logo.svg`, `assets/icons.html`) are not vendored, and
its "one-off sourced icons" (SAS, Stata) were removed, see below.

The skill follows the [Agent Skills](https://agentskills.io/) format (`SKILL.md` + `references/`
+ `assets/`). The first-run style-guide gate (SKILL.md §0) is upstream's and is kept as is.

## What was trimmed

Upstream's `skills/diagram-design/` is about 5.9 MB. This copy keeps about 0.8 MB:

- **Kept:** `SKILL.md`; every `references/*.md` except the six below; the five
  `assets/template*.html` files (§10 tells the agent to copy them); two examples,
  `assets/example-venn.html` and `assets/example-architecture.html`.
- **Dropped:** `scripts/` (six Python helpers — Geneseed carries no Python at runtime); the other
  ~218 `assets/example-*.html` files and `assets/icons.html` (a gallery of the icons
  `references/primitive-icons.md` already holds); `references/export.md` and
  `references/export-registry.md` (the Python/Playwright export helpers); `references/doctor.md`
  (Python and host-plugin diagnostics); `references/import-drawio.md`,
  `references/import-mermaid.md` and `references/import-excalidraw.md` (built around the
  Python extractors). Upstream's repository files (plugin manifests, `commands/`, `prompts/`,
  `docs/`, the repository-level `scripts/verify-*.py`) were never part of the skill folder.

SKILL.md §10 and some references still name `example-<type>.html` files and `assets/icons.html` in
code spans; those files are not shipped. Many type references name upstream's repository-level
verifiers (`scripts/verify-*.py`) in prose; those are not shipped either.

## Modifications

Each one removes a dependency on a dropped file. Re-apply them on update.

- `SKILL.md` §6: the icon bullet no longer links the `assets/icons.html` gallery; rule 6 no longer
  tells the agent to run the geometry verifier.
- `SKILL.md` §9: the geometry-verifier and motion-verifier runs are cut; the `self_check.py` item
  is now a check by hand of the same five properties.
- `SKILL.md` §11: the route-by-source links to the three import references are replaced by the
  list of source formats, and step 1 reads the source file as text instead of running an extractor.
- `SKILL.md` §12: the "Exporting to PNG / SVG" body is replaced by one paragraph: this copy ships no
  export helpers, so an `.svg` is the `<svg>` node copied out of the `.html`, and a `.png` cannot be
  made.
- `SKILL.md` frontmatter: the description says "HTML/SVG" where upstream says "HTML/SVG/PNG".
- `SKILL.md` §10: the Consultant-special row points at `type-quadrant.md` instead of the dropped
  `example-quadrant-consultant.html`.
- `SKILL.md` §11: the Format dial marks `png` and `html+png` as not available.
- `references/primitive-icons.md`: five marks are removed — `hop`, `pentaho`, `dagster`, `sas`,
  `stata`. Upstream sourced them by direct fetch and marked each "verify license before use".
- `references/output-spec.md`: the format table, the destination table and the checklist mark
  `png` / `html+png` as not available; the label-width check measures in the browser instead of
  running upstream's geometry verifier.
- `references/onboarding.md`: the `/regenerate-examples` flow is marked as not shipped.
- `THIRD_PARTY_LICENSES.md`: the licence-text section is appended (see above).
- `references/animation.md`: the three-command verifier block is replaced by "check these by hand".
- `references/output-spec.md`: two links to `export.md` are removed; the render-linter
  command is named as upstream's and not shipped.
- `references/primitives-core.md`: three geometry-verifier commands are cut.
- `references/style-guide.md`: the export/self-check commands become "check that the Google Fonts
  link is no longer present".
- `references/type-architecture-delta.md`: the verifier commands are named as upstream's and not
  shipped.
- `references/type-treemap.md`: the render-linter command is named as upstream's and not shipped.

Every Markdown link left in the folder resolves inside it. No Python invocation remains (the
repository's no-Python gates scan `src/`).

To update, re-copy the kept files from upstream's `skills/diagram-design/`, re-apply the
modifications above, check that no new file needs a script, and bump the entry's `commit` in
`src/upstreams.json`.
