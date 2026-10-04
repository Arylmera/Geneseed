---
group: guides
order: 22
title: "Which loop template"
kind: "concept"
section: "Loops"
description: "Pick a loop template by what you want to do."
---
[Run a loop](run-a-loop.md) takes a template by name, or lets the agent compose a graph from the bricks. Pick one by what you want to do:

| I want to… | Template | Category |
| --- | --- | --- |
| Record a design decision as an ADR before any code changes | `architecture-decision` | architecture |
| Make a rule hold everywhere (a test with an allowlist, then one violation fixed per iteration) | `enforce-architecture-rule` | architecture |
| Change an API, schema or event that has live consumers, without breaking them | `update-contract` | architecture |
| Pin untested legacy behaviour with characterization tests, production code untouched | `legacy-tests` | tests |
| Write each failing test before the code that passes it | `tdd` | tests |
| Fix a test that fails only sometimes, at its root cause | `fix-flaky-tests` | tests |
| Fix a reported bug, starting from a failing reproduction | `bugfix` | development |
| Build a feature in planned iterations | `feature` | development |
| Pin the acceptance criteria in a spec you review first, then build it | `spec-first-feature` | development |
| Add or change HTTP endpoints, each with a Bruno request and a security pass | `api-endpoint` | development |
| Restructure code that the tests already cover | `refactor` | refactoring |
| Refactor code that has no tests yet | `legacy-refactor` | refactoring |
| Delete unused code, one coherent group per iteration | `remove-dead-code` | refactoring |
| Upgrade dependencies one package or group at a time | `deps-upgrade` | day-to-day |
| Turn a red CI run green on a `loop/*` branch | `ci-repair` | day-to-day |

The console's **Loops › Templates** shows each one as a ring, with its bricks and which of them stop for you.

What each template's bricks do: [Loop templates](../concepts/loop-templates.md).

---

**Next:** [While a loop runs](loop-running.md)
