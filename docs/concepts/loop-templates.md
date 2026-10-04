---
group: concepts
kind: "concept"
section: "Loops"
order: 15
title: "Loop templates"
description: "Every shipped loop template, what it is for, and the notes that matter when you pick one."
---
The loop templates Geneseed ships. Each is a graph of [bricks](loop-bricks.md) wired for one kind of work; [Run a loop](../guides/run-a-loop.md) picks one by what you want to do.

| template | purpose | when to use |
|---|---|---|
| `bugfix` | reproduce, fix, test, review a defect | a reported bug with a reproduction step |
| `feature` | plan, then build and review in small iterations | new behaviour with no existing test pinning it |
| `refactor` | restructure behind the existing tests, no behaviour change | the tests already cover the code you're moving |
| `tdd` | plan, then write each failing test before the code that passes it | you want the test written first, every iteration |
| `legacy-tests` | pin undocumented behaviour with characterization tests, mutation-checked, production code untouched | code with no tests and no spec, before anyone risks changing it |
| `legacy-refactor` | pin current behaviour once with characterization tests, then refactor behind that net | the refactor target has no tests yet but will get changed |
| `deps-upgrade` | upgrade one package or group per iteration: read breaking changes, bump, adapt, audit | a dependency bump that needs to land as reviewable steps, not one big diff |
| `ci-repair` | triage failing CI checks for the current commit and fix one code failure per iteration | a red CI run on a `loop/*` branch that needs to go green |
| `architecture-decision` | draft one ADR per decision the requirement names, challenged by a skeptic brick, reviewed by the user | a design choice worth recording before (or instead of) any code changes |
| `enforce-architecture-rule` | encode an architecture rule as a test with an allowlist of today's violations, then fix one violation per iteration | a rule the codebase should hold everywhere but doesn't yet |
| `update-contract` | change an interface with live consumers as expand, migrate one consumer per iteration, contract | an API, schema or event change that can't break existing callers in one step |
| `spec-first-feature` | write the feature's spec (EARS criteria, ordered tasks) for review, then build one task per iteration | a feature whose acceptance criteria are worth pinning down before any code |
| `api-endpoint` | plan, build, test, write a Bruno request and security-review one endpoint change per iteration | an HTTP API feature where each endpoint needs its own exercised request and a security pass |
| `remove-dead-code` | confirm the suite is green, then delete one coherent group of unused code per iteration, test, review | code a tool (knip, ts-prune, vulture, PMD…) and a reference search say is unused |
| `fix-flaky-tests` | confirm flakiness by repeated runs, then fix one test's root cause per iteration — never a retry or a sleep | a test that fails only sometimes, not every run |

`feature` and `spec-first-feature` both end with an independent `done-check`: before `$close`, it
maps every acceptance criterion to a passing test (or a stated manual check) and reports `fail`
with what's missing rather than trusting the iterations that already ran.

`legacy-tests` and `legacy-refactor` both open on `baseline-green` — the suite must already be
green before either template pins anything, and `baseline-green` reporting `fail` stops the loop
rather than characterizing a change no one can tell from existing breakage.

`mutation-check`, inside `legacy-tests`, needs a mutation tool on the stack (Stryker, PIT, mutmut,
cargo-mutants) to prove the new characterization tests actually bite. With none configured it
reports `unavailable` rather than a silent `pass` — and still writes a note saying what it checked,
so the gap is visible in `LOOP.md` rather than just absent from it.

`ci-repair` needs CI to actually run on `loop/*` branches; `ci-triage` keys off the HEAD commit's
checks (`gh run list --commit`), and with no run for that commit it reports `done` with a note
rather than treating a branch CI never touched as green.

`deps-upgrade` lists lockfiles under `ignoreDeletions` (`**/package-lock.json`, `**/yarn.lock`,
`**/pnpm-lock.yaml`, `**/*.lock`, `**/gradle.lockfile`): a lockfile regenerating under a bump deletes
and re-adds hundreds of lines with no risk in them, so those lines stay out of the deleted-lines
count. Everything else keeps the default `delete` weight, and a lockfile outside the iteration's
write set still escalates like any other file.
