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

The second kit is `react`, for React 18 or 19 apps built with Vite or webpack, in TypeScript or JavaScript, tested with Jest and React Testing Library. It adds four members:

| Member | Kind | What it is for |
|---|---|---|
| `react` | skill | Components, hooks, state placement, data fetching, TypeScript or JavaScript, React security; side files for Vite and for webpack (config, client-side routing, env variables, build failures), read by whichever the project uses, and accessibility |
| `react-testing` | skill | Jest and Testing Library: role queries, `userEvent`, MSW network mocks, `jest-axe`, and the Jest configuration a Vite or webpack project needs |
| `react-engineer` | agent | Implements a React feature, or makes a broken Vite or webpack build or Jest run green |
| `react-reviewer` | agent | Framework-aware review: hooks, state, data fetching, accessibility, React security, tests |

It is adapted from [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) by Affaan Mustafa (MIT), rewritten and condensed for Vite and Jest; the webpack side file is first-party. It has no Server Components material: a client-rendered app has no server render.

The third kit is `ci-pipelines`, for CI pipelines on Jenkins and GitLab CI. It adds two skills and no agent:

| Member | Kind | What it is for |
|---|---|---|
| `jenkins-pipeline` | skill | Declarative `Jenkinsfile`, shared-library layout (`vars/`, `src/`, `resources/`), CPS and `@NonCPS`, sandbox and script approval, credentials binding, `parallel` and `when`, tests with JenkinsPipelineUnit |
| `gitlab-ci` | skill | `.gitlab-ci.yml`: `rules:`, the `needs:` DAG, `include:` and `extends:`, caching and artifacts, protected and masked variables, environments, CI lint |

Its rules keep the pipeline in one source of truth, take secrets only from the CI's own store, pin images and tool versions, and run fast feedback first. Its `banned` list refuses GitLab's older job-condition keywords, which GitLab no longer actively develops, in its files. It is first-party.

The fourth kit is `docker`, for Docker and Compose operations on any stack. It adds one skill:

| Member | Kind | What it is for |
|---|---|---|
| `compose-ops` | skill | Health-ordered startup (`depends_on` with `condition: service_healthy`), named volumes against bind mounts, pinned tags or digests, `.env` and secrets, restart policies, resource limits, logging, networks, minimal non-root multi-stage images, and safe updates: pull, recreate, roll back |

It does not overlap the spring-boot kit's `docker-expert` agent: that agent builds a Spring Boot service's own image (Buildpacks, layered or native) and its local-dev Compose file, and `compose-ops` operates any Compose stack. Either kit works without the other. `compose-ops` is adapted in part from the `docker-patterns` skill of [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) by Affaan Mustafa (MIT), rewritten for operations; its skill folder ships `LICENSE-everything-claude-code.txt`.

The fifth kit is `terminal-tools`, for terminal programs the agent drives through their own CLI. It adds two skills:

| Member | Kind | What it is for |
|---|---|---|
| `herdr` | skill | Herdr workspaces, tabs, panes and agents, from inside a Herdr pane (`HERDR_ENV=1`) and only when the user names Herdr: split a sibling pane, start and prompt another agent, wait on state, read output. It carries the Windows notes of herdr's own docs page (signed binaries unsupported, so SmartScreen may warn) |
| `opencode-cli` | skill | OpenCode V2 from another session: headless `opencode run` (JSON output, model, agent, continue and fork), the background service against `--standalone` and `--server`, `serve` and `pair`, sessions, MCP, plugins, models, stats, debug |

Its rules gate each tool on its environment, read live state before acting, close only what the agent opened, never stop the user's server or service, and leave every login and credential to the user. `herdr` is adapted from the official skill of [herdrdev/herdr](https://github.com/herdrdev/herdr) by herdrdev (Apache-2.0), condensed into house format; its skill folder ships `LICENSE-herdr.txt`. `opencode-cli` is first-party and targets OpenCode V2 only, verified against the V2 source at v2.3.0: the V1 commands top-level `export` and `import`, `attach`, `agent create` and `mcp debug` are not in its command table.

### Switching kits on and off

```bash
geneseed build --emit claude-global --kits spring-boot
geneseed build --emit claude-global --kits react,spring-boot
geneseed build --emit claude-global --kits ci-pipelines,docker
geneseed build --emit claude-global --kits terminal-tools
geneseed build --emit claude-global --kits none
```

`--kits` takes a comma-separated list. `none` and an empty value both mean no kits. An unknown kit name is refused with exit code 2, and the error lists the kits this Geneseed ships. `none` is reserved and can never name a kit. The flag's row is in the [CLI reference](../reference/cli.md), under `build`.

A build does exactly what its flags say. A plain `build` without `--kits` therefore turns off a kit the install has on. Before it does, it warns: `this install has kit <k>; this build turns it off — pass --kits <k> to keep it`.

The setup wizard asks one yes/no question per kit, each defaulting to whether the install has that kit on. It asks them only when at least one kit exists.

### What an install records

An install with a kit on records it in its instructions file, under the skill section: `Active kits: spring-boot`. The line is written only when at least one kit is on. A missing line means no kits, so an install built before kits existed reads as having none.

`geneseed rebuild-all`, `geneseed update` and `geneseed migrate` read the line back and rebuild with the same kits. `geneseed diff` and the web console read it too, so they compare against or rebuild that same set. `geneseed validate` does not read it: pass `--kits` to dry-run a kit build. A plain `build` does not read it; it only warns, as above. If the line names a kit this Geneseed no longer ships, the rebuild drops that kit with a notice and keeps the others. It never fails `rebuild-all`. A retired kit name is never reused for a new kit.

`geneseed status` shows `kits: spring-boot` on the install's row, and `status --json` carries the same list.

Kits stay per install: the [shared tier](shared-tier.md) holds what you teach the agent, not what an install renders.

In the web console, the **Kits** page (`#/kits`) is the one home of the kit switches: a card per kit over a kits × installs matrix, disabled installs read-only. Toggling stages the set; **Apply** asks for confirmation, then rebuilds that one install with exactly that set as a console job (replace, not replay). Files you edited in a kit that is now off are kept, and the matrix lists them under their install so you can delete them by hand. A kit's page (`#/kits/<kit>`) shows its rules, banned APIs and upstream credits with the same per-install switch, and the Library tags each member skill or agent with a `kit:` badge.

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
