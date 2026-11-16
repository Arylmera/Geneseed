# Vendored skill — react-view-transitions

This folder is a third-party skill vendored into Geneseed with the deviations listed below, not a
Geneseed-authored skill. It rides along in the rendered bundle and is exempt from
Geneseed's authoring gates (token, dead-link, hermeticity, skill counts) — it is
listed in the generator's `VENDORED_SKILL_DIRS`.

- **Upstream key:** react-view-transitions (repo, pinned commit, author and licence:
  `src/upstreams.json`)
- **Credit:** {{CREDIT:react-view-transitions:skills/react-view-transitions}}

The licence is MIT, declared in the upstream repo README's `## License`. Upstream ships no LICENSE
file (neither at the pinned commit nor on `main`; re-checked at 1a2c79d4), so there is no license text to carry here
and the entry's `licenseFile` is null; the README's declaration is the whole grant.

The skill follows the [Agent Skills](https://agentskills.io/) format (`SKILL.md` +
`references/`). Its internal links point at the upstream project's own files; do not
"fix" them to Geneseed paths — that is why the folder is gate-exempt. Deviation 4 below only
repoints links that miss a sibling file of this folder. To update,
re-copy the upstream folder (new or removed files included, e.g. `references/troubleshooting.md`), re-apply the deviations below, and bump the entry's `commit`
in `src/upstreams.json`. Afterwards every relative link in every `.md` here must resolve to a
file inside this folder.

**Deviation 1:** upstream's frontmatter says `name: vercel-react-view-transitions`;
here it is `name: react-view-transitions`. The Agent Skills format requires the name to
match the skill's folder, and a strict host skips a skill that breaks it —
renaming the folder instead would rename the installed skill on every host.

**Deviation 2:** upstream's `description:` writes the component as `` `<ViewTransition>` ``;
here it is `` `ViewTransition` ``. The Agent Skills spec forbids XML tags in a description, and
`checkBuild`'s description arm reports one for every first-party skill — the tag would be the
only one left in any install's catalogue.

**Deviation 4:** upstream's `AGENTS.md` is compiled from `SKILL.md` and the `references/` files,
and keeps the references' sibling-relative links, which miss at the folder root. In `AGENTS.md`
only, `](<name>.md` becomes `](references/<name>.md` for `<name>` in `css-recipes`,
`implementation`, `nextjs`, `patterns` and `troubleshooting` (any `#anchor` kept), and
`](../SKILL.md` becomes `](SKILL.md`. Links already written `](references/…` are left alone.
The other files keep upstream's links byte for byte: they already resolve.

**Deliberately not copied:** upstream's `README.md` (the repo-facing readme: install
command and folder tree, nothing an agent reads). `AGENTS.md`, upstream's compiled
all-in-one copy, IS kept — `SKILL.md`'s closing section points the agent at it.

`SKILL.md`'s frontmatter also carries `disable-model-invocation: true`, which upstream lacks: the
skill is user-only (`/react-view-transitions`), so its description stays out of the model's always-on catalogue —
it is the largest skill and serves one stack. Re-apply it on update.

**Deviation 3, at emit time:** the emit replaces `SKILL.md`'s `description:` with the skill's
line in `src/skill-descriptions.json` (at most 80 characters: the host's skill listing has a
budget) and keeps the description written here as the first body line, a blockquote
(`vendoredWithCatalogueLine`, `js/hosts/native.mjs`). This file is not changed; nothing to
re-apply on update.
