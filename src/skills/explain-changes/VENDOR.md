# Folder skill — explain-changes

Like `token-report`, this folder is **Geneseed-authored**, not third-party. It rides
the vendored-folder mechanism because it bundles an executable
(`scripts/render_changes.mjs`) and Geneseed's flat-skill pipeline renders single
`.md` files only. Listing it in the generator's `VENDORED_SKILL_DIRS` makes the
whole folder ride along verbatim into every host emit — Claude Code, IBM Bob,
OpenCode, OpenClaude.

- **Upstream:** this repository (first-party)
- **License:** same as Geneseed (see repository LICENSE)

Consequences of riding this mechanism (deliberate):

- exempt from the flat-skill authoring gates (theme DESC tokens, dead-link,
  hermeticity) — the SKILL.md carries its own frontmatter `description`, and it
  names no themed term: the notebook directory reaches the script as `--out`;
- listed in AGENT.md's folder-skills section, not the main skills table.

The script needs only `node` and `git`, both already present wherever Geneseed runs.
