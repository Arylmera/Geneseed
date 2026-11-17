---
group: concepts
order: 13.5
title: "The superpowers kit"
kind: "concept"
section: "Configuration"
description: "Five Rites are Geneseed's vendored copies of obra/superpowers: keep this kit or the official plugin, never both."
---
Five of Geneseed's skills are **vendored, modified copies of the skills in [obra/superpowers](https://github.com/obra/superpowers)** by Jesse Vincent (MIT). They live in the `superpowers` [kit](kits.md). An install has either the kit or the official superpowers plugin as its workflow provider, never both.

| Kit skill | Plugin skill it stands for |
|---|---|
| `brainstorm` | `brainstorming` |
| `debug` | `systematic-debugging` |
| `plan` | `writing-plans` |
| `geneseed-code-review` | `requesting-code-review` |
| `review-response` | `receiving-code-review` |

`parallel-agents`, `pipeline` and the `reviewer` agent are core in every install. Foreman's Brief checklist, the worktree rule and the blind reviewer live in them, and they credit superpowers in both states.

## Kit on

The five skills ship as they always did, with their credit lines and `LICENSE-superpowers.txt`. The Kits block of the instructions file says what they are and asks the agent to tell you once if the official plugin is also loaded.

## Kit off

The five skills are not written. Every core link to one is rewritten in the one render pass: the link text stays and the target becomes the plugin's skill in the host's spelling.

| Host | A link to `debug` reads |
|---|---|
| Claude Code | `debug Skill (superpowers:systematic-debugging)` |
| OpenCode V1 and V2 | `debug Skill (systematic-debugging)` (the plugin registers bare names; it needs OpenCode V2 2.0.4 or later) |
| Bob, OpenClaude, the plain bundle | `debug Skill`, with no skill name: there is no plugin to point at |

On Claude Code and OpenCode the instructions file also gains a **Workflow provider** block:

1. **Rank.** The plugin's skills are procedure, never rank. "Invoke it at a 1% chance" never outranks a Dictate, a user rule or a Doctrina.
2. **Routing.** The plugin's parallel and subagent skills are allowed, but the parent still writes every worker's brief by the parallel-agents Brief checklist. `finishing-a-development-branch` yields to `ship` (main changes only through a pull request with green checks), `test-driven-development` to `develop`, `using-git-worktrees` to `worktree` and `writing-skills` to `skill-forge`.
3. **Missing provider.** If no superpowers skill is in the inventory, the agent tells you once to turn on the kit or install the plugin.

Bob and OpenClaude get the missing-provider line only. Building with the kit off is never refused: it is a legal state on every host, and `doctor` warns when it leaves no provider.

The `ci-fix` loop brick carries its CI-specific steps in its own body, so it works either way: it points at the `debug` skill, or at the plugin's `systematic-debugging` when the kit is off.

## Who gets the kit

| Where | Default |
|---|---|
| Profiles `starter`, `corporate` | kit on (`"kits": ["superpowers"]`) |
| Profiles `mentor`, `minimal`, `autonomous` | by detection (`"kitsByDetection": ["superpowers"]`): on when the plugin is not seen |
| The setup wizard | by detection, and the question says what it saw; Bob and OpenClaude default to yes |
| `geneseed build` with no `--kits` | no kit, as for every kit |

### How detection works

It only reads files, because the CLI may not start a process, and it names the file it read: `seen in <file>` or `not seen in <files read>`. It never says "not enabled".

| Host | Files read | Seen when |
|---|---|---|
| Claude Code | `~/.claude/settings.json` and `settings.local.json`; the project's `.claude/settings.json` and `settings.local.json` | `enabledPlugins` has a `superpowers@…` key set to `true` |
| Claude Code, desktop app | `<app data>/Claude/rpm/*/*/manifest.json` | an entry has `upstreamRepoUrl` `https://github.com/obra/superpowers` |
| OpenCode | global and project `opencode.json` or `.jsonc` | `plugin` (V1) or `plugins` (V2) has a `superpowers@…` entry |

The desktop file is the app's own undocumented state, read best-effort and labelled as such. On one machine the settings file said `false` while the plugin was loaded, which is why that file is read at all.

`geneseed doctor` and `geneseed status` warn in two cases: the kit on while the plugin is seen (duplicate Rites, about 800 tokens injected per session), and the kit off while no plugin is seen (no provider).

## Installs made before the kit

An install built by a release before the kit has no `Active kits: superpowers` line, and its next rebuild would drop the five Rites. `rebuild-all`, `update` and `migrate` therefore read the release recorded in the install's `.geneseed-version` and, for an older one, turn the kit on unless the plugin is seen. Each install gets one line saying which and why. An install built after the kit keeps what its line says, so turning the kit off on purpose sticks.

## Excluding one of the five

`--exclude-skills` refuses a name that core files link to, and since the scan counts relative links, `debug`, `plan`, `brainstorm`, `geneseed-code-review` and `review-response` cannot be excluded one by one: use the kit switch.
