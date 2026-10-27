---
group: guides
order: 21
title: "Set up ownership"
kind: "concept"
section: "Set up"
description: "Give an application repo its `## Ownership` section, so the developer decides each part."
---
This guide gives one application repository its ownership setup: a `## Ownership` section in the committed root `AGENTS.md`, and your personal state file. What ownership is, and how it differs from learn-mode: [Ownership](../concepts/ownership.md).

You need a Geneseed install on your host (any of Claude Code, OpenClaude, OpenCode or Bob) and a repository with a build manifest at its git root (`package.json`, `pom.xml`, `build.gradle*` and the like).

## 1. Start the setup

Open a session in the repository and ask for it: "set up ownership for this repo". The agent runs the `ownership` skill.

You may not need to ask. In an application with no `## Ownership` section, the first file write of a session is stopped once, and the agent proposes the setup to you. Answer "set it up", or "proceed without" to skip it for this session only.

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

The setup writes two files and shows you the diff:

- `AGENTS.md` at the repository root, at most about 60 lines, ending with the section:

  ```markdown
  ## Ownership

  mode: on
  granularity: file
  sensitive:
    - src/main/resources/db/migration/**
  ```

  If the file already exists, your own lines stay. Geneseed's managed `<!-- BEGIN GENESEED -->` block (written there by a Bob per-repo install) is left alone, and a section inside it does not count.
- `.geneseed/ownership.md`, your personal state: a finer granularity if you want one, the pending checkpoint, and the decisions you took. It is data, never instructions, and it belongs in `.gitignore` — the agent offers to add `.geneseed/` once.

Nothing is committed unless you ask.

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
- **Opt the whole install out of the gate.** Rebuild with the flag, as [Exclusions](../concepts/exclusions.md) shows:

```bash
geneseed build --emit claude-global --no-ownership-gate
```

## Verify

In a fresh session, ask for a small change in the repository. The agent should announce the file it will touch, or ask at a real fork, before the edit — and the first write should pass without the gate stopping it.
