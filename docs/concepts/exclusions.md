---
group: concepts
order: 12
title: "Exclusions"
kind: "concept"
section: "Configuration"
description: "Three ways to switch things off: one rule, one skill, or every hook in a folder."
link: {"hash": "#/installs/hosts", "label": "Manage on Installs →"}
---
Geneseed has three ways to switch something off, and they work at different scales (plus an on/off switch for the hook gates of Laws I, III and IV, and for the ownership gate, below):

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

One command updates every global install on the machine. It writes the folder to the **shared list**, `excludes.json` in the machine-wide Geneseed folder (`~/.config/geneseed/`), and wires each global install. Every global hook and plugin reads the shared list on each call, beside the install's own `excludes.json`, so a change takes effect at once and the hosts cannot drift apart. The install's own file still holds the `wired` record of what the command set up on that host. A per-repo install never reads the shared list. An agent that edits either file is asked first, on every host: the list is a gate's own configuration.

What "dormant" means per host:

- **Claude Code** — every hook exits silently, and the global `CLAUDE.md` is suppressed natively through `claudeMdExcludes` in the repo's `.claude/settings.local.json`.
- **OpenClaude** — the same, in the repo's `.openclaude/settings.local.json`.
- **Bob** — every hook exits silently, and a stub `.bob/rules/geneseed.md` in the repo shadows the global rules file. A hand-written stub already there is never overwritten.
- **OpenCode** — the `geneseed-context`, `geneseed-guard`, `geneseed-learn` and `geneseed-activity` plugins stand down. Three plugins do not read the list: `geneseed-notify` still pings the desktop, `geneseed-ponytail` still injects its ruleset if you switched it on, and `geneseed-workflow` keeps its tool. The `permission` keys in a global `opencode.json` still apply, because OpenCode reads them before any plugin.

`geneseed exclude remove` undoes all of it.

**Git worktrees.** A linked worktree of an excluded repo (`git worktree add`) is excluded too, wherever it sits on disk: the hooks and plugins follow its `.git` file back to the main repository. The global `CLAUDE.md` is the exception on Claude Code and OpenClaude: `settings.local.json` is gitignored, so a worktree never gets it. Geneseed writes no tracked file in a repo you told it to leave alone, so `exclude add` and `exclude list` print the snippet to commit yourself in the repo's tracked `.claude/settings.json` (`.openclaude/` for OpenClaude): `"claudeMdExcludes": ["<path to the global CLAUDE.md>"]`.

