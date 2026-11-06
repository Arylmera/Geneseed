---
type: architecture
mirrors-commit: 9c4af014
generated: 2026-11-06
---

# Geneseed architecture

The short map is the root [`ARCHITECTURE.md`](../ARCHITECTURE.md): parts, invariants and the lines
that must not be crossed. The module map is [`js/README.md`](../js/README.md). This page adds the C4
views and how the pieces meet at run time. It repeats neither.

<!-- geneseed:doc:start -->
## Context (C4 L1)

A developer drives an AI coding host. Geneseed sits beside that host: it writes the host's
instructions, skills and agents, and answers the host's hook calls. It calls no model itself,
unless the user sets `GENESEED_LLM` for `learn` on a hook host.

```mermaid
---
title: Context (C4 L1) — Geneseed
---
flowchart TB
  dev(["Developer [person]"])
  gs["Geneseed [software system · Node.js CLI, hooks, web console]"]
  host["AI coding host [software system · Claude Code, OpenCode, Bob, OpenClaude]"]
  npm["npm registry [external system]"]
  git["Git remote [external system · a clone's origin]"]
  vault["Wiki vault [external system · a folder of Markdown]"]
  llm["Model CLI [external system · GENESEED_LLM, optional]"]

  dev -->|"installs, upgrades, inspects · CLI, browser"| gs
  dev -->|"works with the agent · host UI"| host
  gs -->|"writes instructions, skills, agents, hook wiring · files"| host
  host -->|"calls gates and context · process, stdin/stdout JSON"| gs
  gs -->|"gets the package, checks for a release · HTTPS"| npm
  gs -->|"self-updates a clone · git"| git
  gs -->|"reads eager and lazy notes · files"| vault
  gs -->|"distils facts on a hook host · process"| llm
  subgraph Legend
    l1(["person"]) ~~~ l2["software system"]
  end
```

Sources: `bin/geneseed-hook.mjs`, `js/hosts/settings.mjs`, `js/web/update-check.mjs`,
`js/maintain/update.mjs`, `js/hosts/hooks-learn.mjs`.
<!-- geneseed:doc:end -->

<!-- geneseed:doc:start -->
## Containers (C4 L2)

```mermaid
---
title: Containers (C4 L2) — Geneseed on one machine
---
flowchart TB
  dev(["Developer [person]"])
  host["AI coding host [software system]"]

  subgraph gs["Geneseed"]
    cli["geneseed [container · Node.js CLI, bin/geneseed-cli.mjs]"]
    build["geneseed-build [container · Node.js generator, bin/build-driver.mjs]"]
    hook["geneseed-hook [container · Node.js, bin/geneseed-hook.mjs]"]
    shim["hook shim [container · script, ~/.geneseed/bin]"]
    plugins["OpenCode plugins [container · JS in the host's process, adapters/opencode]"]
    web["web console [container · Node.js daemon + React SPA, js/web, web/dist]"]
    source[("source tree [database · src/, themes/]")]
    install[("install [database · files in a host config dir or repo]")]
    tier[("shared tier [database · files, ~/.config/geneseed]")]
  end

  dev -->|"runs verbs · shell"| cli
  dev -->|"reads and acts · HTTP on localhost, port 4747"| web
  cli -->|"starts an emit · in process, or via rebuild-all"| build
  cli -->|"starts the daemon · process"| web
  web -->|"runs jobs · process"| cli
  build -->|"reads · files"| source
  build -->|"renders and emits · files"| install
  build -->|"seeds, then folds host stores · files"| tier
  build -->|"rewrites, last writer wins · files"| shim
  host -->|"loads text, skills, agents · files"| install
  host -->|"runs on each hook event · process"| shim
  host -->|"loads at start · in process"| plugins
  shim -->|"calls · process"| hook
  hook -->|"reads session files, writes facts · files"| tier
  plugins -->|"reads session files, writes facts · files"| tier
  hook -->|"reads context, gate markers · files"| install
  plugins -->|"reads context, gate markers · files"| install
  web -->|"reads and edits rules, profile, memory · files"| tier
  web -->|"inspects and changes · files"| install
  subgraph Legend
    l1(["person"]) ~~~ l2["container"] ~~~ l3[("database")]
  end
```

The stores are plain files: no server or database engine runs. `installs.json`, the install
registry, sits in the tier's folder and tells the CLI and the console which installs exist.

| Container | Must not | Enforced by |
|---|---|---|
| `geneseed-build` | spawn | closure walks in `tests/unit/hook_cli.test.mjs` ([ADR 0002](adr/0002-no-spawn-on-the-generator-and-hook-path.md)) |
| `geneseed-hook` | print anything but its verdict | `fuzz/`, the golden CLI matrix |
| `geneseed` | spawn beyond its allow-list | [ADR 0002](adr/0002-no-spawn-on-the-generator-and-hook-path.md) |
| OpenCode plugins | import from `js/`, or throw on OpenCode 2 | `tests/plugins/helper_parity.test.mjs` |

### Build and install flow

```mermaid
---
title: What a global emit does
---
sequenceDiagram
  participant U as geneseed / rebuild-all
  participant B as geneseed-build
  participant T as shared tier
  participant I as host config dir
  U->>B: --emit claude-global
  B->>T: ensureSharedTier (canonical install only)
  B->>B: renderAll, with absolute tier paths
  B->>I: write files in the manifest, merge settings
  B->>T: fold facts, read each copy back
  B->>I: move the old store to archived-memory/
  B->>T: fold notes, exclude paths, profile, wiki
  B->>T: draft each rule that needs a decision
  B-->>U: one [shared] report line
```

A non-canonical emit, such as `geneseed diff` into a temp folder, renders the same paths and
creates and folds nothing. [The shared tier](concepts/shared-tier.md) holds the user-facing rules.
<!-- geneseed:doc:end -->

<!-- geneseed:doc:start -->
## Decisions

The decisions are one file each in [`docs/adr/`](adr/README.md), and product decisions are in the
root [`DESIGN.md`](../DESIGN.md). They are not copied here. The structural ones behind this page:

- [0001](adr/0001-zero-runtime-dependencies.md) — vendored code, no installed runtime dependency.
- [0002](adr/0002-no-spawn-on-the-generator-and-hook-path.md) — who may spawn.
- [0004](adr/0004-uninstall-without-backups.md) — manifests and managed blocks.
- [0008](adr/0008-host-parity-ceiling-of-the-weakest-host.md) — a feature lands on every host.
- [0009](adr/0009-self-update-is-a-git-pull.md) — a clone updates itself with `git pull`.
- [0011](adr/0011-shared-tier.md) — one shared tier per machine.
<!-- geneseed:doc:end -->
