---
group: concepts
kind: "concept"
section: "Loops"
order: 23
title: "LOOP.md, trailers and the loop branch"
description: "The loop's state file, the trailers on every commit, the loop/* branch exemption, and the console's view."
---
## `LOOP.md` and its trailers

`LOOP.md`, at the worktree root, is both the human-readable record (title, requirement, and the
rule that you may edit `preset` or `contracts` there) and the engine's own JSON state block. Every
closing commit carries a fixed set of trailers, read straight off that state — `Loop-Gates` only
when the unit passed at least one human gate:

```
Loop-Iteration: <n>
Loop-Bricks: <every brick name visited this unit, deduplicated>
Loop-Risk-Declared: <score>
Loop-Risk-Actual: <score>
Loop-Threshold: <preset> <silent>/<soft>
Loop-Decision: silent | soft | blocking[ (amended)]
Loop-Tests: <what the loop was told about test state>
Loop-Gates: <every node whose gate passed this unit, deduplicated>
```

## The `loop/*` branch, and why merge always asks

A loop runs in its own worktree, on a branch named `loop/<slug>` — the `loop` skill creates both
with `git worktree add -b loop/<slug>` before `geneseed loop init` writes `LOOP.md` there.
While that branch is checked out and `LOOP.md` carries the engine's state marker, the git gate lets
exactly one commit/push form through without asking:

```
git add -A && git commit -F <message_file> && git push [-u] <remote> HEAD:<loop branch>
```

Nothing else is exempt — not `git commit -m`, not a quoted refspec, not a plain `git push` with no
explicit `HEAD:<ref>` — any other shape still asks. The exemption only ever covers a `loop/*`
branch, and never a shared one (`main`, `master`, `develop`, `development`, `release/*`,
`hotfix/*`). The **final** commit of a run — the one that removes `LOOP.md` on `$close` — is
outside the exemption too, because the loop is no longer running when it lands; that ask is your
consent to close it. On OpenCode there is no DYNAMIC exemption at all — the host never calls the
plugin hook it would need — so every commit still asks. Its PUSH does not: pushing a `loop/*`
branch is not pushing `main`/`master`, so OpenCode's `permission.bash` carries a static `allow`
for the loop engine's own push shapes (user decision, 2026-10-10) — a force push, a `+refspec`,
or a `--delete`/bare-`:` push to `loop/*` still asks there too.
**Merging a loop branch into anything else always asks, with no exception.**
The loop reports the branch to merge and the iterations that landed in "to review" — it never
merges for you.

## Watching a loop

Every `geneseed loop init` upserts an identity row — root, branch, title, started — into a
**loop registry** at `$XDG_CONFIG_HOME/geneseed/loops.json` (default `~/.config/geneseed/loops.json`).
`LOOP.md` stays the only source of loop *state*; the registry just lets the console find a loop
without scanning every worktree on the machine. Only loops launched by this version or later are
registered, so a loop started before the registry existed won't appear until re-initialised.

The console's **Loops › Active** tab (`GET /api/loops/active`, polled every few seconds) reads that
registry and shows one card per loop: branch, status (`running`, `awaiting`, `done`, `stopped`,
`finished`, or `unreadable` if `LOOP.md` fails to parse), `iteration N / max`, and its current
node. A loop `awaiting` a decision is highlighted with what it's waiting on — the launch, the
declared score, the actual score, or a human gate (with its node) — but **the answer is given in the agent's session**, with
`geneseed loop decide`, never from the page. A finished loop (`LOOP.md` removed) is kept, muted,
for 7 days after first being seen finished, then dropped. Selecting a card draws its ring with the
current node filled, with the iteration history (declared, actual, decision, tests) underneath.

Each live card also carries a **preset picker** (`POST /api/loops/preset`) that rewrites
`LOOP.md`'s `preset` field — the same edit you could make by hand — applying from the next score
on, not retroactively. It's the tab's only write; there is no relaunch button.