**Limits.** Globally installed skills and agents stay *listed* by the host — no host offers a per-repo switch for them. That makes an exclusion a poor way to save tokens: the listings stay on Claude Code and OpenClaude, and on OpenCode the global instructions file still loads (see [Why there is no chat mode](../token-footprint.md#why-there-is-no-chat-mode)). And a global install created *after* you added exclusions is silent in those folders at once, through the shared list, and its next emit applies the repo-side wiring there. Until that emit, `geneseed exclude list` flags it.

The web console has the same controls in the **Excluded folders** card on the Installs page, shown once a global install exists.

### Per-rule exclusion — one rule off

The finer switch removes a single doctrine rule from an install while keeping the rest of its pack:

```bash
geneseed build --emit claude-global --exclude-rules "process 7"
```

The install records it (`Excluded rules: process 7` beside its pack list) and every rebuild and upgrade keeps it. If a later version retires the rule, the rebuild prints a WARN, drops that address, and goes on. The WARN says what the exclusion no longer does: comms 5 (*Mark the Ask*) merged into comms 1 on 2026-11-08, so excluding `comms 5` no longer removes the ask markers, which now bind inside comms 1. If a new rule later takes a retired rule's address, an old exclusion of that address removes the new rule; the build then prints a loud WARN that names both rules, and the exclusion still applies until you remove it. The always-on Rules and the Ethos cannot be excluded.

**A hook goes with its rule.** Three doctrine rules are also enforced by a hook with no switch of its own, and excluding the rule, or building without its pack, drops that hook in the same rebuild. Including the rule again re-arms it at the next rebuild.

| Rule | What stops | Flag |
| --- | --- | --- |
| process 5, *Consent Before Push* | the commit/push ask of `git-gate` and OpenCode's `git commit*`/`git push*` keys. Bob keeps its warning line | `--no-consent` |
| process 1, *Persist Insight* | the ask (on Bob the block or warning) on a write to `user-rules.md` or `user-rules.draft.md`, by write tool or parsed shell write, the hard-link check included: `rule-gate`, `git-gate`, Bob's `tool-gate`, the OpenCode guard, and OpenCode's `permission.edit` keys on those files | `--no-rule-store` |
| ops 2, *Commands Must Return* | the root-scan check of `git-gate`, Bob's `tool-gate` and the OpenCode guard | `--no-root-scan` |

Every other check of those hooks stays. The [change report](hooks.md#the-change-report) keeps reporting rule-file changes: with process 1 off, a rule write ran with no prompt, so it is never counted as approved. **With process 1 off, that report is the only signal that the agent changed your standing rules.** It detects and prevents nothing, and it can be fooled: the agent can write `memory/.own-writes.json`, the log of Geneseed's own writes, so a change it lists is excused. The OpenCode guard reads the same state from the install's `Active packs:` and `Excluded rules:` lines when it starts, so restart OpenCode after a rebuild. While the machine's hook shim points at an older checkout, that checkout refuses a flag it does not know and the gate verb lets every call through; run `geneseed rebuild-all` first. Rigor 5 is the exception: it has a switch of its own (below). Picking packs and rules is covered in [Doctrine packs and single rules](../guides/setup-doctrines.md); what the layers are is in [Rules](rules.md).

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

What stops asking, per host: the real-loss check of `git-gate` (Claude Code, OpenClaude) and `tool-gate` (Bob, which then no longer exits 2 for it), the OpenCode guard plugin's real-loss block, and the Law IV keys of OpenCode's `permission.bash` (`git reflog expire*`, `git gc --prune*`, the `main`/`master` force-push and delete forms). What stays: the Rule's text in the carrier, *Sealed Secrets*, the root-wide scan check (*Commands Must Return*), *Consent Before Push* (a forced push still asks as a push while that rule is on), *External Gate*, and the catastrophic-command check on every host (`rm -rf` of `/`, a drive root or the home directory, `format`, `dd` over a disk): a prompt on Claude Code and OpenClaude, a block on Bob and OpenCode.

Limits:
- **OpenCode reads the switch at start.** The guard plugin reads `Deletion gate:` from the install's `AGENT.md` once, when OpenCode loads it: restart OpenCode after flipping it.
- **A global install beside a project install.** On Claude Code and OpenClaude the global `git-gate` stands down for a project install, so the project's switch decides. Bob's `tool-gate` and the OpenCode guard do not stand down: an armed global install still refuses real loss inside a project whose own install is off.
- **An older `opencode.json` keeps its Law IV keys.** Switching off removes the `permission.bash` entries the manifest records Geneseed adding (`bash_gates`, since 5.2.0). An install made before that has no record, so the build warns that it keeps them and they keep asking. Run the build once with `--prune-gates` to remove those still set as Geneseed writes them, or delete them by hand. An entry you changed always stays, and a commented `opencode.jsonc` is never rewritten: the build names the entries to remove.
- **An older hook shim silences the whole gate.** The flag is new. While the machine's shared hook shim still points at an older checkout, that checkout refuses the flag and the gate verb lets every call through on a disarmed install — on Claude Code and OpenClaude the root-scan and consent checks too, on Bob also *Sealed Secrets* and *External Gate*. Update the checkout the shim points at (`geneseed rebuild-all`) before switching the gate off.

### Law I secrets gate and Law III done gate — on or off

The same switch, for two more gates. Both are armed by default, and the Rule's text in the carrier still binds the agent with either off.

```bash
geneseed build --emit claude-global --no-secrets-gate   # Sealed Secrets
geneseed build --emit claude-global --no-done-gate      # Verify Before Asserting
```

The console's Constitution page has a switch on Rule I's and Rule III's rows too (*Enforced by* reads **Gate off** while one is off); Rule VIII has one for the [test note](#external-gate-and-the-test-note--on-or-off), and the other Rules show *no gate*, because only their text enforces them. The install records `Secrets gate: off` / `Done gate: off` beside `Deletion gate:`, written only when off; rebuilds, upgrades and `geneseed status` carry them like Law IV's.

What stops, per host:
- **`--no-secrets-gate`**: the credential scan of `rule-gate` (Claude Code, OpenClaude) and of `tool-gate` (Bob, which then no longer exits 2 for it), and on OpenCode the guard plugin's *Sealed Secrets* block — both the key/credential file path block and the content scan. *External Gate*, *Persist Insight*, the deletion gate and the root-scan check stay.
- **`--no-done-gate`**: the done check `learn` runs on Stop, listed or inferred (Claude Code, OpenClaude; on Bob, the "turn not judged" log line), and on OpenCode the context plugin's reminder (OpenCode 1), its one-line notice (OpenCode 2), and on every host the `Done gate:` line at session start. Learning itself still runs, and `.geneseed/done-checks.txt` stays protected by *External Gate*.

Limits: OpenCode reads both switches from the install's `AGENT.md` when it starts, so restart it after flipping one. A global install beside a project install: `rule-gate` and Bob's `tool-gate` do not stand down for a project install on any host, and neither does the OpenCode guard, so an armed global install still asks about (or blocks) a credential write inside a project whose own install has the secrets gate off. `learn` does stand down on Claude Code and OpenClaude, so there the project's done gate switch decides. And the older-shim limit above is sharper for the done gate: its flag rides on `learn`, so while the shim points at an older checkout an install with the done gate off **loses learning too**, not only the gate. Run `geneseed rebuild-all` before switching either gate off.

### External Gate and the test note — on or off

Two more switches. Both are armed by default and written only when off, so an armed install does not change.

```bash
geneseed build --emit claude-global --no-external-gate   # protected checks, gate configuration
geneseed build --emit claude-global --no-test-note       # the weakened-test note
```

The install records `External gate: off` / `Test note: off` beside the other gate markers. Rebuilds, upgrades and `geneseed status` carry them. Any other value reads as armed. `doctor --probe` is unaffected: it sends a shell command that neither switch judges.

**Run `geneseed rebuild-all` before you switch either one off.** The flags are new. While the machine's shared hook shim points at an older checkout, that checkout refuses the flag, and the gate verb then lets every call through: every gate on that verb is silent, not only this one.

What stops, per host:
- **`--no-external-gate`**: the protected-check and gate-configuration asks of `rule-gate` and of the shell path in `git-gate` (Claude Code, OpenClaude), the same blocks in `tool-gate` (Bob, which then no longer exits 2 for them), the OpenCode guard's refusals on its write and shell paths, and the `evaluate` ask over a gate's own file on OpenCode 2. Every other gate keeps running: secrets, real loss, root scans, the rule-store check, the wiki check and commit/push consent. The guard also keeps refusing an NTFS stream path, because that check protects every path gate.
- **`--no-test-note`**: the "this edit weakens a test" note at edit time (`rule-gate`, Bob's `tool-gate`), the `[done-gate] advisory` line at turn end (`learn`), and the OpenCode context plugin's reminder on both OpenCode versions. The done checks do not change. `--no-done-gate` still silences the turn-end line and the OpenCode reminder by itself, and it leaves the edit-time note on the hook hosts.

**What stays on OpenCode.** The `permission.edit` "ask" keys in `opencode.json` are host configuration, so `--no-external-gate` does not remove them. OpenCode keeps asking before an edit tool writes those files, and you remove the keys by hand if you want that gone. The guard no longer refuses them after an "always" answer, and no longer refuses a shell write to them.

**What this switch costs.** External Gate is what stops an agent from editing the gates' own wiring. With it off, the agent can write hook settings, the `AGENT.md` gate markers and `.geneseed/done-checks.txt` without an ask, so every other gate holds only while the agent leaves that wiring alone. Switch it off only where you accept that.

**The doctrine and the switch are two axes.** `--exclude-rules rigor.5` takes the rule's text out of the carrier. `--no-external-gate` stops the hook. Neither moves the other:

| Rule text (`--exclude-rules`) | Hook (`--no-external-gate`) | Result |
| --- | --- | --- |
| In | Armed | The agent is told, and the write asks |
| Excluded | Armed | The agent is not told, and the write still asks |
| In | Off | The agent is told, and nothing asks |
| Excluded | Off | Neither |

The console's Constitution page shows both on the same doctrine row: the row's own switch is the rule, and the *External gate* line inside the opened row is the hook. The test note's switch sits on Rule VIII's row, which reads *Hook gate* or **Gate off**. Each gate switch rebuilds at once; the rule switch stages with the other doctrine changes.

**Where a marker counts.** In a `CLAUDE.md` or `AGENTS.md`, which are your files, every gate marker counts only inside the `<!-- BEGIN GENESEED -->` block. A marker line outside it reads as armed, and a rebuild does not carry it. A generated `AGENT.md` or `rules/geneseed.md` counts whole, and External Gate protects both. Under External Gate, a write tool aimed at a `CLAUDE.md` or `AGENTS.md` is replayed, and the first block is compared before and after. Any difference asks (on Bob it blocks, and the OpenCode guard refuses). So does a call that cannot be replayed, an unreadable file, or a file over 1 MB. An edit wholly outside the block stays silent, so your own notes there are not interrupted. The name is normalized first, so `CLAUDE.md::$DATA` and `CLAUDE.md.` count as `CLAUDE.md`. A shell edit inside the block does not ask, and neither does a shell edit that puts a fake block before the real one, because only the first block is read. That is a limit: the hook has no replay for a shell write.

Limits, as for the gates above: OpenCode reads both markers from `AGENT.md` when it starts, so restart it after a rebuild. `rule-gate` and Bob's `tool-gate` do not stand down for a project install on any host, so an armed global install still asks inside a project built with the switch off. Only `git-gate` stands down, on Claude Code and OpenClaude.

### Ownership gate — on or off

The [ownership](ownership.md) first-write gate is not a Rule's gate: it stops the first file write of a session, once, in an application repo whose root `AGENTS.md` has no `## Ownership` section, so the agent proposes the setup first. It is armed by default. Switch it off for one install:

```bash
geneseed build --emit claude-global --no-ownership-gate
```

The install records `Ownership gate: off` beside the other gate markers, written only when off; rebuilds, upgrades and `geneseed status` carry it. The console's Constitution page has a switch for it inside the *Ownership* row of the Credo band: open the row, and a gate line follows the section's text. The gate belongs to no Rule, and that line exists only in the console. The section's text always binds, so the row's status stays *Always*. *Enforced by* reads **Gate off** while the gate is off, and the Credo's pill on the Precedence ladder counts it. What stops: the ownership check of `rule-gate` (Claude Code, OpenClaude) and of `tool-gate` (Bob), on OpenCode the guard plugin's ownership refusal, the setup proposal in the install's `AGENT.md` (the build drops that passage, and the `/document-project` suggestion in it goes too), and the session-start decline reminder. A repo with `mode: on` still runs the ownership checkpoints, and every other check of those gates stays.

Two narrower ways out need no rebuild: `## Ownership` with `mode: off` in a repo's root `AGENTS.md` silences it for that repo and its team; answering "skip in this repo until I ask" writes `Setup: declined <YYYY-MM-DD>` into your personal `.geneseed/ownership.md`, which silences it for you alone in that repo until you delete the line or ask for the setup; and answering "skip this session" lets the session write on.

Limits, as for the gates above: OpenCode reads the marker from `AGENT.md` when it starts, so restart it after a rebuild. A global install's `rule-gate` does not stand down for a project install, so an armed global gate still stops the first write inside a project built `--no-ownership-gate`. And while the machine's hook shim points at an older checkout, that checkout refuses the flag and the gate verb lets every call through on a disarmed install — on Claude Code and OpenClaude all of `rule-gate` (the credential scan, *Persist Insight* and *External Gate* too), on Bob all of `tool-gate` (credentials, destructive git, the root scan and the protected checks too). Run `geneseed rebuild-all` first.
