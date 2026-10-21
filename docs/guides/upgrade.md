---
group: guides
order: 25
title: "Upgrade"
kind: "concept"
section: "Keep it running"
description: "Get a new version onto every install, and keep your local edits."
---
Upgrading happens in two steps: get the new Geneseed, then rebuild every install from it. Editing or updating Geneseed changes nothing on your machine until something rebuilds. The route depends on how you installed.

## Installed from npm

```
npm install -g geneseed@latest     # get the new version
geneseed rebuild-all               # rebuild every install with its own settings
```

`rebuild-all` re-renders each registered install in place, keeping its own theme, host, footprint, posture, mode, packs and rule exclusions. It is best-effort: when one install fails, it reports the failure and carries on with the rest.

`upgrade`, `update`, `sync-self` and `bootstrap` are the clone route. Run from an npm install, they stop before touching anything and point you to `npm install -g geneseed@latest` instead.

## Installed from a clone

```
geneseed upgrade              # pull, check, rebuild; keeps theme and install mode
geneseed upgrade imperial     # the same, switching the theme
```

`upgrade` does three things:

1. It runs a fast-forward-only `git pull` from the clone's own remote, on the current branch.
2. It runs a blocking `doctor` pass over the result, and rolls back if it fails.
3. It rebuilds the bundle and every install in place.

A dirty working tree, or a folder that is not a git clone, is reported rather than force-updated. `update` and `sync-self` are aliases of `upgrade`. `bootstrap` does the same and then opens the setup wizard (`--no-setup` skips the wizard).

## What an upgrade keeps

A rebuild only replaces files the install's manifest says Geneseed owns. It leaves these alone:

- the `memory/` and `notebook/` stores;
- your `context.json` and `geneseed-wiki.jsonc` (an older `wiki.jsonc` is renamed to it, contents untouched);
- the marker files that record each install's choices (theme, footprint, packs, excluded rules), which every rebuild reads back;
- your own agents, skills, plugins and hooks, and any `opencode.json` or `settings.json` keys you wrote yourself;
- the `improvements/` folder (see below).

## Local edits, and the improvements file

The agent records what it learns about a skill or agent in notes under `notebook/skill-notes/` and `notebook/agent-notes/`, which rebuilds never touch. Edits made to the deployed agent and skill files themselves, by you or by an older harness, are another matter: a rebuild would overwrite those, so **setup, re-theme and upgrade export them first**. When the files they are about to overwrite differ from a fresh render, the differences are written to a markdown **improvements file** in `improvements/`, inside the install's own folder (for the OpenCode global install, `~/.config/opencode/improvements/`). The manifest does not list that folder, so rebuilds never overwrite it and uninstall never removes it.

A rebuild also refuses to overwrite a file you edited. The manifest records a fingerprint of every file Geneseed wrote; when a file no longer matches it, the rebuild leaves it alone and prints `kept your edited <file> — delete it to get Geneseed's copy back`. From then on the file is yours and later rebuilds skip it. A file the new version no longer ships is kept the same way, with `(no longer shipped)`. Line-ending changes from a git checkout do not count as edits. Installs made before fingerprints existed are overwritten as before.

To see the drift yourself, or to export it on demand:

```
geneseed diff                          # file-level summary of what diverged
geneseed diff --full                   # with line-level diffs
geneseed diff --out improvements.md    # write the improvements file
```

`diff` compares the global OpenCode install by default. Pass `--target <config dir>` to compare another install. A file you replaced with a link to your own copy (a skill folder junctioned or symlinked elsewhere, say) is listed as `linked`: Geneseed never writes through a link, so it is yours and not drift, and it stays out of the improvements file. `diff` also lists every non-empty self-improvement note, and `--out` copies them into the improvements file; the upgrade export does not fire on notes alone, since a rebuild cannot lose them. The improvements file is self-contained. To make the changes permanent, hand it to an agent in a Geneseed clone and ask it to fold them back into `src/`. Then they survive every future build. The web console's **Changes** page exports the same file.

## Moving from a clone to npm

If you installed from a clone and now want the npm package, `geneseed migrate` moves every install across in one pass. See [Migrate to npm](migrate.md).

---

**Next:** [Verify it works](verify.md) · [Uninstall](uninstall.md)
