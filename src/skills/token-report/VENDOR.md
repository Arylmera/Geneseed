# Folder skill — token-report

Unlike its siblings in `VENDORED_SKILL_DIRS`, this folder is **Geneseed-authored**,
not third-party. It rides the vendored-folder mechanism because it bundles an
executable (`scripts/token_report.mjs`) and Geneseed's flat-skill pipeline renders
single `.md` files only. Listing it in the generator's `VENDORED_SKILL_DIRS`
makes the whole folder ride along verbatim into every host emit — Claude Code,
IBM Bob, OpenCode, OpenClaude — which is exactly what a multi-file skill needs.

- **Upstream:** this repository (first-party)
- **License:** same as Geneseed (see repository LICENSE)

Consequences of riding this mechanism (deliberate):

- exempt from the flat-skill authoring gates (theme DESC tokens, dead-link,
  hermeticity, skill counts) — the SKILL.md here carries its own frontmatter
  `description` and blockquote purpose line instead;
- listed in AGENT.md's folder-skills section, not the main skills table;
- at emit time the `description:` of `SKILL.md` is replaced with the skill's line in
  `src/skill-descriptions.json` (at most 80 characters: the host's skill listing has a budget),
  and the description written here is kept as the first body line, a blockquote
  (`vendoredWithCatalogueLine`, `js/hosts/native.mjs`).

The script supports all four emitted hosts, with exact usage on each.
If a host changes its session storage layout, fix the corresponding finder or
parser in `scripts/token_report.mjs`.
