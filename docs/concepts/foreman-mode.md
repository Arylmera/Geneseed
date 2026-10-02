---
group: concepts
order: 10
title: "Foreman mode"
kind: "concept"
link: {"hash": "#/harness", "label": "Set the mode in Harness →"}
---
**Mode** decides how work gets executed in a session. Two modes ship: **direct**, the default, where the agent does every task itself, and **foreman**, where the session hands substantial tasks to a crew of [agents](agents.md) and keeps talking to you while they work.

> **You already know this:** a tech lead with a team. Quick questions get answered on the spot; a real feature becomes a ticket that someone builds on a branch, and the lead reviews the result before it is merged.

Mode is chosen at build time, so it does not drift mid-session, and kept across every rebuild and re-theme. It is separate from [posture](collaboration.md) (the relationship register), the doctrine packs ([Rules](rules.md)) and [footprint](footprint.md).

### direct — the default

The agent works every task itself, turn by turn. Nothing is spawned; you talk to one agent from start to finish. Keep it unless you want the session to manage work for you.

### foreman — a session that triages

The session sorts every request:

- **Trivial** — a quick answer, a one-file tweak, a question: done directly, as in direct mode.
- **Substantial** — handed to a **pipeline** running in the background. The session tells you it is running and stays free to answer you.

Expect a substantial task to cost more (a crew runs instead of one agent) in exchange for a session that never blocks on a long job.

### What a pipeline is

A **pipeline** is a small crew of agents working one task in isolation. The minimum crew depends on the task:

| Task | Minimum crew |
| --- | --- |
| development | `explorer` (analyses the request) → `developer` → `tester`, plus a lint check |
| documentation | `explorer` → `docs` |
| research | `explorer`; add `researcher` when the question leaves the repository |
| review or audit | `reviewer` + `skeptic` |

The session adds specialists on top when the task needs them — `security`, `architect`, `reviewer` and so on — never fewer than the minimum.

The crew works in its own git worktree and branch. When worktrees are unavailable it falls back to the main tree, one pipeline at a time, and says so. Two pipelines whose sets of files overlap do not run at once.

Inside the crew, the developer implements and the tester runs the tests and lint. Failures go back to the developer, at most five rounds; after that the crew stops and reports the failure, leaving the branch for you to inspect.

### A pipeline never commits or merges

When the crew is done, it hands back its worktree **uncommitted**, with the raw test and lint output and the list of files it changed. Then the session:

1. re-runs the tests and lint itself — the crew's log is the crew's account, not proof;
2. shows you the diff and the green output;
3. commits and merges **only once you accept**.

Commit, push and merge belong to the session alone, under *Consent Before Push* ([Rules](rules.md)). A crew that cannot get to green reports back instead of landing broken work.

You can also start a pipeline without foreman mode: ask the agent to "run a pipeline" for a task, and the `pipeline` [skill](skills.md) takes it from there.

### How to set it

- **Setup wizard** — asks for mode alongside voice, posture, doctrine packs and footprint:

  ```bash
  geneseed setup
  ```

- **Web console** — the per-install **Mode** dropdown on the Harness page, then **Apply**.
- **Command line** — with the emit target of the install you are changing; switch back with `--mode direct`:

  ```bash
  geneseed build --emit claude-global --mode foreman
  ```
