---
group: guides
order: 26
title: "Migrate from a clone to npm"
kind: "concept"
section: "Keep it running"
description: "Move an old clone install to the npm package."
---
If you installed Geneseed by cloning the repository and now want to use the npm package, one command moves every install you already have, without touching your own settings.

## Why there is something to migrate

Claude Code, Bob and OpenClaude call Geneseed's hooks through one small file, the **hook shim** at `~/.geneseed/bin/geneseed-hook`. Every install's `settings.json` points at the shim, and the shim points at the Geneseed code it should run, which is your clone. Installing from npm moves that code. Each install also carries a `.geneseed-emit` marker, a small file that records which host and scope it was built for, so the install can be rebuilt as it was.

## Run it

Install the package first (`npm install -g geneseed`), then run these from it:

```
geneseed migrate --dry-run     # survey every install, print the plan and the fold report; writes nothing
geneseed migrate               # do it
```

`migrate` rebuilds every registered install **with its own theme, host, footprint, posture and mode**. Nothing is reset to a default. Each rebuild of a Claude Code, Bob or OpenClaude install rewrites the hook shim to name the Geneseed that runs the rebuild, so it now names the npm package. `migrate` does not write the shim itself, and OpenCode has none. It then reports anything it is not allowed to fix for you. A second run prints `already on the npm shape` and writes nothing.

**It runs only from the npm package.** From a git clone or a bundle, a real run has nothing to move: the rebuild would point the shim back at that same copy. So it refuses with exit 3 before it writes anything, and says to use `geneseed update`. An `npx` run refuses too: npm prunes that cache, and the shim would die with it. `--dry-run` works from anywhere. Outside the package it previews the fold, then says a real run would refuse.

`--dry-run` also previews [the fold](../concepts/shared-tier.md#the-fold) for each global install, even on a machine that has already migrated, because the fold runs in every global emit. Each host is read against the shared tier as it stands, so two hosts that hold the same new fact both count it. It also prints `would prune` for each retired skill folder that the next global emit moves aside, and `orphan` for each unowned file it leaves alone ([retired skills](../concepts/shared-tier.md#retired-skills)).

## All or nothing

Before changing anything, `migrate` copies every host settings file and the hook shim into `~/.geneseed/.migrate-backup/`. If any install fails to rebuild, **everything is put back** and the command exits non-zero. You are never left half on one setup and half on the other. What an earlier install folded into the shared tier stays there: the tier and the host layer are read together, so nothing is lost.

`rebuild-all` behaves the opposite way on purpose: it carries on past a broken install so that one failure cannot block the rest.

## It refuses rather than guesses

If an install's `.geneseed-emit` marker names something this version does not recognise (a truncated or hand-edited file, for example), `migrate` **refuses the whole run**. It names the install and changes nothing. Rebuilding it would mean guessing which host and scope you chose. Fix or delete the marker, then run `migrate` again.

## What it leaves alone

`migrate` reports these instead of rewriting them:

- **Hooks it did not write.** Your own hooks and any third-party hooks stay exactly as they are. A rebuild only replaces the hook groups that Geneseed's manifest says it owns.
- **Login items.** If the web console [starts at login](autostart.md) and its login item still names your old clone, `migrate` prints its path and the command to put in it. If Settings wrote that file, use **Update** on the **Start at login** row. If you wrote it yourself, edit it yourself.

Your clone keeps working in the meantime, so you can migrate when it suits you.
