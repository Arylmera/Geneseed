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
- Before any further push to a PR with auto-merge armed, disarm it first, then classify, review and arm again on the new head.
```

The rule files are layered: shared, then host, then project, and the later layer wins. So a
global rule sets the default and a project's own copy overrides it. To turn it off, say **"turn
off auto-merge"**: the agent removes the rule, or writes a project copy with all three tier lines
`never`. When a repo has no rule, the agent tells you once per session in that repo, when it
opens a PR there, that auto-merge is off and how to turn it on.

The rule is your durable authorization for the forge's merge (`deletion-is-deliberate`). It arms
only that merge: every push still asks you (`consent-before-push`).

## The tiers

The agent sorts each PR by its diff, the first match wins:

| Tier | When | Accepted values |
|---|---|---|
| `sensitive` | Any file in a sensitive zone: each `sensitive:` zone of the ownership block in the **base** branch's `AGENTS.md` (see [Set up ownership](set-up-ownership.md)), plus auth and authz, secrets and credentials, data migrations and schema, CI and deploy config, dependency manifests and lockfiles, release and versioning, gate and hook config, `AGENTS.md`, `CLAUDE.md`, `CODEOWNERS`, any `user-rules.md`, agent, skill and instruction files, and gate machinery (check scripts, CI-only harnesses, coverage thresholds; not ordinary unit tests) | None: it never arms, whatever the rule says |
| `docs-tests` | Every file is docs (prose that is neither shipped nor executed) or tests, and no test or assertion is removed, skipped or loosened (that diff is `normal`) | `auto`, `human`, `reviewer`, `never` |
| `normal` | Anything else | `human`, `reviewer`, `never` (`auto` is not valid) |

`auto` arms. `human` arms only when the forge also requires one approving review and dismisses it on a new push. `reviewer` arms
after the agent's blind reviewer passes, with its verdict added to the PR body first (in a factory,
the `review-panel` verdict). `never` does not arm. A missing or other value counts as `human`. Use `reviewer` only in a solo repo: GitHub does not
let you approve your own PR, and a PR the agent opens carries your identity, so `human` would never
merge there.

## Forge settings it needs

The agent arms auto-merge only when it can read all of these. When it cannot, it does not arm, and
the merge stays yours.

| Setting | GitHub (how the agent reads it) | GitLab |
|---|---|---|
| Auto-merge allowed | Settings › General › *Allow auto-merge* (`gh repo view --json autoMergeAllowed`) | No switch: GitLab offers auto-merge on every project, so the agent checks this on GitHub only |
| Required checks on the base branch | A ruleset (`required_status_checks` in `gh api repos/{owner}/{repo}/rules/branches/<base>`) or branch protection (`required_status_checks` in `.../branches/<base>/protection`), with a non-empty list of checks: an empty list requires nothing, and `--auto` then merges at once | *Pipelines must succeed* (`only_allow_merge_if_pipeline_succeeds` in `glab api projects/:id`) |
| One approving review (`human`) | A ruleset `pull_request` rule, or branch protection, with `required_approving_review_count` of 1 or more | An approval rule with `approvals_required` of 1 or more (`glab api projects/:id/approval_rules`) |
| Stale approvals (required for `human`) | *Dismiss stale pull request approvals when new commits are pushed* (`dismiss_stale_reviews_on_push` in the ruleset, `dismiss_stale_reviews` in the protection) | *Remove all approvals when commits are added* (`reset_approvals_on_push` in `glab api projects/:id/approvals`) |
| Backstop on sensitive paths (recommended) | `CODEOWNERS` plus *Require review from Code Owners* | `CODEOWNERS` plus code owner approval on the protected branch |

The agent arms on the head it classified and reviewed:

```bash
gh pr merge <pr> --auto --squash --match-head-commit <sha>
glab mr merge <mr> --auto-merge --squash --sha <sha>
```

`glab mr merge` arms auto-merge by default, so the agent always names the flag. On GitHub the
pinned head is checked only when auto-merge is armed: an armed PR stays armed after a later push by
someone with write access. So before any further push to an armed PR, the agent disarms it
(`gh pr merge <pr> --disable-auto`; on GitLab, `POST
projects/:id/merge_requests/:iid/cancel_merge_when_pipeline_succeeds` through `glab api`), then
classifies, reviews and arms again on the new head. If the head is already green when the agent
arms, the forge merges at once.

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
