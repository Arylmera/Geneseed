<div align="center">

# 🧬 Geneseed — What's Shipped

**A registry of the harness's capabilities and the dated spec behind each.**

[← README](README.md) · [Design](DESIGN.md)

</div>

---

This page answers "what is actually in the harness, and where is its rationale?"
The dated `docs/specs/*` files were the *design record* — the problem and the
decisions behind each feature; this is the *index* over them, marking what has
landed in the source tree. Specs are working documents: they live git-ignored on
the authoring machine and are dropped once shipped, so the spec names below are
historical references, not files distributed with the repo.

> **On version numbers.** [`harness.config.json`](harness.config.json)'s `version` is a
> human-readable label only. The canonical identity of an installed harness is the
> **source fingerprint** stamped in `.geneseed-version` (see `geneseed version`), not the
> string. Current label: **3.5.0**.

## Capabilities

Every row below is present in the tree today; "Spec" names the design record.

| Capability | What it is | Spec |
| --- | --- | --- |
| **Themed generator** | One neutral `src/` → 14 themed bundles via `geneseed-build` (zero dependencies); structure stays theme-independent | [DESIGN.md](DESIGN.md) |
| **Laws / Agents / Skills / Memory / Notebook** | 11 laws, 18 agents, 52 skills, the memory convention, and the agent's sovereign notebook | `2026-06-11-notebook-sovereign-space` · `2026-06-10-notebook-agent-own-space` |
| **Three-tier constitution** | The governance surface splits into an always-on **Ontology** (Telos, Evidence, Decisions, Conduct — the Pact absorbed into Telos), the eleven always-on **Invariants** (IX and XI retired in place — folded into rigor 5 and Law III, numbers kept), and four toggleable **Doctrine** packs (craft, rigor, ops, process) addressed `<pack> <n>`. Packs are chosen at build time with `--doctrines` or the setup wizard; the whole catalogue ships on disk either way, so a citation into an inactive pack still resolves. Precedence, in order: Ontology + Invariants, then the user's `user-rules.md`, then the active Doctrines, then `PROFILE.md`. `doctor`'s `constitutionProblems` gates pack numbering, the per-rule Principle column, every `{{DOCTRINE}}` citation in `src/`, and the rule that an always-on tier may never cite a toggleable one | `2026-08-19-three-tier-constitution-design` |
| **`doctor`** | One check: unresolved tokens, dead/non-hermetic links, theme-key parity, authoring gates, rendered-bundle drift | `2026-06-07-theme-aware-doctor-diff` |
| **`diff` + improvements export** | Deployed-vs-source drift report; export an `improvements.md` back-port | `2026-06-12-improvements-export` |
| **`status` / `version`** | Headless dashboard + fingerprint verdict (no TUI needed) | `2026-06-07-status-command` · `2026-06-07-version-and-uninstall` |
| **Terminal rendering** | There is no full-screen control panel: `tui` and `menu` are verbs that say so and print the command list. The display-width and glyph layer ships on, behind `status` and the install animation | `2026-06-07-tui-refactor-polish` · `2026-06-08-tui-modern-refresh` · `2026-06-11-windows-tui` |
| **Web console** | Local browser UI (Dashboard; Codex: Constitution, Rules, Profile, Skills, Agents, Library, Docs; Care: Activity, Changes, Doctor; Setup: Harness, Settings), auto-build, in-app docs menu | `2026-06-12-web-ui-v2` · `2026-06-12-web-auto-build` · `2026-06-13-docs-menu` |
| **OpenCode adapter** | Native agents/skills mapping + plugins (context, learn, guard, workflow, notify, ponytail, activity); global-emit link integrity; JSONC config target | `2026-06-07-opencode-adapter-features` · `2026-06-07-global-emit-link-integrity` · `2026-06-12-opencode-jsonc-target` · `2026-06-16-ponytail-minimal-code-mode` |
| **Host hooks, per dialect** | Every host gets the hook surface its runtime offers, spoken in that runtime's own verdict dialect via `--host`: Claude Code asks (`permissionDecision`), Copilot asks as Claude does (`sessionStart`, `preToolUse`, `agentStop`, `preCompact` in `~/.copilot/settings.json`, global scope only), Bob refuses by exit code 2 (five Claude-named events, nested `~/.bob/settings/settings.json`, no subagent event), OpenCode's guard throws. Laws I/IV are the hard tier everywhere; the consent rules ask where a host can ask and warn where it cannot. `tool-gate` fuses the two gates for hosts that run one command per event; `PreCompact` runs `learn` before Claude compacts; every block or ask lands in `notebook/gates.jsonl` on every host | [copilot](adapters/copilot/README.md) · [bob](adapters/bob/README.md) · [claude-code](adapters/claude-code/README.md) · [candidate hosts](docs/candidate-hosts.md) |
| **Workflow primitive** | Saved, code-driven subagent orchestration (`workflow` tool + runtime); shipped scripts include `dispatch` — decompose a goal, route each subtask to its owning agent, converge | `2026-06-09-opencode-workflow-primitive` |
| **Per-agent memory** | Each capability agent keeps durable lessons in `memory/agents/<name>.md`: read at dispatch, written back mechanically by `learn` on session/subagent end (OpenCode plugin + Claude `SubagentStop`; Bob has no subagent event); `learn --consolidate` rebuilds the index | `2026-07-04-orchestration-memory-upgrade` |
| **Wiki integration** | Machine-wide knowledge base (`wiki.jsonc`): eager/lazy loading, conventions, protected folders enforced at the tool boundary | `2026-06-11-wiki-knowledge-base` |
| **Collaboration layer** | Negotiated postures (peer/mentor/expert/assistant/artisan, chosen at setup, inlined in AGENT.md), the bidirectional Pact, epistemically-typed memory (`force:` + Bridge rule), and a seed-once `PROFILE.md` identity with a web editor tab and a `profile` skill that interviews the user to draft it | `2026-07-12-collaboration-layer` |
| **Rule front door** | Both durable stores enter through the `rule` skill's fork (*standing rule, or fact to remember?* — always asked, never inferred): the memory branch elicits the binding `force` and shows the file before writing, the rule branch pressure-tests by reformulation and a mandatory counter-example. Doctrine process 1 carries the norm on every host; a `rule-gate` PreToolUse hook (Claude, Bob) and a `geneseed-guard` speed bump (OpenCode) hold it at the tool boundary | `2026-07-30-rule-front-door` |
| **Entity registry** | `registry.json` records a lifecycle status, version, owner and add-date for every agent and skill in the tree (maintainer-side — never rendered into a bundle, so it costs no session context). `doctor` gates it against `src/` in both directions, sweeps everything that ships for credentials, and holds each vendored skill folder to an immutable upstream commit. The status surfaces as a badge in the web catalog, shown only where it deviates from `approved` | `2026-07-31-entity-registry` |
| **Node runtime + npm package** | The whole harness runs from Node: every command `js/cli-table.json` declares, all five hook verbs, every web-console endpoint (the OS-native folder picker excepted, and declined on purpose) and both generators. Every commit runs the unit suite, `doctor --all` across every theme × host × footprint, and the generator's two self-comparisons, on Linux and Windows both; the frozen emit/cli/web recordings that also gated it retired on 2026-08-17 (see the 2.0.0 entry in [CHANGELOG.md](CHANGELOG.md)). It ships as the zero-dependency `geneseed` package (`geneseed`, `geneseed-hook`, `geneseed-build`), so `npx geneseed setup` needs no clone and nothing else installed; `geneseed migrate` moves an existing checkout install across. Node is the only runtime it asks for: the `token-report` skill's own script is `token_report.mjs`, gated over seeded transcripts for all four hosts, and `daydream` and `herdr` call `node -e` | `2026-08-06-npx-distribution` |
| **Runtime awareness** | MCP discovery, web research, tool-call batching, review discipline — carried by the doctrine packs (`ops 1` tool discovery, `process 4` read the docs first, `rigor 2`/`rigor 3` honest tests and cover-and-verify), not by the invariants | `2026-06-07-runtime-awareness-and-review-discipline` |
| **Run from anywhere / uninstall** | `link`/`unlink` onto PATH; global uninstall that keeps the memory store | `2026-06-07-version-and-uninstall` |

## Workplans (not features)

A few specs were multi-agent *workplans / audits*, not single features —
they record direction, and their individual items landed across the capabilities above:

- `2026-06-08-harness-perfection-workplan`
- `2026-06-08-opencode-feature-coverage`
- `2026-06-08-tui-professional-workplan`

## Exploratory archive

`docs/superpowers/` held early implementation *plans* for the web console (and the
"Cultivar" re-skin) written in a checkbox-driven planning format. The work they
describe has since shipped (see the **Web console** row above); like the specs, that
folder is now a local working area — git-ignored, kept as history on the authoring
machine only.
