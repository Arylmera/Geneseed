---
group: concepts
kind: "concept"
section: "Loops"
order: 18
title: "Bricks and their origins"
description: "What a brick is, how templates wire bricks, and how project and global bricks override shipped ones."
---
A **brick** is a markdown file: YAML-ish frontmatter (`name`, `description`, `effect` — `read` or
`mutate` — exactly one of `agent` or `skill`, and `outcomes`) plus a 4-10 line prose body. The
model never sees the file; `geneseed loop next` hands it the body as the prompt. A **loop
template** — a shipped template (see [Loop templates](loop-templates.md)) or one composed by hand — is the graph JSON
that wires bricks together.

Both are looked up across three origins, each able to override the one before it **by name**:

| origin | path | who writes it |
|---|---|---|
| shipped | `src/bricks/`, `src/loops/` | Geneseed itself — read by the CLI from its own source, never emitted into an install |
| global | `$XDG_CONFIG_HOME/geneseed/{bricks,loops}` (default `~/.config/geneseed/…`) | the user, for every project on this machine |
| project | `<repo>/.geneseed/{bricks,loops}` | a team, committed and shared |

Precedence is project > global > shipped. A project or global brick named `apply` replaces the
shipped `apply` everywhere a template references it, without the template changing.
`geneseed loop check` lists every override it finds, never silently.

A per-install skill exclusion is invisible to the CLI — it has no way to know which skills your
install carries. The `loop` skill covers the gap itself: when composing a graph it skips a brick
whose `skill` it doesn't have.

To add or adapt a brick, use the `brick-forge` skill — ask it, or see
[the bricks README](../../src/bricks/README.md) in
the repository.

## Java notes for the newer bricks

- **`mutation-check`** (`legacy-tests`) prefers PIT on a Maven build: `mvn test-compile
  org.pitest:pitest-maven:mutationCoverage -DtargetClasses=<fq.Class*>
  -DreportsDirectory=<OS temp dir> -DtimestampedReports=false`, and needs `pitest-junit5-plugin`
  on the classpath under JUnit 5; on Gradle, the `info.solidsoft.pitest` plugin's `pitest` task.
  With neither configured it reports `unavailable` rather than adding the plugin itself or a
  silent `pass`.
- **`fitness-define`** (`enforce-architecture-rule`) reaches for ArchUnit first on Java — a
  `FreezingArchRule`, whose violation store doubles as the allowlist of today's violations —
  before dependency-cruiser, import-linter, eslint-plugin-boundaries or size-limit elsewhere.
- **`migration-plan`** (`update-contract`) treats Pact or Spring Cloud Contract, where the repo
  already records consumer contracts, as the check `compat-check` runs against each step rather
  than only the consumers' own test suites.
