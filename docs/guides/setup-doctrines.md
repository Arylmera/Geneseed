---
group: guides
order: 11
title: "Doctrine packs and single rules"
kind: "concept"
section: "Set up"
description: "Which practice packs bind, and how to drop a single rule."
---
Part of [Choose your setup](choose-your-setup.md). Like every setup choice, packs and rules are fixed **at build time**: change one by rebuilding, not by editing the output.

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

---

**Next:** [Footprint, loop trust and changing later](setup-footprint.md)
