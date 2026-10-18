---
group: concepts
order: 12
title: "Exclusions"
kind: "concept"
section: "Configuration"
description: "Three ways to switch things off: one rule, one skill, or every hook in a folder."
link: {"hash": "#/harness", "label": "Manage in Harness →"}
---
Geneseed has three ways to switch something off, and they work at different scales (plus one on/off switch for Law IV's gate, below):

| | Sovereign repo | Per-rule exclusion | Per-skill exclusion |
| --- | --- | --- | --- |
| **Switches off** | the whole global install, inside one folder | one doctrine rule, everywhere the install applies | one skill, everywhere the install applies |
| **Scope** | a folder and everything under it | the install | the install |
| **Applies to** | **global** installs only | any install | any install |
| **Set with** | `geneseed exclude add <path>` | `--exclude-rules` at build time | `--exclude-skills` at build time |
| **Takes effect** | on the next tool call, no rebuild | on rebuild | on rebuild |

> **You already know this:** `.gitignore` versus disabling one lint rule. One makes a tool ignore a whole folder; the other keeps the tool running everywhere with one check turned off.

### Sovereign repos — whole-repo dormancy

A **sovereign repo** is a folder where every *global* Geneseed install goes fully dormant. The usual case is a repo that ships its own complete agent setup — its own rules, hooks and memory — where a global harness layered on top would bring conflicting instructions and wasted tokens.

It is all-or-nothing. It does not trim which rules apply or which skills load; the global harness simply never engages inside that folder. A **per-repo** Geneseed install in the same folder is unaffected — exclusions only ever silence global installs.

```bash
geneseed exclude add ~/code/my-vault
geneseed exclude list
geneseed exclude remove ~/code/my-vault
```

One command updates every global install on the machine. Each keeps the list in its own `excludes.json`, and every hook and plugin reads it on each call, so a change takes effect at once.

What "dormant" means per host:

- **Claude Code** — every hook exits silently, and the global `CLAUDE.md` is suppressed natively through `claudeMdExcludes` in the repo's `.claude/settings.local.json`.
- **OpenClaude** — the same, in the repo's `.openclaude/settings.local.json`.
- **Bob** — every hook exits silently, and a stub `.bob/rules/geneseed.md` in the repo shadows the global rules file. A hand-written stub already there is never overwritten.
- **OpenCode** — Geneseed's plugins stand down.

`geneseed exclude remove` undoes all of it.

**Git worktrees.** A linked worktree of an excluded repo (`git worktree add`) is excluded too, wherever it sits on disk: the hooks and plugins follow its `.git` file back to the main repository. The global `CLAUDE.md` is the exception on Claude Code and OpenClaude: `settings.local.json` is gitignored, so a worktree never gets it. Geneseed writes no tracked file in a repo you told it to leave alone, so `exclude add` and `exclude list` print the snippet to commit yourself in the repo's tracked `.claude/settings.json` (`.openclaude/` for OpenClaude): `"claudeMdExcludes": ["<path to the global CLAUDE.md>"]`.

**Limits.** Globally installed skills and agents stay *listed* by the host — no host offers a per-repo switch for them. And a global install created *after* you added exclusions starts with an empty list: run `geneseed exclude add` again (`geneseed exclude list` flags installs whose lists differ).

The web console has the same controls in the **Excluded folders** card on the Harness page, shown once a global install exists.

### Per-rule exclusion — one rule off

The finer switch removes a single doctrine rule from an install while keeping the rest of its pack:

```bash
geneseed build --emit claude-global --exclude-rules "process 7"
```

The install records it (`Excluded rules: process 7` beside its pack list) and every rebuild and upgrade keeps it. The always-on Rules and the Ethos cannot be excluded. Picking packs and rules is covered in [Doctrine packs and single rules](../guides/setup-doctrines.md); what the layers are is in [Rules](rules.md).

### Per-skill exclusion — skills you never use

Every installed skill costs a line in the host's skill listing, every session. Skills you never use can be left out of an install:

```bash
geneseed build --emit claude-global --exclude-skills "bruno,react-view-transitions"
```

The skill's files are not written, its catalogue row goes, and an OpenCode `/command` that runs it goes too. The install records the list (`Excluded skills: …` under its skill section), and every rebuild and upgrade keeps it. `--exclude-skills none` puts them all back.

A few skills cannot be excluded, because the harness itself links to them by path — `council`, `rule`, `skill-forge`, `workflow` and a handful more. The flag names them when it refuses one. Skills you installed yourself are not Geneseed's to exclude: remove those from the host's skills folder directly.

### Law IV deletion gate — on or off

*Deletion Is Deliberate* is a Rule and cannot be excluded, but its **tool-boundary gate** can be switched off for one install. It is armed by default.

```bash
geneseed build --emit claude-global --no-deletion-gate
```

The web console has the same switch on Rule IV's row of the Constitution page; the row's *Enforced by* reads **Gate off** while it is off. The install records it (`Deletion gate: off` under its pack list, written only when off) and every rebuild and upgrade keeps it; rebuild without the flag, or flip the switch back, to re-arm it. `geneseed status` shows `deletion gate: off` on the install's row.

What stops asking, per host: the real-loss check of `git-gate` (Claude Code, OpenClaude) and `tool-gate` (Bob, which then no longer exits 2 for it), the OpenCode guard plugin's real-loss block, and the Law IV keys of OpenCode's `permission.bash` (`git reflog expire*`, `git gc --prune*`, the `main`/`master` force-push and delete forms). What stays: the Rule's text in the carrier, *Sealed Secrets*, the root-wide scan check (*Commands Must Return*), *Consent Before Push* (a forced push still asks as a push while that rule is on), *External Gate*, and the OpenCode guard's catastrophic-command block (`rm -rf /`, `format`, `dd` over a disk).

Limits:
- **Claude Code, OpenClaude and Bob have no separate catastrophic-command check.** There, a removal outside a repository — `rm -rf /` included — is caught only by the real-loss check, so with the gate off it no longer asks.
- **OpenCode reads the switch at start.** The guard plugin reads `Deletion gate:` from the install's `AGENT.md` once, when OpenCode loads it: restart OpenCode after flipping it.
- **A global install beside a project install.** On Claude Code and OpenClaude the global `git-gate` stands down for a project install, so the project's switch decides. Bob's `tool-gate` and the OpenCode guard do not stand down: an armed global install still refuses real loss inside a project whose own install is off.
- **An existing `opencode.json` keeps its Law IV keys.** Switching off does not remove `permission.bash` entries already written — Geneseed cannot tell its own from yours — so the build warns that it keeps them and they keep asking. Delete them by hand.
- **An older hook shim silences the whole gate.** The flag is new. While the machine's shared hook shim still points at an older checkout, that checkout refuses the flag and the gate verb lets every call through on a disarmed install — on Claude Code and OpenClaude the root-scan and consent checks too, on Bob also *Sealed Secrets* and *External Gate*. Update the checkout the shim points at (`geneseed rebuild-all`) before switching the gate off.
