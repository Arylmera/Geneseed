---
group: reference
kind: "concept"
section: "Troubleshooting"
order: 9
title: "Update problems"
description: "Every refusal geneseed upgrade can print, and its fix."
---
Each entry gives the likely cause, the fix, and how to confirm it worked. First stop for almost anything: `geneseed doctor` (see [Troubleshooting](troubleshooting.md)).

## `geneseed upgrade` refuses to run

The upgrade is a `git pull`, so it first checks the folder. Each refusal says what to do:

| Message | Fix |
| --- | --- |
| `git is not installed or not on PATH — install git to enable updates.` | Install git, open a new terminal, retry. |
| ``This Geneseed install isn't a git checkout — update it with `npm install -g geneseed@latest`, or re-clone it with git.`` | Use the npm command for an npm install; otherwise re-clone (`git clone https://github.com/Arylmera/Geneseed.git`). |
| `You have local changes in the Geneseed folder. Commit or stash them, then update.` | `git stash` in the Geneseed folder, upgrade, then `git stash pop`. |
| ``HEAD is detached (a tag/commit is checked out). Run `git checkout <branch>` to re-enable updates.`` | `git checkout main`. |
| ``Your branch has no upstream — set one with `git branch --set-upstream-to`.`` | `git branch --set-upstream-to=origin/main`. |

**Confirm.** `geneseed upgrade` completes and `geneseed version` shows the new version. See [Upgrade](../guides/upgrade.md).

## After an upgrade to 5.0

| What you see | Cause and fix |
| --- | --- |
| `geneseed: error: invalid choice: 'sync-self'.` | The verb is gone. Run `geneseed upgrade`. |
| `geneseed: error: unrecognized arguments: imperial` from `upgrade main imperial` | `upgrade` takes only a theme. Run `geneseed upgrade imperial`. |
| A host's `memory/` folder holds only its seed | Expected: [the fold](../concepts/shared-tier.md#the-fold) moved the facts to `~/.config/geneseed/memory/`. `geneseed memory list` shows them, and the old store is in `archived-memory/<stamp>/`. |
| `[shared] <host>: … rules to approve` | Those rules wait in `user-rules.draft.md` and still bind from the host file. Ask the agent to review the pending rules; the `rule` skill decides them. |
| `[shared] <host>: fold stopped at …` | One step failed. What it did not finish stays in place, and the next emit retries. Fix the cause the line names, then run `geneseed rebuild-all`. |
| A fact named `<name>-<host>.md` | Two hosts held different text under one name. Nothing was lost. The `memory-curator` agent can merge them. |
| `[shared-tier] <host>: the carrier renders …` from `doctor` | The tier moved, for example with `$XDG_CONFIG_HOME`. Run `geneseed rebuild-all`. |

**Confirm.** `geneseed migrate --dry-run` prints `nothing to fold` for each host. See [Upgrade to 5.0](../guides/upgrade-to-5.md).
