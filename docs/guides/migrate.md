---
group: guides
order: 20
title: "Migrate from a clone to npm"
kind: "concept"
section: "Keep it running"
description: "Move an old clone install to the npm package."
---
If you installed Geneseed by cloning the repository and now want to use the npm package, one command moves every install you already have, without touching your own settings.

## Why there is something to migrate

Claude Code, Bob and OpenClaude call Geneseed's hooks through one small file, the **hook shim** at `~/.geneseed/bin/geneseed-hook`. Every install's `settings.json` points at the shim, and the shim points at the Geneseed code it should run, which is your clone. Installing from npm moves that code. Each install also carries a `.geneseed-emit` marker, a small file that records which host and scope it was built for, so the install can be rebuilt as it was.

## Run it

Install the package first (`npm install -g geneseed`, or prefix each command with `npx`), then:

```
geneseed migrate --dry-run     # survey every install and print the plan; writes nothing
geneseed migrate               # do it
```

`migrate` rebuilds every registered install **with its own theme, host, footprint, posture and mode**. Nothing is reset to a default. It then rewrites the hook shim to point at the npm package, and reports anything it is not allowed to fix for you. A second run prints `already on the npm shape` and writes nothing.

## All or nothing

Before changing anything, `migrate` copies every host settings file and the hook shim into `~/.geneseed/.migrate-backup/`. If any install fails to rebuild, **everything is put back** and the command exits non-zero. You are never left half on one setup and half on the other.

`rebuild-all` behaves the opposite way on purpose: it carries on past a broken install so that one failure cannot block the rest.

## It refuses rather than guesses

If an install's `.geneseed-emit` marker names something this version does not recognise (a truncated or hand-edited file, for example), `migrate` **refuses the whole run**. It names the install and changes nothing. Rebuilding it would mean guessing which host and scope you chose. Fix or delete the marker, then run `migrate` again.

## What it leaves alone

`migrate` reports these instead of rewriting them:

- **Hooks it did not write.** Your own hooks and any third-party hooks stay exactly as they are. A rebuild only replaces the hook groups that Geneseed's manifest says it owns.
- **Login items.** If you set the web console to [start at login](autostart.md), you wrote that file yourself. If it still names your old clone, `migrate` prints its path and the command to put in it. You edit the file yourself.

Your clone keeps working in the meantime, so you can migrate when it suits you.
