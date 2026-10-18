---
group: reference
kind: "concept"
section: "Troubleshooting"
order: 10
title: "Doctor findings"
description: "Unresolved tokens, a drifted Harness bundle, an unreadable registry.json."
---
Each entry gives the likely cause, the fix, and how to confirm it worked. First stop for almost anything: `geneseed doctor` (see [Troubleshooting](troubleshooting.md)).

## `unresolved token … in …`

**Cause.** A theme JSON lacks a key the templates use — usually a custom theme that fell behind.

**Fix.** Compare it with `themes/neutral.json`: every key there must exist in your theme. Then re-render:

```bash
geneseed build --theme <yours>
```

**Confirm.** `geneseed doctor --theme <yours>` is clean.

## A committed `Harness/` bundle drifted from `src/`

**Cause.** A bundle committed to a repo was rendered from an older `src/`, or was edited in place.

**Fix.** Re-render and commit it:

```bash
geneseed build
git add Harness
```

If the drift is your own edits, export them first — `geneseed diff` (or the console's **Changes** page) writes them up so they can be folded back into `src/`.

**Confirm.** `geneseed doctor` no longer reports the bundle.

## `[probe] … registered but not refusing` / `refuses everything` / `does not run`

> `[probe] ~/.claude: git-gate under Git Bash registered but not refusing — …`

These come only from `geneseed doctor --probe`. It runs each installed gate exactly as the host's
settings spell it, through the host's own shell, on `git reflog expire --expire=now --all` (which must be refused)
and `git status` (which must go through). A gate wired with `--no-deletion-gate` lets the first one
through by design, so it is probed on `find / -name geneseed-probe` instead — a root-wide scan it
must still refuse. An OpenCode install's guard plugin has no command to
run: the probe imports it and calls its hook through both plugin APIs (V1 and V2), with `rm -rf /`
as the call it must refuse. `GENESEED_GUARD=off` or `warn` in your terminal makes that a note,
not a failure.

**Cause.**
- **Not refusing:** the gate launches but lets a destructive call through. Usually something in
  the install tells it to stand down: an exclusion covering the temp folder, or a command that
  lost its `--host bob`.
- **Refuses everything:** the gate asks on every call. This is typically the hooks emitted for
  one shell and run under another.
- **Does not run:** the shim or its runner is gone, or the shell is missing.

**Fix.**

```bash
geneseed rebuild-all
```

**Confirm.** `geneseed doctor --probe` prints `[probe] N gate(s) refused a destructive call and let
a safe one through`.

The probe runs under *this terminal's* environment (PATH, HOME), not the host app's. A host started
with a different environment can still break a gate that passes here.

## `registry.json unreadable` / `registry.json is not valid JSON`

> `[authoring] registry.json unreadable: …`

**Cause.** The Geneseed folder's `registry.json` is missing or damaged — typically a bad merge or a hand edit. The web console stays up, but every entity's status badge reads "unknown".

**Fix.** Restore the shipped copy (this discards any local edit to that one file):

```bash
git -C <geneseed folder> restore registry.json
```

**Confirm.** `geneseed doctor` no longer names `registry.json`, and the badges come back.
