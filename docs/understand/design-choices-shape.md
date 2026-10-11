---
group: understand
order: 10
title: "Choices: the shape of the harness"
kind: "concept"
section: "Why it works this way"
description: "How the generated text is assembled, ranked and sized, and why."
---
How the generated harness is assembled, ranked and sized. Part of [Why Geneseed works this way](design-choices.md); the other parts cover [gates](design-choices-gates.md), [hosts](design-choices-hosts.md), [install and update](design-choices-install.md), and [engineering, skills and agents](design-choices-engineering.md).

- **Three tiers: Ethos, laws, toggleable doctrines.** The harness once shipped one flat list of laws. Splitting it lets a build make the practices optional while the core stays fixed. See [Rules](../concepts/rules.md) and [Extending](../extending.md).
- **A fixed conflict order: Ethos and laws, then your `user-rules.md`, then doctrines, then `PROFILE.md`.** Your own rules outrank any practice pack chosen at build time, and may tighten a law but never repeal one. See [Rules](../concepts/rules.md) and [DESIGN.md](../../DESIGN.md).
- **The lean footprint is the default, and its short text is written by hand.** Each law and doctrine rule carries an authored short half. Cutting the long text at its first full stop left orphan sentences an agent could not act on. See [Footprint](../concepts/footprint.md) and [Token footprint](../token-footprint.md).
- **An amendment goes into both halves of a rule.** Most installs only ever see the short half, so an amendment to the long half alone does not exist for them. See [Extending](../extending.md).
- **Rules have permanent ids and are cited by name.** A rule's number is only its position, so removing a rule rewires nothing, and a retired id is never reused. See [ADR 0005](../adr/0005-stable-rule-ids.md).
- **An always-on tier never cites a doctrine.** A build without that pack would ship a law pointing at text it does not contain; `constitutionProblems` refuses the citation. See [DESIGN.md](../../DESIGN.md).
- **Posture and mode are two separate axes, both fixed at build time.** Posture is the relationship register (peer, mentor and the rest); mode is the operating register (direct or foreman). A register declared in a prompt but not anchored in the build drifts during a session. See [Collaboration](../concepts/collaboration.md) and [Foreman mode](../concepts/foreman-mode.md).
- **Size is measured on the rendered file, against a ceiling.** The ceiling lives in `tests/unit/emit_smoke.test.mjs`, and an overrun is fixed by shortening the text. Overruns come from what is rendered, which a word count of the source does not see. See [Token footprint](../token-footprint.md).
- **Marker lines (`Excluded rules:`, `Excluded skills:`) are written only when non-empty.** A default build then stays byte-identical to one from before the option existed. See [DESIGN.md](../../DESIGN.md) and [Exclusions](../concepts/exclusions.md).
- **Session files are injected at start unless still identical to their seed, and the root file is never injected a second time.** The host already loads the root file itself; injecting it again paid for the whole harness twice per session. See [Token footprint](../token-footprint.md).
- **The context hook keeps its whole output under `OUTPUT_BUDGET`, counting each line's Windows line ending.** Claude Code moves a longer hook output to a file and shows the model a short preview, so everything past the cut is lost without a warning. Splitting the hook into two commands was measured and turned down (see [Considered and refused](../design-history.md#considered-and-refused)). See [Token footprint](../token-footprint.md).
