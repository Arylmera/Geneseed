# Vendored skill — daydream

This folder is a third-party skill vendored into Geneseed, not a Geneseed-authored
skill. It rides along in the rendered bundle and is exempt from Geneseed's authoring
gates (token, dead-link, hermeticity, skill counts) — see `VENDORED_SKILL_DIRS` in
`_build_core.py`.

- **Upstream:** https://github.com/glebis/claude-skills/tree/main/daydream
- **Commit:** f47170dee300dd3d5da2a1c3c708986faeea3d5a
- **Author:** Gleb Kalinin
- **License:** MIT (declared in `.claude-plugin/plugin.json`)
- **Inspired by:** Gwern's [LLM Daydreaming](https://gwern.net/ai-daydreaming)

## Geneseed adaptation

Vault resolution is adapted to read the harness's `wiki.jsonc` knowledge-base
manifest first (a declared vault's `path`), falling back to the upstream cwd/`.obsidian`
auto-detection when no wiki is declared. The synthesis/critique still run as parallel
subagents over recency-weighted note pairs. The model-name references (`sonnet`,
`haiku`) and the `.claude/skills/daydream/…` prompt paths are upstream's; on a
non-Claude host, read the sibling `synthesizer-prompt.md` / `critic-prompt.md`
directly and dispatch through whatever subagent mechanism the host provides.

To update, re-copy the upstream folder, re-apply the wiki.jsonc adaptation in
`SKILL.md` / `instructions.md`, and bump the commit above.
