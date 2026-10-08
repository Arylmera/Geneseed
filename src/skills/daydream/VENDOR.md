# Vendored skill — daydream

This folder is a third-party skill vendored into Geneseed, not a Geneseed-authored
skill. It rides along in the rendered bundle and is exempt from Geneseed's authoring
gates (token, dead-link, hermeticity, skill counts) — it is listed in the
generator's `VENDORED_SKILL_DIRS`.

- **Upstream:** https://github.com/glebis/claude-skills/tree/main/daydream
- **Commit:** f47170dee300dd3d5da2a1c3c708986faeea3d5a
- **Author:** Gleb Kalinin
- **License:** MIT (declared in `.claude-plugin/plugin.json`). The text is in `LICENSE`,
  copied from upstream's root `LICENSE` as added in 93677f479f40ab43520883e7a6c954b755ab39ef
  (the pinned commit predates the file; its copyright line covers 2025-2026).
- **Inspired by:** Gwern's [LLM Daydreaming](https://gwern.net/ai-daydreaming)

## Geneseed adaptation

Vault resolution is adapted to read the harness's `geneseed-wiki.jsonc` knowledge-base
manifest first (a declared vault's `path`), falling back to the upstream cwd/`.obsidian`
auto-detection when no wiki is declared. The synthesis/critique still run as parallel
subagents over recency-weighted note pairs. The model-name references (`sonnet`,
`haiku`) and the `.claude/skills/daydream/…` prompt paths are upstream's; on a
non-Claude host, read the sibling `synthesizer-prompt.md` / `critic-prompt.md`
directly and dispatch through whatever subagent mechanism the host provides.

`SKILL.md` also carries a `name`/`description` frontmatter that upstream lacks — without it
a host that registers skills from frontmatter (the Agent Skills format: Claude Code, Bob, …)
never lists the skill — and points the agent at `instructions.md`, which upstream leaves to
its slash command. Sibling files are named through the this-skill-directory placeholder (see
`SKILL_DIR_PLACEHOLDER` in `js/hosts/native.mjs`), which the emit resolves for a host that
does not tell the model where a skill lives.

To update, re-copy the upstream folder, re-apply the geneseed-wiki.jsonc adaptation, the
frontmatter and the placeholder paths in `SKILL.md` / `instructions.md`, and
bump the commit above.
