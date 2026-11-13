---
group: guides
order: 24.6
title: "Auto-merge green PRs"
kind: "concept"
section: "Factories"
description: "Let the forge merge a PR the agent opens once its required checks are green: how to turn it on and off, the forge settings it needs, and the three tiers."
---
Auto-merge ships **off**. When it is off, the agent opens a PR and the merge stays yours. When you
turn it on, the agent arms the forge's own auto-merge on a PR it opens, and the forge merges the
PR when its required checks pass. The agent never decides that a PR is green: the forge does
(`external-gate`).

## Turn it on or off

Say **"turn on auto-merge"**. The `rule` skill asks one question, every repo or this project only,
then shows a standing rule for `user-rules.md` and writes it on your yes:

```
## R<n> — Auto-merge green PRs
(scope: global | source: user, <date>)
Arm auto-merge on a PR I open, only when the forge has required checks.
- docs-tests: auto
- normal: human        # human | reviewer
- sensitive: never
```

The rule files are layered: shared, then host, then project, and the later layer wins. So a
global rule sets the default and a project's own copy overrides it. To turn it off, say **"turn
off auto-merge"**: the agent removes the rule, or writes a project copy with all three lines
`never`. The first time the agent opens a PR in a repo with no rule, it tells you once that
auto-merge is off and how to turn it on.

The rule arms only the forge's merge. Every push still asks you (`consent-before-push`).

## The tiers

The agent sorts each PR by its diff, the first match wins:

| Tier | When | What the rule line does |
|---|---|---|
| `sensitive` | Any file in a sensitive zone: each `sensitive:` zone of the repo's `AGENTS.md` ownership block (see [Set up ownership](set-up-ownership.md)), plus auth and authz, secrets and credentials, data migrations and schema, CI and deploy config, dependency manifests and lockfiles, release and versioning, gate and hook config | `never`: the PR stays open for you |
| `normal` | Any code | `human`: arms only when the forge also requires one approving review. `reviewer`: arms after the agent's blind reviewer passes, with its verdict in the PR body |
| `docs-tests` | Docs and tests only | `auto`: arms |

A missing or unreadable value counts as `human`. Use `reviewer` only in a solo repo: GitHub does not
let you approve your own PR, and a PR the agent opens carries your identity, so `human` would never
merge there.

## Forge settings it needs

The agent arms auto-merge only when it can read all of these. When it cannot, it does not arm, and
the merge stays yours.

| Setting | GitHub | GitLab |
|---|---|---|
| Auto-merge allowed | Settings › General › *Allow auto-merge* | On by default |
| Required checks on the base branch | A ruleset or branch protection with required status checks | Settings › Merge requests › *Pipelines must succeed* |
| One approving review (`normal: human`) | Required approvals in the ruleset or branch protection | An approval rule |
| Backstop on sensitive paths (recommended) | `CODEOWNERS` plus *Require review from Code Owners* | `CODEOWNERS` plus code owner approval on the protected branch |

The agent arms with the reviewed head pinned, so a later push cannot ride an earlier arming:

```bash
gh pr merge <pr> --auto --squash --match-head-commit <sha>
glab mr merge <mr> --auto-merge --squash --sha <sha>
```

GitLab cancels auto-merge on a new push. GitHub keeps it armed for a pusher with write access,
which is why the head is pinned. `glab mr merge` arms auto-merge by default, so the agent always
names the flag.

## On each host

The rule is text in the `ship` and `factory` skills. No Geneseed gate guards a merge command, so all
four hosts behave the same:

| Host | What guards `gh pr merge` / `glab mr merge` |
|---|---|
| Claude Code | Nothing: the git gate matches only `git commit` and `git push` |
| OpenClaude | Same as Claude Code |
| OpenCode | Nothing: the permission globs cover only `git commit*` and `git push*` |
| Bob | Nothing: consent is a log line |

An MCP merge tool (a GitHub MCP server's merge, or a host's own auto-merge tool) is not a shell
command, so no shell gate sees it on any host. The forge's required checks and reviews are the
boundary.

A [factory](run-a-factory.md) follows the same rule: at the end of a green run it arms auto-merge
when the rule allows, and otherwise asks you once whether to merge.
