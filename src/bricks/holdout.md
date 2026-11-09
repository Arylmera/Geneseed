---
name: holdout
description: Play the holdout scenarios against the built change and report each one; a failure carries one sentence, never the scenario.
effect: read
agent: tester
outcomes: pass, fail, error
---
Read every scenario in the holdout folder, `$XDG_CONFIG_HOME/geneseed/holdout/<slug>/` (by default
`~/.config/geneseed/holdout/<slug>/`; `<slug>` is this branch's name after `loop/factory-`). Play
each one against the change as built on this branch: run the app, the tests or the commands its
`Given` and `When` describe, and compare what you observe with its `Then`. Never edit a file. Leave
`git status` exactly as you found it: remove any build output or log a run left in the worktree.

First read the branch's diff against the default branch it started from (`git merge-base HEAD
origin/<default>`; `gh repo view --json defaultBranchRef` or `git remote show origin` names it).
Report `error` when a changed file resolves under the holdout folder, or an added line holds that
folder's resolved absolute path (a docs line naming `~/.config/geneseed/holdout/` in general is
not a leak). Report `error` too when the folder is missing or holds no scenario (nothing played is
not a pass), or a scenario cannot be played (a tool or a service it needs is missing).

Report `pass` when every scenario passes. Report `fail` otherwise, with a file in the OS temp
directory, never in the holdout folder or the worktree, that holds ONE sentence per failed
scenario: what you observed against what was expected, e.g. "Rounding 2.5 gave 3; expected 2".
Never copy a scenario's text, its name or its `Given`/`When` into that file: it goes back to the
developer, who must never see the scenarios. Report that file's path.
