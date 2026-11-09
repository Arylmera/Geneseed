---
name: holdout-write
description: Write 3 to 8 holdout scenarios for the work item, outside the worktree, where the developer never reads them.
effect: read
agent: tester
outcomes: pass, fail
---
The stage hands you the work item's file (or the spec) as `carry`. Read it in full, then the code
it names. Write 3 to 8 scenarios that a correct change must pass and a careless one may not: each
one a short prose file with three lines, `Given` (the starting state), `When` (one act a user or a
caller takes) and `Then` (the behaviour a user can see), concrete enough to play by hand or with a
command. Cover the acceptance criteria, plus the edges they imply but do not name.

Write them to the holdout folder, `$XDG_CONFIG_HOME/geneseed/holdout/<slug>/` (by default
`~/.config/geneseed/holdout/<slug>/`), one `NN-<name>.md` per scenario; `<slug>` is this branch's
name after `loop/factory-`. Never write into the worktree, never into any brief, note or carry.
When that folder already holds files (an earlier run with the same slug), write nothing and report
`fail`: the user decides whether to clear it.

Report `pass` with the `carry` you were handed, unchanged: the next stage needs the work item, and
must never get the scenarios' content or the folder's path. Report `fail` when the work item gives
too little to write three scenarios, or the folder is not empty — say why in a file in the OS temp
directory, and report its path.
