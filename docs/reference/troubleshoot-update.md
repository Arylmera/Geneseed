---
group: reference
kind: "concept"
section: "Troubleshooting"
order: 7
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
