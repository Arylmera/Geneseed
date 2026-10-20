# Vendored skill — react-view-transitions

This folder is a third-party skill vendored **verbatim** (the frontmatter lines below aside) into Geneseed, not a
Geneseed-authored skill. It rides along in the rendered bundle and is exempt from
Geneseed's authoring gates (token, dead-link, hermeticity, skill counts) — it is
listed in the generator's `VENDORED_SKILL_DIRS`.

- **Upstream key:** react-view-transitions (repo, pinned commit, author and licence:
  `src/upstreams.json`)
- **Credit:** {{CREDIT:react-view-transitions:skills/react-view-transitions}}

The licence is MIT, declared in the upstream repo README's `## License`. Upstream ships no LICENSE
file (neither at the pinned commit nor on `main`; re-checked at 063bee94), so there is no license text to carry here
and the entry's `licenseFile` is null; the README's declaration is the whole grant.

The skill follows the [Agent Skills](https://agentskills.io/) format (`SKILL.md` +
`references/`). Its internal links point at the upstream project's own files; do not
"fix" them to Geneseed paths — that is why the folder is gate-exempt. To update,
re-copy the upstream folder (new or removed files included, e.g. `references/troubleshooting.md`), re-apply the deviations below, and bump the entry's `commit`
in `src/upstreams.json`.

**Deviation 1:** upstream's frontmatter says `name: vercel-react-view-transitions`;
here it is `name: react-view-transitions`. The Agent Skills format requires the name to
match the skill's folder, and a strict host skips a skill that breaks it —
renaming the folder instead would rename the installed skill on every host.

**Deviation 2:** upstream's `description:` writes the component as `` `<ViewTransition>` ``;
here it is `` `ViewTransition` ``. The Agent Skills spec forbids XML tags in a description, and
`checkBuild`'s description arm reports one for every first-party skill — the tag would be the
only one left in any install's catalogue.

**Deliberately not copied:** upstream's `README.md` (the repo-facing readme: install
command and folder tree, nothing an agent reads). `AGENTS.md`, upstream's compiled
all-in-one copy, IS kept — `SKILL.md`'s closing section points the agent at it.

`SKILL.md`'s frontmatter also carries `disable-model-invocation: true`, which upstream lacks: the
skill is user-only (`/react-view-transitions`), so its description stays out of the model's always-on catalogue —
it is the largest skill and serves one stack. Re-apply it on update.
