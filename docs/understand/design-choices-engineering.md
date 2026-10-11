---
group: understand
order: 14
title: "Choices: engineering, skills and agents"
kind: "concept"
section: "Why it works this way"
description: "How Geneseed's code and tests are kept, what it offers the agent, and why."
---
How Geneseed's own code and tests are kept, and what the harness offers the agent. Part of [Why Geneseed works this way](design-choices.md); the other parts cover [the shape of the harness](design-choices-shape.md), [gates](design-choices-gates.md), [hosts](design-choices-hosts.md), and [install and update](design-choices-install.md).

## Engineering

- **No runtime dependencies; what is needed is vendored under `js/vendor/`.** `npm ci` and `git pull` must work on locked-down machines, and a fresh clone cannot resolve a registry package. See [ADR 0001](../adr/0001-zero-runtime-dependencies.md).
- **The generator and the gate verbs start no process; the CLI only through a declared allow-list.** Geneseed must never depend on whichever interpreter happens to be on `PATH`. See [ADR 0002](../adr/0002-no-spawn-on-the-generator-and-hook-path.md).
- **Tests state their expected values in the file, with the sentence that explains the rule.** A recorded snapshot says what came out, and nothing about why it is right. See [ADR 0003](../adr/0003-expected-values-written-out.md).
- **A test is proven by putting the bug back.** A check that was never seen to fail has never shown it holds anything. See [Extending](../extending.md).
- **CI gates on the reported test count as well as the exit code.** A test glob that matches nothing prints zero tests and exits 0. See [Extending](../extending.md).
- **Counts in the docs are computed.** A copied number drifts from the thing it counts, so pages use count tokens and the doctor flags a typed number. See [Extending](../extending.md).
- **Generated project docs are Markdown by default, AsciiDoc on request.** Projects and agents read Markdown. See [ADR 0006](../adr/0006-markdown-by-default-for-generated-docs.md).
- **The built web console, `web/dist/`, is tracked and rebuilt with every change to `web/src/`.** An install must never have to build the interface. See [Web console internals](../web-ui.md).

## Skills and agents

- **Sharpen before you add.** Before adding a skill, merge, refine or delete one. Skills age fast, and the always-loaded list has to stay short to route well. See [Extending](../extending.md).
- **User-only skills and the aliases of old names cost no tokens and are hidden from the model.** The agent sees each skill once. See [Skills](../concepts/skills.md).
- **`--exclude-skills` filters in one place, `renderAll`.** A new host inherits the exclusion with no work of its own. See [Exclusions](../concepts/exclusions.md).
- **No skill is named like a Claude Code built-in command.** The built-in would win; the review skill is `geneseed-code-review` for this reason. See [Project context](../guides/project-context.md).
- **Descriptions carry a "Use when" trigger in the third person, never cut off and never with an XML-like tag.** The description is the only text a host routes on, so a defect there is a skill that silently never fires; the doctor checks the form (`descriptionProblems`). See [Skills](../concepts/skills.md).
- **Skills that sound alike each have one job.** `roast-me` critiques your own ask or plan, `geneseed-code-review` reviews code, `fresh-eyes` is a blind second reading, and `pipeline` relays work between agents. Clear scopes make routing precise. See [Skills](../concepts/skills.md).
