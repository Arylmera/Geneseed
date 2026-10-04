---
group: reference
kind: "concept"
section: "Troubleshooting"
order: 11
title: "Web console problems"
description: "A missing web/dist, a console that looks broken after an upgrade, no deployed harness."
---
Each entry gives the likely cause, the fix, and how to confirm it worked. First stop for almost anything: `geneseed doctor` (see [Troubleshooting](troubleshooting.md)).

## `web/dist is missing`

> `[web] web/dist is missing. Build the UI first:`
> `        cd web && npm install && npm run build`

**Cause.** The built console ships in the repo, so this only happens on a partial checkout. On an interactive terminal `geneseed web` offers to build it for you.

**Fix.** Build it from the Geneseed folder:

```bash
cd web && npm install && npm run build
```

If it instead says `web/ sources are missing`, run `geneseed upgrade` (twice on an old install).

**Confirm.** `geneseed web` opens the console.

## The console looks broken after an upgrade

Pages fail to load, or the console shows a banner: *This console is running code from before your last upgrade.* `geneseed web status` adds:

> `[web] running OLD code (started before the last upgrade) — geneseed web restart`

**Cause.** The console server serves the page it started with. An `npm install -g geneseed@latest` or a `git pull` replaces `web/dist/`, and the old page asks for files that no longer exist. `geneseed upgrade` and `geneseed rebuild-all` restart a stale console themselves; other upgrade paths do not.

**Fix.** Click **Restart** on the banner, or:

```bash
geneseed web restart
```

A browser refresh is not enough — the server, not the page, is out of date.

**Confirm.** `geneseed web status` prints no `OLD code` line and the banner is gone.

## The console says `no deployed harness`

> `[web] no deployed harness at <dir>.`

**Cause.** Nothing is installed where the console looks. It still serves, read-only, with most actions disabled.

**Fix.**

```bash
geneseed setup
```

**Confirm.** Restart the console — `geneseed web restart` — and the warning is gone.

## Skills or agents not tracked in git

**Cause.** A parent `.gitignore` blanket-ignores the bundle directory.

**Fix.** Remove the bare `Harness/` line from the parent `.gitignore`; the bundle's own `.gitignore` already scopes what to skip.

**Confirm.** `git status` lists the bundle's files.
