---
group: understand
order: 13
title: "Choices: install, uninstall, update"
kind: "concept"
section: "Why it works this way"
description: "What Geneseed writes on your machine, how it takes it back, and why."
---
What Geneseed writes on your machine, and how it takes it back. Part of [Why Geneseed works this way](design-choices.md); the other parts cover [the shape of the harness](design-choices-shape.md), [gates](design-choices-gates.md), [hosts](design-choices-hosts.md), and [engineering, skills and agents](design-choices-engineering.md).

- **Uninstall needs no backup, by construction.** Your root file gets a delimited managed block, settings files are merged key by key, skills and agents are claimed only when Geneseed created them, and uninstall deletes only what the manifest owns. Nothing of yours is overwritten, so there is nothing to restore. See [ADR 0004](../adr/0004-uninstall-without-backups.md) and [Taking it back out](take-it-out.md).
- **A settings file with comments is refused, never rewritten.** Rewriting it would drop your comments; Geneseed prints what to add by hand instead. See [ADR 0004](../adr/0004-uninstall-without-backups.md).
- **Every emit runs its stages in one order: render, wire, prune, manifest, verify.** A render writes a whole file, so it must never follow a wire step that has just reconciled your settings into it. See [DESIGN.md](../../DESIGN.md).
- **Self-update is a fast-forward `git pull` plus a rebuild, and a dirty tree stops it.** Locked-down corporate Windows machines block scripts and archives but allow git, so git is the one route that works everywhere a clone does. See [ADR 0009](../adr/0009-self-update-is-a-git-pull.md) and [Upgrade](../guides/upgrade.md).
- **`upgrade` runs `rebuild-all`.** A bundle is a render, so a change reaches an install only when it is emitted again. See [Upgrade](../guides/upgrade.md) and [Migrate from a clone to npm](../guides/migrate.md).
- **The installers check for Node and git and never install them.** Installing a prerequisite would make Geneseed a package manager on machines where software arrives through IT; the installer names what is missing and where to get it. See [From a clone](../guides/install-clone.md).
- **A `--config-dir` preview is never registered, and the only dry run is `geneseed validate`.** A registered preview folder would be rebuilt by every `rebuild-all`, and the generator may not start the process a dry run needs. See [Verify it works](../guides/verify.md) and [Environment variables](../reference/environment.md).
- **Uninstalling one host from a shared repo hands the root marker to the host that remains.** The marker names the install, so leaving the removed host's name there would drop the other host from the registry. See [Uninstall](../guides/uninstall.md).
- **The old wiki file name, `wiki.jsonc`, is still read when `geneseed-wiki.jsonc` is absent, with no end date.** Removing the fallback would silently lose a wiki configured under the old name. See [Context and memory variables](../reference/env-context.md) and [Connect your wiki](../guides/wiki.md).
