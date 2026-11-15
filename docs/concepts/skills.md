---
group: concepts
order: 5
title: "Skills"
kind: "concept"
section: "Harness"
description: "Written playbooks the agent follows for a repeatable task."
link: {"hash": "#/section/skills", "label": "Browse the catalog →"}
---
A **skill** is a repeatable workflow written as a markdown playbook: when it applies, the steps, and what "done" looks like. The agent reads the playbook before acting, so a task it has a skill for is done the same careful way every time instead of improvised.

> **You already know this:** a runbook. Nobody deploys from memory — you open the deploy runbook and follow it. A skill is that runbook, addressed to the agent.

{N_SKILLS} skills ship. Each is authored once under `src/skills/` and installed under `skills/` in the install, where the host looks for skills.

### How a skill gets used

- **By name.** Ask for it — "brainstorm this", "run a council on it" — or, on hosts with slash commands, type `/<name>`.
- **By trigger.** Every skill has a one-line description of its purpose and when it applies. The host shows those descriptions to the agent every turn, and the agent opens the matching skill when your request fits.
- **User-only skills.** A few skills are marked to open only when *you* call them (a teaching drill, a tool tied to a setup the agent cannot see, a guide for one stack or one personal vault). They answer `/<name>` but the agent never starts them on its own, and their description stays out of the always-loaded list.

### A tour

| You want to… | Skill |
| --- | --- |
| turn a raw idea into an approved design before any code | `brainstorm` |
| write a plan to a file before a non-trivial task | `plan` |
| drive a change through smallest change → tests → green suite | `develop` |
| find a bug by evidence: reproduce, isolate, root-cause, verify | `debug` |
| answer a question from the open web, every claim cross-checked | `research` |
| have several viewpoints debate a decision | `council` |
| get an adversarial critique of your own ask, plan or idea | `roast-me` |
| present a subject as slides in one offline HTML file | `deck` |
| see what a change does before you agree to commit it | `explain-changes` |
| stage the right paths and write a focused commit | `commit` |
| open a pull request, or finish and merge a branch | `ship` |
| decide whether something is a standing rule or a fact to remember | `rule` |
| be taught a topic, or quizzed on it (`/quiz` opens it too) | `teach` |
| have every reply lead with the next action and keep the state in view (ADHD mode) | `adhd` |

The full list, with each description, is in the catalog.

### Skills improve themselves

Every skill ends with one beat of reflection: if a step misled or a step was missing, the agent ends its reply with one line, `spec-feedback: [skill:<name>] <the fix> [— situation: <when it applies>] — seen: <what happened, against what was expected>`. When the turn ends, the hook copies that line, dated and with no model call, into the skill's notes file, `notebook/skill-notes/<name>.md` (`notes/skill-notes/<name>.md` in the [shared tier](shared-tier.md) on a global install), and the skill reads those notes the next time it runs (see [Hooks](hooks.md)). The agent used to be told to write the file itself, and it never did. It never edits the installed skill itself: that file is rendered from `src/`, and a rebuild would overwrite the edit. A bundled script that is broken is the one exception: fix it in place, and tell the user which file you changed. Agents work the same way through `agent-notes/`. Each note is one line that carries its evidence, `- [skill] <correction> [— situation: <when it applies>] — seen: <what happened, against what was expected> (<skill>, <date>)` (a line you write by hand may omit the skill's name, and the hook never drops it): `situation:` says where the correction holds (it is optional, and older lines without it stay valid; without it, the circumstance in `seen:` stands in), and `seen:` is what you judge the correction by before folding it in. A line tagged `[skill:<name>:general]` marks a fix other skills need too: it goes into `skill-notes/_general.md`, which every skill reads. On Bob, whose hook never sees the reply, the agent appends the line itself. `geneseed diff` lists the notes so you can fold them back into `src/`. Folding a skill or agent note is your call: the `skill-forge` skill first replays one past task whose original ask still exists, as two dispatched agents from the pre-fix revision, one told to read no notes and one given the note. The `fresh-eyes` skill freezes one rubric from the ask and judges both results blind against it. A note is folded only when it wins, on the result or on a stated process gain; on a tie or a loss you decide whether to keep or delete it. A trivial wording fix skips that probe. Most runs end with nothing to change.

### Old names keep working

When two skills merge, the old name still works as a slash command: `/deps-audit` runs `dependencies`, and `/ci-fix` runs `debug`. The old names are user-only, so the agent's list shows each skill once. If you had left out a skill that was later merged, a rebuild leaves out the merged skill instead. A skill removed with no replacement is dropped from that list, with a note.

### What they cost

The skill *bodies* are read only when used. The *descriptions* are listed to the agent every turn so it can pick the right one — that list is part of the always-on cost described in [Footprint](footprint.md).

### The listing budget on Claude Code

Claude Code builds the skill list under a character budget: the model's context window, times about 3 characters per token, times `skillListingBudgetFraction` (default 0.01). That is about 6 000 characters on a 200k-token model and 30 000 on a 1M one. Its bundled skills always keep their text. When the list is over budget, the other skills that are used least lose their description and show as a bare name, and the agent no longer knows when to use them. A fresh install on a 200k model lost all of them.

`geneseed build --context-window 200k|1m` (default `200k`) tells the build which model the install is for. On a Claude Code emit it writes two keys into the settings file Geneseed already merges (`settings.json`, or `settings.local.json` for a project):

| `--context-window` | `skillListingMaxDescChars` | `skillListingBudgetFraction` | Budget at 3 characters per token |
| --- | --- | --- | --- |
| `200k` | 80 | 0.013 | 7 800 |
| `1m` | 120 | not set (default 0.01) | 30 000 |

`skillListingMaxDescChars` cuts *every* skill's description to that length, Claude Code's own and other plugins' included, so each one costs less. Simulated on a fresh install (the 14 bundled skills and 46 Geneseed skills, no usage yet):

- `200k`: at the default fraction, every description fits with 395 characters to spare, and 113 with one kit. Five skills of your own would push some out. At 0.013, all of them fit with twenty more skills. The fraction is a ceiling, not a cost: a list that fits uses only its own length.
- `1m`: a fresh install fits even without a cap. The cap is for a machine with many skills: a 143-skill list of 47 617 characters fits whole in 19 427.

The keys are merged one by one. A key you set yourself is yours: the build never changes it, and uninstall never removes it. A key the build wrote moves with the setting (from `200k` to `1m` the cap goes to 120 and the fraction is removed), and uninstall removes it. A settings file with comments is never rewritten: the build prints the keys to merge by hand, and a key you merge that way is yours, so the build does not record it and uninstall leaves it. Project settings outrank your user settings, so a project install leaves any listing key that `~/.claude/settings.json` already sets (by a global install or by hand) to that file. A new project install with no `--context-window` and no `--reset` takes the value of the machine's global install; a profile, the console and the wizard pass their own value. A project built before the global install wrote its keys keeps its own until its next rebuild. The first build that writes the keys prints one line that names them and how to choose the other value. Claude Code reads these keys from about version 2.1.129; an older version keeps them and ignores them.

OpenClaude (checked on 0.31) and IBM Bob read neither key, and OpenCode does not cap its list, so on those hosts the option writes nothing. Every host records the choice: a `Context window: 1m` line in the install's instruction file, written only when it is not the default. Rebuilds, upgrades, `profile save` and the console read it back. The `setup` wizard keeps it without asking. Set it with the flag, a profile's `contextWindow` key, or the console's **Context window** picker on a Claude Code install.

### Related

[Agents](agents.md) — who does the work · [Rules](rules.md) — what every skill obeys · writing your own: [docs/extending.md](../extending.md)
