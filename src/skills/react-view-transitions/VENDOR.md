# Vendored skill — react-view-transitions

This folder is a third-party skill vendored **verbatim** into Geneseed, not a
Geneseed-authored skill. It rides along in the rendered bundle and is exempt from
Geneseed's authoring gates (token, dead-link, hermeticity, skill counts) — see
`VENDORED_SKILL_DIRS` in `_build_core.py`.

- **Upstream:** https://github.com/vercel-labs/agent-skills/tree/main/skills/react-view-transitions
- **Commit:** f8a72b9603728bb92a217a879b7e62e43ad76c81
- **Author:** Vercel Engineering
- **License:** MIT (https://github.com/vercel-labs/agent-skills — `## License` → MIT)

The skill follows the [Agent Skills](https://agentskills.io/) format (`SKILL.md` +
`references/`). Its internal links point at the upstream project's own files; do not
"fix" them to Geneseed paths — that is why the folder is gate-exempt. To update,
re-copy the upstream folder and bump the commit above.
