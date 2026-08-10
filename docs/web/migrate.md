---
group: howto
order: 7
title: "Migrate an existing install to npx"
kind: "concept"
---
If you installed Geneseed by cloning the repository, your hooks currently run through a small machine-wide shim at `~/.geneseed/bin/geneseed-hook` that hands every call to *your checkout's* Python. Installing from npm changes where that code lives. **`geneseed migrate` moves every install you already have onto the new shape, in one pass, without touching your own settings.**

### What it does

```
geneseed migrate --dry-run     # survey and print the plan; writes nothing
geneseed migrate               # do it
```

It surveys every registered install, re-emits each one **in its own theme, emit, footprint, posture and mode** — nothing is defaulted, so a rebuild never silently changes what you chose — re-bakes the machine-wide hook shim so it points at the new location, and reports anything it is not allowed to fix for you.

Run it once, from the new install. A second run says `already on the npm shape` and writes nothing.

### It is all-or-nothing

Before it changes anything, `migrate` copies every host settings file and the hook shim into `~/.geneseed/.migrate-backup/`. If any install fails to rebuild, **everything is put back** and the run exits non-zero. You are never left half on one shape and half on the other. `rebuild-all` deliberately continues past a broken install so one failure cannot block the rest; a migration deliberately does the opposite.

### It refuses rather than guesses

If a registered install carries a `.geneseed-emit` marker that names something this generator does not recognise — a truncated or hand-edited file — `migrate` **refuses the whole run**, names the install, and changes nothing. Rebuilding it would mean guessing which host and scope you installed, and re-emitting an install as something its owner never chose is worse than stopping. Fix or delete the marker and re-run.

### What it will not touch

Two things are yours, and `migrate` reports them instead of rewriting them:

- **Hooks it did not write.** Your own hooks, and any third-party ones, are left exactly as they are — the re-emit only replaces the hook groups Geneseed's own manifest claims.
- **Autostart entries.** If you set the web UI to [start at login](#/docs/autostart), that VBS script or LaunchAgent is a file you hand-wrote — Geneseed has never created one. If it still names your old checkout, `migrate` prints its path and the command to put there. Edit it yourself.

If your `settings.json` has comments in it, Geneseed will not rewrite the file at all (it never has — your edits are safe), so the hooks in it stay pointing at the old shim until you update them by hand.

### Your old clone keeps working

Nothing breaks the day you install from npm. A cloned checkout continues to work for one full release, printing the migration instructions when you `git pull`. There is no cliff — migrate when it suits you.
