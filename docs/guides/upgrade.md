---
group: guides
order: 25
title: "Upgrade"
kind: "concept"
section: "Keep it running"
description: "Get a new version onto every install, and keep your local edits."
---
Upgrading happens in two steps: get the new Geneseed, then rebuild every install from it. Editing or updating Geneseed changes nothing on your machine until something rebuilds. The route depends on how you installed.

**Coming from 4.x?** Read [Upgrade to 5.0](upgrade-to-5.md) first: the rebuild moves your memory, rules and profile into the [shared tier](../concepts/shared-tier.md).

## Installed from npm

```
npm install -g geneseed@latest     # get the new version
geneseed rebuild-all               # rebuild every install with its own settings
```

`rebuild-all` re-renders each registered install in place, keeping its own theme, host, footprint, posture, mode, packs and rule exclusions. It is best-effort: when one install fails, it reports the failure and carries on with the rest.

`upgrade` and `update` (and the deprecated `bootstrap`) are the clone route. Run from an npm install, they stop before touching anything and point you to `npm install -g geneseed@latest` instead.

## Installed from a clone

```
geneseed upgrade              # pull, check, rebuild; keeps theme and install mode
geneseed upgrade imperial     # the same, switching the theme
```

`upgrade` does three things:

1. It runs a fast-forward-only `git pull` from the clone's own remote, on the current branch.
2. It runs a blocking `doctor` pass over the result, and rolls back if it fails.
3. It rebuilds the bundle and every install in place.

If the `doctor` pass cannot finish, for example on a busy machine after 300 seconds, `upgrade` keeps the pull, rebuilds nothing, and exits 1. The pulled source is unchecked, not bad. Run `geneseed upgrade` again: it runs `doctor` first, rebuilds on a pass, and rolls back to the last checked commit on a failure.

A dirty working tree, or a folder that is not a git clone, is reported rather than force-updated. `update` is an alias of `upgrade`; `sync-self` was removed in 5.0.0, and `upgrade` takes only a theme (as an argument or `--theme`). `upgrade --setup` does the same and then opens the setup wizard; `bootstrap`, its old name, still works for one release and says so.

## The Update button in the web console

The **Update** button on the Overview picks its route from how this copy of Geneseed is installed:

