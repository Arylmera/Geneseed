---
group: concepts
order: 13
title: "Kits"
kind: "concept"
section: "Configuration"
description: "Opt-in bundles of skills, agents and rules for one stack, off unless you name them."
---
A **kit** is an opt-in bundle of skills, agents and rules for one stack. Kits are off by default and switched on per install, project or global, on every host. An install without a kit pays nothing for it. Inside an install that has it on, a kit's skills and agents are ordinary: the model picks them as it picks any other.

> **You already know this:** an optional dependency group, like `pip install pkg[postgres]`. The core install stays small, and you opt into the extra parts for your stack.

The first kit is `spring-boot`, for Spring Boot 4 (Spring Framework 7, Java 21+) projects. It adds nine members:

| Member | Kind | What it is for |
|---|---|---|
| `spring-boot` | skill | Building a Spring Boot service: web layer, configuration, security, HTTP clients, logging, cloud-native packaging, and a table of Boot 4 pitfalls |
| `spring-data-jpa` | skill | Spring Data JPA and Hibernate: entities, repositories, transactions, N+1 and fetch problems, migrations |
| `spring-testing` | skill | Spring Boot tests: slices, `MockMvcTester`, `@MockitoBean`, Testcontainers with `@ServiceConnection` |
| `spring-boot-engineer` | agent | Implements a Spring Boot feature end to end |
| `spring-reviewer` | agent | Framework-aware review: layering, transactions, JPA, configuration, test slices |
| `spring-security` | agent | Security pass on a Spring Security change |
| `kubernetes-specialist` | agent | Kubernetes manifests, probes, resources and rollout for a Spring Boot service |
| `docker-expert` | agent | Dockerfile, layered or native image for a Spring Boot service |
| `devops-engineer` | agent | Build and delivery pipeline, on whatever CI the project already uses |

The kit is adapted from [piomin/claude-ai-spring-boot](https://github.com/piomin/claude-ai-spring-boot) by Piotr Mińkowski (Apache-2.0), rewritten and condensed for Boot 4. Each of its skill folders ships `LICENSE-piomin-spring-boot.txt`, and each agent carries a credit line.

### Switching kits on and off

```bash
geneseed build --emit claude-global --kits spring-boot
geneseed build --emit claude-global --kits none
```

`--kits` takes a comma-separated list. `none` and an empty value both mean no kits. An unknown kit name is refused with exit code 2, and the error lists the kits this Geneseed ships. `none` is reserved and can never name a kit. The flag's row is in the [CLI reference](../reference/cli.md), under `build`.

A build does exactly what its flags say. A plain `build` without `--kits` therefore turns off a kit the install has on. Before it does, it warns: `this install has kit <k>; this build turns it off — pass --kits <k> to keep it`.

The setup wizard asks one question listing the kits, with the install's current kits as the default. It asks it only when at least one kit exists.

### What an install records

An install with a kit on records it in its instructions file, under the skill section: `Active kits: spring-boot`. The line is written only when at least one kit is on. A missing line means no kits, so an install built before kits existed reads as having none.

`geneseed rebuild-all`, `geneseed update` and `geneseed migrate` read the line back and rebuild with the same kits. `geneseed diff` and the web console read it too, so they compare against or rebuild that same set. `geneseed validate` does not read it: pass `--kits` to dry-run a kit build. A plain `build` does not read it; it only warns, as above. If the line names a kit this Geneseed no longer ships, the rebuild drops that kit with a notice and keeps the others. It never fails `rebuild-all`. A retired kit name is never reused for a new kit.

`geneseed status` shows `kits: spring-boot` on the install's row, and `status --json` carries the same list.

In the web console, **Installs → Kits** (`#/installs/kits`) lists every install (disabled ones read-only) with one switch per kit. Toggling stages the set; **Apply** asks for confirmation, then rebuilds that one install with exactly that set as a console job (replace, not replay). Files you edited in a kit that is now off are kept, and the row names them so you can delete them by hand. The top-level **Kits** page (`#/kits`) lists the kits; a kit's page (`#/kits/<kit>`) shows its rules, banned APIs and upstream credits with the same per-install switch, and the Library tags each member skill or agent with a `kit:` badge.

### What a kit adds to an install

- **Its skills and agents.** They are written like any core skill or agent. The members of a kit that is off are not written at all.
- **A Kits block in the instructions file**, after the doctrine layer. It holds each active kit's rules, the same text at either [footprint](footprint.md).
- **Its catalogue rows**, as the last rows of the skills table and of the agents table, only where the host does not list that kind natively. The plain bundle (`--emit files`) gets both, Bob gets the agent rows (it lists skills natively), and Claude Code, OpenClaude and OpenCode get none: their instructions file keeps its pointer.

`--exclude-skills` still applies: it can drop one kit skill while the rest of the kit stays on, and the exclusion wins. A kit's links to its own skills do not stop that, but a kit file's link to a core skill still protects that core skill from `--exclude-skills`, as any link from the harness does. Kit agents cannot be left out one by one. See [Exclusions](exclusions.md).

### Turning a kit off

Rebuild with `--kits none`, or with a list that leaves the kit out. The kit's files are removed from the install, its block and catalogue rows go, and the `Active kits:` line goes when no kit is left.

A kit file you edited is kept, as with any file Geneseed wrote and you changed. `geneseed status` names it on a row of its own, `kept from inactive kit <kit>: <files>`, and `status --json` lists it under `keptKitFiles`. Delete it by hand if you no longer want it.

### Kits are not doctrine packs

A [doctrine pack](rules.md) is part of the constitution. Kits are not:

- A kit's rules are plain text. They have no rule ids, cannot be excluded one at a time with `--exclude-rules`, and have no row in the hook ledger. No hook gate enforces them.
- A kit is not a pack. A missing `Active packs:` line reads as every pack, but a missing `Active kits:` line reads as no kits, so an old install never turns a kit on by accident.

### What a kit costs

- **Hooks:** nothing. The hook binary does not read kits, so a kit adds no time to a tool call.
- **The instructions file:** the Kits block. Each kit has its own word budget for its rules, set in its manifest and checked by `doctor`, so a kit never eats into the core ceiling.
- **The skill listing:** one line per kit skill, every session, while the kit is on. That is the same price as a core skill.

The cost of authoring one, file by file, is in [Extending](../extending.md#3bis--adding-a-kit).
