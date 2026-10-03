---
group: guides
order: 2
title: "Choose your setup"
kind: "concept"
---
The setup wizard asks a handful of questions before it builds. Every one has a safe default, so you can accept them all and move on. This page says what each one changes, so you can pick on purpose, and how to change it later.

All of these choices are made **at build time**. The build writes them into the files your agent loads. Nothing switches at runtime. Rebuilds, re-themes and upgrades keep each install's choices, because they are recorded in small marker files beside the install.

> **You already know this:** these are compiler flags. You set them once, the output is built from them, and changing one means rebuilding rather than editing the output by hand.

## Theme: the voice

A theme changes how the harness *sounds*: the banner, the readiness sigil the agent opens with, and the vocabulary of its prose. It never changes which rules apply or which files ship. The wizard previews each theme live as you move through the list.

`neutral` is plain English. The others are `imperial`, `military`, `pirate`, `wizard`, `cyberpunk`, `gamer`, `sports`, `biker`, `commentator`, `joker`, `marvin`, `mean` and `verstappen`.

```
geneseed build --emit opencode-global --theme imperial
```

More in [Themes](../concepts/themes.md).

## Posture: how the agent works with you

Posture is the relationship register, fixed at build time so it does not drift mid-session:

- **peer** *(default)*: a candid equal. Dense, challenges you, no flattery.
- **mentor**: explains the why and checks your understanding.
- **expert**: maximum density, no basics.
- **assistant**: precise execution, low initiative. You steer.
- **artisan**: a peer with toolsmith reflexes, terminal-first.

```
geneseed build --emit opencode-global --posture mentor
```

Pick **peer** unless you know you want another register. A theme changes the prose, while a posture changes the relationship. See [Collaboration](../concepts/collaboration.md).

## Mode: who does the work

- **direct** *(default)*: the agent works every task itself, turn by turn.
- **foreman**: the session sorts each incoming task. A trivial task gets a direct answer. A substantial task goes to a small crew of agents (a **pipeline**) running in its own git worktree, while the session keeps answering you.

A pipeline never commits or merges. It hands back its worktree uncommitted, together with its test and lint output. The session then re-runs those commands itself, shows you the diff and the passing output, and commits and merges only after you accept. Foreman mode costs more per substantial task, because several agents run instead of one. In exchange, the session stays responsive.

```
geneseed build --emit opencode-global --mode foreman
geneseed build --emit opencode-global --mode direct    # back to the default
```

More in [Foreman mode](../concepts/foreman-mode.md).

## Loop trust: how far a loop goes before it asks

The `loop` skill scores every change it validates and stops to ask once the score passes a threshold. `--trust` sets the preset the skill starts a loop with; the user can still name another one per loop.

- **prudent**: asks early, on anything past a rename.
- **balanced** *(default)*: logic changes and new files pass with a note; API changes and deletions stop.
- **aggressive**: only an architecture-level change stops the loop.

The preset lives in the `loop` skill only, so it costs nothing in the always-on instructions.

```
geneseed build --emit opencode-global --trust prudent
```

## Doctrine packs: which practices bind

The harness's rules come in tiers (see [Rules](../concepts/rules.md)). The Ethos and the Rules are always on. The **doctrines** are practices rather than principles, and they ship as packs you choose:

| Pack | What it governs |
| --- | --- |
| **craft** | how code is written: reuse first, house conventions, docs updated in the same change, the smallest diff |
| **rigor** | how work is proven: idempotence, honest tests, cover-and-verify, gates that can actually fail |
| **ops** | how the machine is driven: tool discovery, commands that return, complete teardowns |
| **process** | how a session runs: planning, context economy, docs first, bounded loops, and consent before every commit and push |
| **comms** | how answers are presented: stable reference codes on tracked items, and a diagram or table only where it earns its place |

Every pack is enabled by default. To keep only some packs, or none:

```
geneseed build --emit opencode-global --doctrines craft,rigor   # two packs
geneseed build --emit opencode-global --doctrines none          # Ethos and Rules only
```

The packs always load in the same order (craft, rigor, ops, process, comms), whatever order you type them in. A pack you leave out still ships on disk under `doctrines/`, so you can read it before you turn it on. A clone can set its own default in `harness.config.json` with a `doctrines` array.

**Dropping `process` changes what the machine does, not only what the agent reads.** The *Consent Before Push* rule in that pack is enforced at the tool boundary as well as in the prose:

- On Claude Code and OpenClaude, the git hook stays wired but stops asking before a commit or push.
- On OpenCode, a fresh install no longer gets the `git commit*` and `git push*` ask entries in `opencode.json`. On an existing install, entries that are already there are left in place and reported, because Geneseed cannot tell its own entries from ones you typed.

The refusals of destructive git and `rm -rf` belong to the always-on Rules, not to the pack, so they stay in every build. See [Enforced vs. asked](../understand/enforced-vs-asked.md).

## One rule at a time

A pack is all-or-nothing. `--exclude-rules` drops single doctrine rules instead. It takes rule addresses, written `<pack> <n>` or `<pack>.<n>`:

```
geneseed build --emit opencode-global --exclude-rules "process 7"
geneseed build --emit opencode-global --exclude-rules "process 5,craft 2"
geneseed build --emit opencode-global --exclude-rules none
```

The number in an address is the rule's position in its pack, so it can change if a rule is added or removed. To see the current addresses, pass an address that does not exist: the build refuses it and lists every valid address. The web console's **Constitution** page has one switch per rule. You stage the changes there and apply them in a single rebuild.

Excluding *Consent Before Push* (`process 5` today) takes the commit and push consent gate with it, exactly as dropping the whole `process` pack does. The console and the wizard both warn you before applying it. A pack whose every rule is excluded drops out of the build entirely. See [Exclusions](../concepts/exclusions.md) for excluding whole folders instead.

## Footprint: how much loads every turn

Footprint controls how much of the rules text sits inside `AGENT.md`, which is loaded on every turn. It changes the token cost, not which rules apply:

- **lean** *(default)*: each rule appears in a hand-written short form, with a pointer to the full text. The full text ships beside `AGENT.md`, and the agent reads it when a rule's nuance matters.
- **full**: every rule's complete text and rationale is inline. This costs the most tokens. It can help a smaller model, which applies a rule's nuance more reliably when the reasoning is always in front of it.

```
geneseed build --emit opencode-global --footprint full
```

Both footprints install the same agents, skills, hooks and plugins. More in [Footprint](../concepts/footprint.md).

## Changing a choice later

You have three ways to change a choice:

- **Re-run the wizard** with `geneseed setup`. It pre-selects what the install already has, so holding Enter cannot widen a set you narrowed on purpose. The wizard does not ask about single rules, but it keeps any rule exclusions already in place.
- **Use the web console** (`geneseed web`). **Settings** and the **Harnesses** page change theme, footprint and the rest per install. **Constitution** toggles packs and rules.
- **Run the build yourself.** Watch out: a flag you leave out takes the *generator's* default, not your install's current value. `geneseed status --json` prints, for every install, the exact `geneseed build` command that rebuilds it as it is. Start from that command and change the one flag you want.

---

**Next:** [Verify it works](verify.md)