| Install | What **Update** runs | When the button shows |
|---|---|---|
| A clone (or a worktree) | `geneseed upgrade` | When the pull can run, even with no release out, because `main` moves between releases. A clone with local changes, a detached HEAD, no upstream or a diverged branch shows no button, since the job would refuse. While the clone's own check runs, the chip says so and no button shows. |
| A global npm install (`npm root -g`/geneseed) | `npm install -g geneseed@latest`, then `geneseed rebuild-all` from the new package | When npm has a newer release. |
| Anything else (an npx cache, a project's `node_modules`, an unzipped copy) | Nothing. The Overview shows the command to run instead. | Never. |

On a clone, the Overview also says whether there is anything to pull. Once a day the console runs `git fetch` in the background and counts the commits upstream has that the clone does not: "3 commits to pull", or "up to date". The fetch has the same timeout as `upgrade` (`GENESEED_NET_TIMEOUT`, 120 s by default). If the fetch fails, the Overview shows the release check instead, and the button stays. If a release is out and the clone cannot pull, the chip's tooltip names the reasons. `GENESEED_NO_UPDATE_CHECK` turns off both the npm check and the fetch.

The console asks npm for the latest release once a day. An Overview page that stays open asks the console again every hour, and each time you come back to its tab, so it shows a new release within a day.

The npm route never uses `sudo` and never retries. If npm refuses (no permission on the global folder, a proxy, a private registry), the job log shows npm's own output. Fix the cause, or run the two commands yourself.

When the update is done, the console restarts and the page reloads. If you ran `git pull` yourself, the Overview shows a banner that the console runs old code. Click **Rebuild** on an install that is behind, or **Rebuild all behind** in the header. The console asks you to confirm, rebuilds only the installs it names, then restarts and reloads the page. If no install is behind, click **Restart** in the banner.

## The oldest install an upgrade accepts

A 1.x install must rebuild on a 4.x release first: hooks that name `harness.py` no longer read as Geneseed's.

5.0.0 no longer recognises an install built before the comms pack (3.7.0, 2026-09-27) and no longer skips it. Its carrier names `process 8` and its `Active packs:` line has no `comms`; `rebuild-all`, `upgrade`, `migrate` and the web console now rebuild it as it reads, which drops the codes rule and leaves the old rule numbers unmapped. Upgrade such an install to a 4.x release first and run `geneseed rebuild-all` there, or run `geneseed setup` for it before moving to 5.0.0.

## What an upgrade keeps

A rebuild only replaces files the install's manifest says Geneseed owns. It leaves these alone:

- the `memory/` and `notebook/` stores of a project install;
- your `context.json` and a project's `geneseed-wiki.jsonc` (an older `wiki.jsonc` is renamed to it, contents untouched);
- the marker files that record each install's choices (theme, footprint, packs, excluded rules), which every rebuild reads back;
- your own agents, skills, plugins and hooks, and any `opencode.json` or `settings.json` keys you wrote yourself;
- the `improvements/` folder (see below).

A rebuild of a global install in its host's own config directory also runs [the fold](../concepts/shared-tier.md#the-fold). That moves its facts, self-improvement notes, exclude paths and, where the tier holds only a seed, its profile and wiki manifest into `~/.config/geneseed/`. Its other rules stay in force in the host file until you decide. Nothing is deleted: the old store moves to `archived-memory/<stamp>/`. The tier itself is never rebuilt, so what you keep there survives every upgrade.

## Local edits, and the improvements file

The agent records what it learns about a skill or agent in notes, which rebuilds never overwrite: under `notes/skill-notes/` and `notes/agent-notes/` in the shared tier on a global install, and under `notebook/skill-notes/` and `notebook/agent-notes/` on a project install. Edits made to the deployed agent and skill files themselves, by you or by an older harness, are another matter: a rebuild would overwrite those, so **setup, re-theme and upgrade export them first**. When deployed files carry local edits (files only behind the source are not edits and are not exported), the differences are written to a markdown **improvements file** in `improvements/`, inside the install's own folder (for the OpenCode global install, `~/.config/opencode/improvements/`). The manifest does not list that folder, so rebuilds never overwrite it and uninstall never removes it.

A rebuild also refuses to overwrite a file you edited. The manifest records a fingerprint of every file Geneseed wrote; when a file no longer matches it, the rebuild leaves it alone and prints `kept your edited <file> — delete it to get Geneseed's copy back`. From then on the file is yours and later rebuilds skip it. A file the new version no longer ships is kept the same way, with `(no longer shipped)`. Line-ending changes from a git checkout do not count as edits. Installs made before fingerprints existed are overwritten as before.

To see the drift yourself, or to export it on demand:

```
geneseed diff                          # file-level summary of what diverged
geneseed diff --full                   # with line-level diffs
geneseed diff --out improvements.md    # write the improvements file
```

`diff` compares the global install there is by default, whatever its host (with several, the first, which it names on stderr). Pass `--target <config dir>` to compare another install. A file you replaced with a link to your own copy (a skill folder junctioned or symlinked elsewhere, say) is listed as `linked`: Geneseed never writes through a link, so it is yours and not drift, and it stays out of the improvements file. A file unmodified since its build that differs only because the source moved on is listed as behind source; a rebuild updates it, and it stays out of the improvements file too. `diff` also lists every non-empty self-improvement note, the tier's included, and `--out` copies them into the improvements file; the upgrade export does not fire on notes alone, since a rebuild cannot lose them. The improvements file is self-contained. To make the changes permanent, hand it to an agent in a Geneseed clone and ask it to fold them back into `src/`. Then they survive every future build. The **Local edits** tab of the web console's **Installs** page exports the same file.

## Moving from a clone to npm

If you installed from a clone and now want the npm package, `geneseed migrate` moves every install across in one pass. See [Migrate to npm](migrate.md).

---

**Next:** [Upgrade to 5.0](upgrade-to-5.md) · [Verify it works](verify.md) · [Uninstall](uninstall.md)
