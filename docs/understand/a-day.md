---
group: understand
order: 7
title: "A day with the harness"
kind: "concept"
section: "Day to day"
description: "The moments you will actually meet: a push that asks first, a skill, a delegation, a memory."
---
After the install you talk to your tool the way you always did. What changes is what the agent already knows when you start, and what happens at a few specific moments. Here are four of them.

Start with one prompt on your first day:

> *"Use the profile skill."*

The agent interviews you briefly and drafts `PROFILE.md`: your role, your stack, and whether you want terse answers or explanations. From then on every session starts with it.

### 1. The agent tries to push

You ask the agent to clean up history and it decides to force-push `main`. A gate runs before the shell does, so the command waits for you. (A force-push to its own feature branch would not stop here: the gate asks only when data would really be lost.) On Claude Code it looks like this (the prompt's layout depends on your version; the reason text is Geneseed's):

```text
● Bash(git push --force origin main)
  Geneseed (Deletion Is Deliberate) — `git push` would force-push the protected
  branch main. Confirm this specific command, or leave the data in place.
  Do you want to proceed?  Yes / No
```

An ordinary `git commit` or `git push` gets a milder question when the **process** pack is on: *"Geneseed (Consent Before Push) — every git commit/push needs explicit approval; to see the change first, use the explain-changes skill"*. If you answer no, the command does not run, however the model phrased its reasoning.

Bob has no prompt, so the same force-push is refused outright:

```text
[geneseed] BLOCKED: Geneseed (Deletion Is Deliberate) — `git push` would force-push the protected branch main. Confirm this specific command, or leave the data in place.
```

OpenCode has no prompt a plugin can raise, so Geneseed's guard plugin refuses it the same way. Every catch goes into a log, and `geneseed status` counts the catches by rule.

### 2. You call a skill by name

A **skill** is a written procedure the agent follows step by step. You call it in plain English:

> *"Use the brainstorm skill on this feature request."*

The agent loads the skill's full text only now. Until then it carried just the skill's name and one-line description. `brainstorm` turns a raw idea into a design you approve before any code is written. Skills chain together: *"Use brainstorm, then plan, for how to add rate limiting."*

### 3. You hand work to a specialist

An **agent** is a specialist with a narrow job and its own instructions. The main agent delegates to it:

> *"Delegate to the reviewer agent on the staged diff."*

The reviewer reads the change, runs the tests, and comes back with findings ordered correctness-first, each pointing at a `file:line`. It ends with a one-line verdict: ship, fix-then-ship, or block. The reviewer only reads; it does not edit your code.

### 4. The session teaches the next one

When a session winds down, the **learn** step reads the conversation and keeps what is worth remembering. On OpenCode this happens by itself, with the model the session already uses. On Claude Code it is off until you set `GENESEED_LLM` to a model command, for example `claude -p`.

A new file appears in the install's `memory/` folder:

```markdown
---
name: integration-tests-need-docker
description: the integration suite needs a running Docker daemon
type: project
---
The integration tests start Postgres in a container; run `docker info` before the suite.
```

and one line is added to its topic file, `memory/topics/project.md` (the topic is the fact's `topic:`, else its `type:`):

```markdown
- [integration-tests-need-docker](../integration-tests-need-docker.md) — the integration suite needs a running Docker daemon
```

`memory/MEMORY.md` stays a short map, one line per topic with its fact count. Next session, that map is in front of the agent before your first message, and the agent opens the topic file a task needs. If a later session refines that fact, learn updates the same file instead of adding a twin, keeping the old version in `memory/archive/`; if it shows the fact is obsolete, the file moves to `memory/archive/` and leaves the index. Memory stays on your machine. `geneseed memory list` shows every fact and `geneseed memory rm <name>` moves one to `memory/archive/` (`--purge` deletes it for good). When a topic grows past 40 facts or facts land in `misc`, the session says so in one line, and the `memory-curator` agent tidies the store in bulk.

---

**Next:** [Enforced vs. asked](enforced-vs-asked.md)
