---
group: guides
order: 21
title: "Set up ownership"
kind: "concept"
section: "Set up"
description: "Give an application repo its `## Ownership` section, so the developer decides each part."
---
This guide gives one application repository its ownership setup: a `## Ownership` section in the committed root `AGENTS.md`. What ownership is, and how it differs from learn-mode: [Ownership](../concepts/ownership.md).

You need a Geneseed install on your host (any of Claude Code, OpenClaude, OpenCode or Bob) and a repository with a build manifest at its git root (`package.json`, `pom.xml`, `build.gradle*` and the like).

## 1. Start the setup

Open a session in the repository and ask for it: "set up ownership for this repo". The agent runs the `ownership` skill.

You may not need to ask. In an application with no `## Ownership` section, the first file write of a session is stopped once, and the agent proposes the setup to you, with three answers:

- **Set it up now.** The steps below.
- **Skip this session.** Nothing is written; the proposal comes back in the next session.
- **Skip in this repo until I ask.** For you alone, in this repo only: the agent writes `Setup: declined <date>` into your personal `.geneseed/ownership.md` in the main worktree (from a linked git worktree, the main checkout's), so it holds in every later worktree too. From then on the gate does not stop you and the agent proposes nothing. Each session starts with the reminder `Ownership: setup declined since <date> — not set up; say "set up ownership" to run it`, which the agent repeats once. It has no expiry: delete the line, or ask for the setup (which removes it). A `## Ownership` section in `AGENTS.md`, on or off, outranks it.

## 2. Review the conventions it found

The agent reads the code first and writes nothing yet. It proposes the conventions it found: naming, layers, test patterns, build and test commands. Correct what is wrong. If the stack matches a [kit](../concepts/kits.md) (`spring-boot`, `react`), it proposes that kit too.

## 3. Answer the questions

About five questions, one at a time, each with a recommended answer:

1. Are the conventions right?
2. Ownership on for this repo? (`mode: on`, or `mode: off` to opt the repo out)
3. The default granularity: `feature`, `file` (recommended) or `function`.
4. The sensitive zones: paths where every change is a checkpoint, such as `payment/`, database migrations or security configuration.
5. Any free-form project rules.

## 4. Check the diff

The setup writes one file and shows you the diff:

- `AGENTS.md` at the repository root, at most about 60 lines, ending with the section:

  ```markdown
  ## Ownership

  mode: on
  granularity: file
  sensitive:
    - src/main/resources/db/migration/**
  ```

  If the file already exists, your own lines stay. Geneseed's managed `<!-- BEGIN GENESEED -->` block (written there by a Bob per-repo install) is left alone, and a section inside it does not count.
Nothing is committed unless you ask.

The setup writes no personal state; it only removes your `Setup: declined` line, if you had one. `.geneseed/ownership.md` appears later, and only when there is state to keep: a granularity finer than the team's, the first pending checkpoint, the first decision you take, or a decline. Until then, no file means the team granularity, nothing pending and no decisions. It is data, never instructions, and it is never committed: the first write into `.geneseed/` also creates `.geneseed/.gitignore`, which keeps the folder personal by default and lets only the team's files back in:

```gitignore
/*
!/.gitignore
!/bricks/
!/loops/
!/protected-checks.txt
!/done-checks.txt
```

The `.gitignore` does not ignore itself, so you can commit it and give the team the same rule. An existing `.geneseed/.gitignore` is never overwritten, and your root `.gitignore` is not touched.

## 5. Check how diffs reach you

Under ownership, the host's own diff prompt is how you approve a routine step. The setup checks the permission mode:

- **Claude Code, OpenClaude.** If edits are auto-accepted (bypass or accept-edits mode), no diff stops for you. Switch back to asking, or keep it: the agent then shows a compact diff in the chat and waits for your reply.
- **OpenCode.** The agent proposes `permission.edit: "ask"` in the project `opencode.json`.

## 6. Commit `AGENTS.md`

Commit the root `AGENTS.md` with the repository, so the whole team works under the same section. From then on the first-write gate stays quiet in this repo, and every session runs the checkpoints at the team's granularity.

## Change it later

- **Finer for one task.** Say "go finer here", or "do the rest in one go" to propose a coarser batch.
- **The team default.** Edit `granularity:` in `AGENTS.md` and commit it.
- **Opt the repo out.** Set `mode: off`. The gate stays quiet, and no checkpoint runs.
- **Skip it for yourself only.** Answer "skip in this repo until I ask" to the proposal, or write `Setup: declined <YYYY-MM-DD>` into `.geneseed/ownership.md` yourself. The team's `AGENTS.md` does not change.
- **Opt the whole install out of the gate.** Rebuild with the flag, as [Exclusions](../concepts/exclusions.md) shows. The install's `AGENT.md` then carries no ownership proposal either, and no decline reminder prints:

```bash
geneseed build --emit claude-global --no-ownership-gate
```

## Verify

In a fresh session, ask for a small change in the repository. The agent should announce the file it will touch, or ask at a real fork, before the edit — and the first write should pass without the gate stopping it.
