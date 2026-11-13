---
name: pr-open
description: Push the run's branch and open its pull request, or update the one already open. Never merges.
effect: read
skill: ship
outcomes: pass, fail
---
Follow the `ship` skill's pull-request path only: never merge, never enable auto-merge here (the
`factory` skill's close step arms it, only as the user's standing rule allows), never push to any
branch but this worktree's own. First look for a PR already open on this branch
(`gh pr view --json url,state` or `glab mr view`): after a rework lap it exists, and this stage
only pushes the new commits to it.

Push with `git push -u origin HEAD:<this branch>`. The push asks the user: wait for that answer,
never work around it. With no PR yet, open one (`gh pr create` / `glab mr create`) titled from the
run's title, its body built from the run's `requirement` and `input` (as `next` gives them) and
the branch's commit subjects (`git log --oneline origin/<default>..HEAD`; the loop's notes left
with its `LOOP.md`), naming the issue it closes when the input was one. Change no file in the worktree.

Report `pass` with the PR URL in a file in the OS temp directory — report that file's path. Report
`fail` when the push is refused or fails, or the PR cannot be opened, with the exact error in
such a file.
