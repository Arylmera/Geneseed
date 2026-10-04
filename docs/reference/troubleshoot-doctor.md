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

## `registry.json unreadable` / `registry.json is not valid JSON`

> `[authoring] registry.json unreadable: …`

**Cause.** The Geneseed folder's `registry.json` is missing or damaged — typically a bad merge or a hand edit. The web console stays up, but every entity's status badge reads "unknown".

**Fix.** Restore the shipped copy (this discards any local edit to that one file):

```bash
git -C <geneseed folder> restore registry.json
```

**Confirm.** `geneseed doctor` no longer names `registry.json`, and the badges come back.
