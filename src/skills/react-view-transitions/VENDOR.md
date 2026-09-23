# Vendored skill — react-view-transitions

This folder is a third-party skill vendored **verbatim** into Geneseed, not a
Geneseed-authored skill. It rides along in the rendered bundle and is exempt from
Geneseed's authoring gates (token, dead-link, hermeticity, skill counts) — it is
listed in the generator's `VENDORED_SKILL_DIRS`.

- **Upstream:** https://github.com/vercel-labs/agent-skills/tree/main/skills/react-view-transitions
- **Commit:** f8a72b9603728bb92a217a879b7e62e43ad76c81
- **Author:** Vercel Engineering
- **License:** MIT (https://github.com/vercel-labs/agent-skills — `## License` → MIT).
  Upstream ships no LICENSE file (neither at the pinned commit nor on `main`), so there
  is no license text to carry here; the README's declaration is the whole grant.

The skill follows the [Agent Skills](https://agentskills.io/) format (`SKILL.md` +
`references/`). Its internal links point at the upstream project's own files; do not
"fix" them to Geneseed paths — that is why the folder is gate-exempt. To update,
re-copy the upstream folder and bump the commit above.

**Deliberately not copied:** upstream's `README.md` (the repo-facing readme: install
command and folder tree, nothing an agent reads). `AGENTS.md`, upstream's compiled
all-in-one copy, IS kept — `SKILL.md`'s closing section points the agent at it.
