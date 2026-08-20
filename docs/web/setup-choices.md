---
group: start
order: 1
title: "Posture, doctrines & footprint"
kind: "concept"
---
The setup wizard asks five starting parameters. The first, the **theme**, is the *voice* — banner, sigil, prose register — previewed live as you move through the wizard; it never changes structure or rules, so pick whatever reads best to you ([voice vs structure](#/docs/themes)). The other four shape how the agent works and are explained below. All five have safe defaults — accept them and move on, or pick deliberately here. All are set-and-forget: preserved across every rebuild and re-theme, changeable later from **Settings**, the **Harnesses** page, or the wizard.

### Posture — the relationship register

How the agent works *with you*, fixed at build time so it doesn't drift mid-session:

- **peer** *(default)* — candid equal: dense, challenges, no flattery.
- **mentor** — explains the why, checks understanding.
- **expert** — maximum density, no basics.
- **assistant** — precise execution, low initiative; you steer.
- **artisan** — peer with toolsmith reflexes, terminal-first.

Pick **peer** unless you know you want another register. Posture is orthogonal to theme: theme changes the prose, posture changes the relationship.

### Mode — how work gets executed

How the session runs the work you hand it, fixed at build time:

- **direct** *(default)* — the agent works every task itself, turn by turn, exactly as it does today.
- **foreman** — the session triages incoming tasks: trivial ones get a direct answer, substantial ones spawn an isolated crew (analyst → developer → tester) that reports back and merges only once its tests and lint pass — while the session keeps answering you. Costs more per substantial task (a small crew runs instead of one agent) in exchange for staying responsive.

Pick **direct** unless you want the session managing a crew for you. Switch back any time with `--mode direct`.

### Doctrine packs — which practices bind

Which practice rules this install adopts, fixed at build time. Unlike the dials above this one really does change *which rules apply*: the [Ontology and the Rules](#/docs/rules) are always on, the doctrines are yours to pick. All four ship enabled, and leaving one out is a deliberate choice, not a default:

- **craft** — how code is written: reuse first, house conventions, docs in step, the smallest diff.
- **rigor** — how work is proven: idempotence, honest tests, coverage, gates that can actually fail.
- **ops** — how the machine is driven: tool discovery, commands that return, complete teardowns.
- **process** — how a session runs: planning, context economy, docs first, and the **consent gate on every commit and push**.

Turning **process 5** off takes that consent gate with it, at the tool boundary as well as in the prose: the OpenCode permission block and the Claude/Bob `PreToolUse` hook that ask before a commit or a push are wired only when that rule is built in, because a boundary that keeps asking for a rule the install never adopted is a gate arguing with its own harness. The invariant-territory refusals — `rm -rf`, a force-push — stay in every build; they are the Rules' territory, not the pack's.

A pack you leave out still ships in the bundle under `doctrines/`, so you can read it before turning it on, and a rule that cites it still resolves. Change the set with `geneseed-build --doctrines craft,rigor` (or `--doctrines none`), or in `harness.config.json`.

### One rule at a time

The pack is the coarse axis. `--exclude-rules` is the fine one, and it takes rule addresses — so *keep all of process, drop just `process 7`* is expressible:

    geneseed-build --exclude-rules "process 7"
    geneseed-build --exclude-rules "process 5,craft 2"
    geneseed-build --exclude-rules none

Either spelling of an address works, `process 7` or `process.7`. The two axes compose: a pack whose every rule is excluded leaves `Active packs:` entirely, so no pack header is ever rendered with nothing under it. An install records its exclusions in a second marker line — `Excluded rules: process 7` — written only when something *is* excluded, and every rebuild path reads it back and preserves it.

The switches are on the **Constitution** page, one per rule, staged locally and applied in a single rebuild.

### Footprint — how much of the constitution loads inline

How much of the constitution `AGENT.md` carries inline every turn. A token-cost dial, not a rules cut — whatever this install adopted always applies:

- **lean** *(default)* — the Ontology whole, then each Rule and each doctrine rule as its heading plus its first line, with a pointer to the complete text shipped beside `AGENT.md` and read on demand.
- **full** — every Rule's and every active doctrine rule's complete text *and* rationale inline. Best when token cost is a non-issue or you run a smaller model, which applies a rule's nuance more reliably with the *why* eagerly in context.

---

**Deeper:** [The constitution](#/docs/rules) · [The collaboration layer](#/docs/collaboration) · [Footprint (lean vs full)](#/docs/footprint) · **Next:** [Verify it works](#/docs/verify)
